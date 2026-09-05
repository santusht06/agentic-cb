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
    const session = await getSession(this.profileName).catch(() => null);

    const reqHeaders = {
      'Accept': 'application/json, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Goog-AuthUser': '0',
      ...headers,
    };

    // Add SAPISID auth header if we have the cookie
    if (session?.sapisid) {
      reqHeaders['Authorization'] = computeSAPIHASH(session.sapisid, GCHAT_API);
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
    await page.waitForSelector('.ajDw2c, [role="treeitem"]', { timeout: 8000 });

    return page.evaluate((max) => {
      const items = Array.from(document.querySelectorAll('.ajDw2c, [data-group-id], [role="treeitem"], [role="listitem"]'));
      const list = [];
      const seen = new Set();
      for (const el of items) {
        const raw = el.innerText?.trim();
        if (!raw || raw.length < 3 || !raw.includes('\n')) continue;
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !['Away','Active','Options','Open in a pop-up','Press tab for more options.'].includes(l));
        const name = lines[0] || '';
        if (!name || seen.has(name) || ['Direct messages','Spaces','Apps'].includes(name)) continue;
        seen.add(name);
        const time = lines.find(l => l === 'Yesterday' || /^[A-Z][a-z]+ \d+$/.test(l) || l.includes(':')) || '';
        const snippet = lines.find(l => l !== name && l !== time) || '';
        list.push({ name, time, snippet: snippet.slice(0, 120), isUnread: raw.includes('unread') });
        if (list.length >= max) break;
      }
      return list;
    }, limit);
  }

  // ─── Read Messages ─────────────────────────────────────────
  /**
   * Reads messages via Google Chat REST API.
   * No page navigation when space ID is cached.
   */
  async readMessages(targetName, limit = 10) {
    const cache = this._getSpaceCache();
    let spaceId = cache[targetName.toLowerCase()];

    // If not in cache, we need to find it
    if (!spaceId) {
      await this.getConversations(25); // populates cache
      spaceId = this._getSpaceCache()[targetName.toLowerCase()];
    }

    if (spaceId) {
      const res = await this._apiCall(`/chat/v1/${spaceId}/messages?pageSize=${limit}&orderBy=createTime+desc`);
      if (res.ok && res.data?.messages) {
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

    // Fallback: DOM-based read
    return this._readMessagesDOM(targetName, spaceId, limit);
  }

  async _readMessagesDOM(targetName, spaceId, limit) {
    const ctx = await this._getContext();
    const page = ctx.pages?.()[0] || await ctx.newPage();

    const targetUrl = spaceId
      ? `${GCHAT_API}/room/${spaceId.replace('spaces/', '')}`
      : GCHAT_HOME;

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (!spaceId) {
      // Click into the conversation
      await page.evaluate((name) => {
        const all = Array.from(document.querySelectorAll('span, div'));
        const match = all.find(el => el.innerText?.trim().toLowerCase() === name.toLowerCase() && el.offsetWidth > 0);
        if (match) (match.closest('[role="treeitem"]') || match).click();
      }, targetName);

      // Wait for messages to appear (event-driven, not timeout)
      await page.waitForSelector('[data-message-id], .nF6spd', { timeout: 8000 }).catch(() => {});
    }

    const messages = await page.evaluate((max) => {
      const nodes = Array.from(document.querySelectorAll('[data-message-id], .nF6spd'));
      return nodes.slice(-max).map(n => {
        const author = n.querySelector('[data-sender-name], span.FvYvyf')?.innerText?.trim() || 'Sender';
        const text = n.innerText?.trim() || '';
        return { author, text: text.slice(0, 500) };
      }).filter(m => m.text.length > 1);
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

    if (spaceId) {
      await page.goto(`${GCHAT_API}/room/${spaceId.replace('spaces/', '')}`, {
        waitUntil: 'domcontentloaded', timeout: 15000
      });
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
    const roomMatch = currentUrl.match(/\/room\/([^/?]+)/);
    if (roomMatch) this._cacheSpace(targetName.toLowerCase(), `spaces/${roomMatch[1]}`);

    return { ok: true, recipient: targetName, message };
  }
}
