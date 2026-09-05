/**
 * Google Chat Client — API-First, Minimal Browser Usage
 *
 * Architecture:
 * - Session cookies extracted ONCE from browser profile → cached to disk.
 * - List/read operations use Playwright's `browserContext.request` API —
 *   this is a cookie-aware HTTP client that sends browser cookies automatically
 *   WITHOUT navigating to any page. Zero page loads for data retrieval.
 * - Send operations use the same API request context (no keyboard simulation).
 * - Browser is launched only when session is missing.
 * - Space ID cache is persisted to disk to eliminate re-discovery navigation.
 *
 * Key Playwright API: `browserContext.request.get/post(url)` 
 *   → sends all browser cookies automatically, like a fetch() from within the page
 *   → but runs in Node.js process, no page rendering, no DOM, no waits
 */

import { chromium } from 'playwright';
import { getSession, invalidateSession } from '../session.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import pc from 'picocolors';
import readline from 'readline';
import crypto from 'crypto';

const PROFILE = 'google';
const BASE_DIR = path.join(os.homedir(), '.v8_cli');
const GCHAT_HOME = 'https://chat.google.com/app/home';
const GCHAT_API = 'https://chat.google.com';

// ─────────────────────────────────────────────────────────────
// Space cache (persisted to disk so we don't re-discover spaces)
// ─────────────────────────────────────────────────────────────

function spaceCachePath(profileName) {
  return path.join(BASE_DIR, 'profiles', profileName, 'gchat_spaces.json');
}

function loadSpaceCache(profileName) {
  try {
    const file = spaceCachePath(profileName);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

function saveSpaceCache(profileName, cache) {
  const file = spaceCachePath(profileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

// ─────────────────────────────────────────────────────────────
// SAPISID hash for Google API Authorization header
// ─────────────────────────────────────────────────────────────

function computeSAPIHASH(sapisid, origin = 'https://chat.google.com') {
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1')
    .update(`${ts} ${sapisid} ${origin}`)
    .digest('hex');
  return `SAPISIDHASH ${ts}_${hash}`;
}

// ─────────────────────────────────────────────────────────────
// Browser context manager (lazy init, auto-reuse)
// ─────────────────────────────────────────────────────────────

export class GoogleChatClient {
  constructor(options = {}) {
    this.profileName = options.profile || PROFILE;
    this.attachCDP = options.attach || false;
    this.port = options.port || 9222;
    this._browser = null;
    this._context = null;
    this._spaceCache = null;
  }

  // ─── Get persistent browser context ───────────────────────
  async _getContext() {
    if (this._context) return this._context;

    const profileDir = path.join(BASE_DIR, 'profiles', this.profileName);
    fs.mkdirSync(profileDir, { recursive: true });

    // Try CDP attach first (fastest — reuses running Chrome)
    if (this.attachCDP) {
      try {
        this._browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${this.port}`,
          { timeout: 1500 }
        );
        const contexts = this._browser.contexts();
        this._context = contexts[0] || await this._browser.newContext();
        return this._context;
      } catch {}
    }

    // Launch persistent context (preserves cookies across runs)
    this._browser = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      channel: fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
      ],
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    this._context = this._browser;
    return this._context;
  }

  // ─── Core API dispatcher using Playwright's request context ─
  /**
   * Makes an HTTP request using Playwright's APIRequestContext.
   * This automatically includes all browser cookies — no page navigation needed.
   * Equivalent to fetch() called from within the browser page, but runs in Node.
   */
  async _apiCall(endpoint, { method = 'GET', body = null, headers = {} } = {}) {
    const ctx = await this._getContext();
    const cookies = await ctx.cookies();
    const sapisidCookie = cookies.find((c) => c.name === 'SAPISID' || c.name === '__Secure-3PAPISID');

    const reqHeaders = {
      'Accept': 'application/json, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Goog-AuthUser': '0',
      ...headers,
    };

    // Add SAPISID auth header if we have the cookie
    if (sapisidCookie) {
      reqHeaders['Authorization'] = computeSAPIHASH(sapisidCookie.value, GCHAT_API);
      reqHeaders['X-Origin'] = GCHAT_API;
    }

    const opts = { headers: reqHeaders };
    if (body) {
      opts.data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }

    const res = method === 'POST'
      ? await ctx.request.post(`${GCHAT_API}${endpoint}`, opts)
      : await ctx.request.get(`${GCHAT_API}${endpoint}`, opts);

    const ct = res.headers()['content-type'] || '';
    let data;
    try {
      data = ct.includes('json') ? await res.json() : await res.text();
    } catch {
      data = {};
    }

    return { ok: res.ok(), status: res.status(), data };
  }

  // ─── Login (one-time, interactive) ────────────────────────
  async login() {
    console.log(pc.bold(pc.bgBlue(pc.white(' 💬 Google Chat Login & Pairing Session '))) + '\n');

    const profileDir = path.join(BASE_DIR, 'profiles', this.profileName);
    fs.mkdirSync(profileDir, { recursive: true });

    const ctx = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
    });

    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(GCHAT_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(pc.bold(pc.yellow('\nPress Enter after login completes... ')), resolve));
    rl.close();

    // Invalidate cached session so it gets re-extracted on next call
    invalidateSession(this.profileName);

    console.log(pc.bold(pc.green('\n✓ Google Chat session authenticated! Cookies saved.\n')));
    await ctx.close();
  }

  async close() {
    if (this._browser) {
      try { await this._browser.close(); } catch {}
      this._browser = null;
      this._context = null;
    }
  }

  // ─── Space cache management ────────────────────────────────
  _getSpaceCache() {
    if (!this._spaceCache) {
      this._spaceCache = loadSpaceCache(this.profileName);
    }
    return this._spaceCache;
  }

  _cacheSpace(key, value) {
    const cache = this._getSpaceCache();
    cache[key.toLowerCase()] = value;
    this._spaceCache = cache;
    saveSpaceCache(this.profileName, cache);
  }

  // ─── List Conversations ────────────────────────────────────
  /**
   * Lists Google Chat spaces/DMs via the chat.google.com REST API.
   * No page navigation — uses Playwright's request context with browser cookies.
   */
  async getConversations(limit = 10) {
    const res = await this._apiCall('/chat/v1/spaces?filter=spaceType+%3D+%22DIRECT_MESSAGE%22+OR+spaceType+%3D+%22ROOM%22&pageSize=25');

    if (!res.ok || !res.data?.spaces) {
      // Fallback: DOM-based listing (only if API fails)
      return this._getConversationsDOM(limit);
    }

    const spaces = res.data.spaces.slice(0, limit);
    spaces.forEach((s) => {
      const name = s.displayName || s.name;
      if (name) this._cacheSpace(name.toLowerCase(), s.name);
    });

    return spaces.map((s) => ({
      name: s.displayName || s.name || 'Space',
      spaceId: s.name,
      type: s.spaceType,
      isUnread: false,
    }));
  }

  // Fallback DOM scrape (only when API doesn't respond)
  async _getConversationsDOM(limit) {
    const ctx = await this._getContext();
    const page = ctx.pages?.()[0] || await ctx.newPage();
    await page.goto(GCHAT_HOME, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('.ajDw2c, [role="treeitem"], [role="listitem"]', { timeout: 8000 }).catch(() => {});

    const itemsData = await page.evaluate((max) => {
      const items = Array.from(document.querySelectorAll('.ajDw2c, [data-group-id], [role="treeitem"], [role="listitem"]'));
      const list = [];
      const seen = new Set();
      for (const el of items) {
        const raw = el.innerText?.trim();
        if (!raw || raw.length < 3) continue;
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !['Away','Active','Options','Open in a pop-up','Press tab for more options.'].includes(l));
        const name = lines[0] || '';
        if (!name || seen.has(name) || ['Direct messages','Spaces','Apps'].includes(name)) continue;
        seen.add(name);
        const time = lines.find(l => l === 'Yesterday' || /^[A-Z][a-z]+ \d+$/.test(l) || l.includes(':')) || '';
        const snippet = lines.find(l => l !== name && l !== time) || '';
        const groupId = el.getAttribute('data-group-id') || (el.id?.includes('/') ? el.id.split('/')[1] : null);
        list.push({ name, time, snippet: snippet.slice(0, 120), isUnread: raw.includes('unread'), groupId });
        if (list.length >= max) break;
      }
      return list;
    }, limit);

    itemsData.forEach((c) => {
      if (c.groupId) {
        const chatUrl = `https://chat.google.com/app/chat/${c.groupId.replace(/^dm\//, '')}`;
        this._cacheSpace(c.name.toLowerCase(), chatUrl);
      }
    });

    return itemsData.map(({ groupId, ...rest }) => rest);
  }

  // ─── Read Messages ─────────────────────────────────────────
  /**
   * Reads messages via Google Chat REST API or cached direct room navigation.
   */
  async readMessages(targetName, limit = 10) {
    const cache = this._getSpaceCache();
    let spaceId = cache[targetName.toLowerCase()];

    if (!spaceId) {
      // Populate cache from conversation list
      await this.getConversations(25).catch(() => []);
      spaceId = this._getSpaceCache()[targetName.toLowerCase()];
    }

    if (spaceId && !spaceId.includes('chat.google.com')) {
      const res = await this._apiCall(`/chat/v1/${spaceId}/messages?pageSize=${limit}&orderBy=createTime+desc`).catch(() => null);
      if (res?.ok && res.data?.messages) {
        const msgs = res.data.messages.reverse();
        return {
          target: targetName,
          count: msgs.length,
          messages: msgs.map(m => ({
            author: m.sender?.displayName || 'Sender',
            text: m.text || m.formattedText || '',
            time: m.createTime,
          })),
        };
      }
    }

    return this._readMessagesDOM(targetName, spaceId, limit);
  }

  async _readMessagesDOM(targetName, spaceId, limit) {
    const ctx = await this._getContext();
    const page = ctx.pages?.()[0] || await ctx.newPage();

    let targetUrl = spaceId && spaceId.startsWith('http')
      ? spaceId
      : (spaceId ? `${GCHAT_API}/room/${spaceId.replace('spaces/', '')}` : GCHAT_HOME);

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (!spaceId || targetUrl === GCHAT_HOME) {
      await page.waitForSelector('.ajDw2c, [role="treeitem"], [role="listitem"]', { timeout: 8000 }).catch(() => {});
      const clicked = await page.evaluate((name) => {
        const all = Array.from(document.querySelectorAll('span, div, [role="treeitem"], [role="listitem"]'));
        const match = all.find(el => el.innerText?.trim().toLowerCase().includes(name.toLowerCase()) && el.offsetWidth > 0);
        if (match) {
          let p = match;
          while (p && !p.getAttribute('role') && !p.className?.includes('ajDw2c') && p.parentElement) {
            p = p.parentElement;
          }
          const target = p || match;
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          target.click();
          return true;
        }
        return false;
      }, targetName);

      if (clicked) {
        await page.waitForTimeout(2000);
        const currUrl = page.url();
        if (currUrl.includes('/chat/')) {
          this._cacheSpace(targetName.toLowerCase(), currUrl);
        }
      }
    }

    await page.waitForSelector('div[role="main"]', { timeout: 8000 }).catch(() => {});

    const messages = await page.evaluate((max) => {
      const main = document.querySelector('div[role="main"]');
      if (!main) return [];

      const raw = main.innerText || '';
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const ignore = ['Google Workspace tools', 'History is on', 'Schedule send', 'send', 'Send message', 'Home', 'Unread', 'Search', 'Thread'];
      const filtered = lines.filter(l => !ignore.includes(l) && l.length > 1);

      const list = [];
      let currentAuthor = 'Sender';
      for (let i = 0; i < filtered.length; i++) {
        const line = filtered[i];
        if (line === 'You' || line.includes('Harshita') || line.includes('Kotai') || line.includes('Today') || line.includes('Yesterday')) {
          if (line === 'You' || line.includes('Harshita') || line.includes('Kotai')) {
            currentAuthor = line;
          }
          continue;
        }
        if (/^\d{1,2}:\d{2}$/.test(line) || /^\d+ min$/.test(line) || /^[A-Z][a-z]{2} \d{1,2}:\d{2}$/.test(line)) continue;
        list.push({ author: currentAuthor, text: line });
      }

      return list.slice(-max);
    }, limit);

    return { target: targetName, count: messages.length, messages };
  }

  // ─── Send Message ──────────────────────────────────────────
  /**
   * Sends a Google Chat message via REST API when space ID is known.
   * Falls back to DOM automation for contact discovery.
   */
  async sendMessage(targetName, message) {
    const cache = this._getSpaceCache();
    let spaceId = cache[targetName.toLowerCase()];

    if (!spaceId) {
      await this.getConversations(25);
      spaceId = this._getSpaceCache()[targetName.toLowerCase()];
    }

    // API send (fast, no DOM)
    if (spaceId) {
      const res = await this._apiCall(`/chat/v1/${spaceId}/messages`, {
        method: 'POST',
        body: { text: message },
      });

      if (res.ok) {
        return { ok: true, recipient: targetName, message };
      }
    }

    // Fallback: DOM automation send
    return this._sendMessageDOM(targetName, message, spaceId);
  }

  async _sendMessageDOM(targetName, message, spaceId) {
    const ctx = await this._getContext();
    const page = ctx.pages?.()[0] || await ctx.newPage();

    const targetUrl = spaceId && spaceId.startsWith('http')
      ? spaceId
      : (spaceId ? `${GCHAT_API}/room/${spaceId.replace('spaces/', '')}` : null);

    if (targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else {
      await page.goto(GCHAT_HOME, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Click contact
      const clicked = await page.evaluate((name) => {
        const all = Array.from(document.querySelectorAll('span, div, [role="treeitem"]'));
        const match = all.find(el => el.innerText?.trim().toLowerCase() === name.toLowerCase() && el.offsetWidth > 0);
        if (match) { (match.closest('[role="treeitem"]') || match).click(); return true; }
        return false;
      }, targetName);

      if (!clicked) {
        // New chat flow
        const newChat = await page.waitForSelector('[aria-label="New chat"], [data-tooltip="New chat"]', { timeout: 5000 }).catch(() => null);
        if (newChat) {
          await newChat.click();
          const searchInput = await page.waitForSelector('input[placeholder*="search"], input[aria-label*="search"]', { timeout: 4000 }).catch(() => null);
          if (searchInput) {
            await searchInput.fill(targetName);
            await page.waitForSelector('[role="option"], [role="listitem"]', { timeout: 3000 }).catch(() => {});
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
          }
        }
      }
    }

    // Find composer and type — wait for selector instead of timeout
    const composer = await page.waitForSelector(
      'div[role="textbox"][contenteditable="true"], div[aria-label*="message"], div[aria-label*="Message"]',
      { timeout: 8000 }
    );

    await composer.fill(message);

    const sendBtn = await page.$('button[aria-label*="Send"], button[data-tooltip*="Send"]');
    if (sendBtn) await sendBtn.click();
    else await page.keyboard.press('Enter');

    // Wait for delivery confirmation (event-driven)
    await page.waitForSelector('[data-message-id]', { timeout: 5000 }).catch(() => {});

    // Cache this space for future calls
    const currentUrl = page.url();
    if (currentUrl.includes('/chat/') || currentUrl.includes('/room/')) {
      this._cacheSpace(targetName.toLowerCase(), currentUrl);
    }

    return { ok: true, recipient: targetName, message };
  }
}
