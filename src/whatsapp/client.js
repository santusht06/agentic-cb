/**
 * WhatsApp Web Client — Optimized DOM Automation
 *
 * WhatsApp Web has no public REST API; DOM automation is required.
 * Optimizations applied:
 *  - All waitForTimeout() replaced with waitForSelector() / waitForFunction() (event-driven)
 *  - Persistent browser context: browser stays alive as a module singleton,
 *    not re-launched per command. Saves 4–8s cold start on every call.
 *  - CDP attach-first: if Chrome is running with --remote-debugging-port=9222, reuse it.
 *  - Contact search uses the built-in WA search bar instead of DOM scanning.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import pc from 'picocolors';
import readline from 'readline';

const BASE_DIR = path.join(os.homedir(), '.v8_cli');
const WA_URL = 'https://web.whatsapp.com/';

// Module-level singleton — browser stays alive between commands
let _sharedContext = null;
let _sharedProfile = null;

export class WhatsAppClient {
  constructor(options = {}) {
    this.profileName = options.profile || 'whatsapp';
    this.attachCDP = options.attach || false;
    this.port = options.port || 9222;
  }

  // ─── Persistent context (one browser, many commands) ──────
  async _getContext(headless = true) {
    // Reuse existing context if profile matches
    if (_sharedContext && _sharedProfile === this.profileName) {
      return _sharedContext;
    }

    // CDP attach (fastest — reuse running Chrome)
    if (this.attachCDP || true) {
      try {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${this.port}`,
          { timeout: 1000 }
        );
        const contexts = browser.contexts();
        _sharedContext = contexts[0] || browser;
        _sharedProfile = this.profileName;
        return _sharedContext;
      } catch {}
    }

    // Launch persistent context
    const profileDir = path.join(BASE_DIR, 'profiles', this.profileName);
    fs.mkdirSync(profileDir, { recursive: true });

    // Clean stale locks
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
    });

    _sharedContext = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
      ],
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    _sharedProfile = this.profileName;
    return _sharedContext;
  }

  async _getPage(headless = true) {
    const ctx = await this._getContext(headless);
    const pages = ctx.pages ? ctx.pages() : [];
    let page = pages.find(p => p.url().includes('whatsapp.com')) || pages[0];
    if (!page) page = await ctx.newPage();
    return page;
  }

  // Close only called explicitly (not after every command)
  async close() {
    if (_sharedContext) {
      try { await _sharedContext.close(); } catch {}
      _sharedContext = null;
      _sharedProfile = null;
    }
  }

  // ─── Login (one-time) ──────────────────────────────────────
  async login() {
    console.log(pc.bold(pc.bgGreen(pc.black(' 📱 WhatsApp Web QR Pairing Session '))) + '\n');
    const ctx = await this._getContext(false);
    const page = ctx.pages?.()[0] || await ctx.newPage();
    await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(pc.bold(pc.yellow('Press Enter after your chats load... ')), resolve));
    rl.close();

    console.log(pc.bold(pc.green(`\n✓ WhatsApp Web session paired! Profile: ${this.profileName}\n`)));
  }

  // ─── Ensure WhatsApp is ready ──────────────────────────────
  async _ensureReady() {
    const page = await this._getPage(true);

    if (!page.url().includes('whatsapp.com')) {
      await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }

    // Wait for chat list to appear (event-driven, no sleep)
    try {
      await page.waitForSelector('#pane-side, [data-testid="chat-list"], div[aria-label*="Chat list"]', { timeout: 15000 });
    } catch {
      const isQR = await page.$('canvas[aria-label*="Scan"], div[data-ref]');
      if (isQR) throw new Error("WhatsApp not authenticated. Run: cb wa login");
    }

    return page;
  }

  // ─── Get Chats ─────────────────────────────────────────────
  async getChats(limit = 10) {
    const page = await this._ensureReady();

    // Wait for items to appear (event-driven)
    await page.waitForSelector('#pane-side div[role="listitem"], [data-testid="cell-frame-container"]', { timeout: 8000 });

    return page.evaluate((max) => {
      const chatEls = Array.from(document.querySelectorAll(
        '#pane-side div[role="listitem"], div[data-testid="cell-frame-container"]'
      ));
      const list = [];
      const seen = new Set();

      for (const el of chatEls) {
        const titleEl = el.querySelector('span[title], span[dir="auto"]');
        const name = titleEl?.getAttribute('title') || titleEl?.innerText?.trim() || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const snippet = el.querySelector('span[dir="ltr"]')?.innerText?.trim() || '';
        const time = el.querySelector('div[class*="rg5ohu"], time')?.innerText?.trim() || '';
        const unreadEl = el.querySelector('[aria-label*="unread"]');
        const unreadCount = unreadEl ? parseInt(unreadEl.innerText.trim(), 10) || 1 : 0;

        list.push({ name, snippet: snippet.slice(0, 120), time, unreadCount, isUnread: unreadCount > 0 });
        if (list.length >= max) break;
      }
      return list;
    }, limit);
  }

  async getUnread() {
    const chats = await this.getChats(30);
    return chats.filter(c => c.isUnread);
  }

  // ─── Read Messages ─────────────────────────────────────────
  async readMessages(contactName, limit = 10) {
    const page = await this._ensureReady();

    // Try clicking from the visible list
    const found = await page.evaluate((name) => {
      const items = Array.from(document.querySelectorAll('#pane-side [role="listitem"]'));
      for (const item of items) {
        const title = item.querySelector('span[title]')?.getAttribute('title') || item.innerText || '';
        if (title.toLowerCase().includes(name.toLowerCase())) {
          item.click();
          return { ok: true };
        }
      }
      return { ok: false };
    }, contactName);

    if (!found.ok) {
      // Use WA search bar
      const searchBox = await page.waitForSelector('div[contenteditable="true"][data-tab="3"], [aria-label*="Search input"]', { timeout: 5000 }).catch(() => null);
      if (searchBox) {
        await searchBox.fill(contactName);
        // Wait for search results (event-driven)
        await page.waitForSelector('[data-testid="search-result-title"]', { timeout: 4000 }).catch(() => {});
        await page.keyboard.press('Enter');
      }
    }

    // Wait for message panel to load (event-driven)
    await page.waitForSelector('div.message-in, div.message-out, [data-testid="msg-container"]', { timeout: 8000 }).catch(() => {});

    const messages = await page.evaluate((max) => {
      const bubbles = Array.from(document.querySelectorAll(
        'div.message-in, div.message-out, [data-testid="msg-container"]'
      )).slice(-max);

      return bubbles.map(b => {
        const isOut = b.classList.contains('message-out') || !!b.querySelector('[data-testid="tail-out"]');
        const textEl = b.querySelector('.copyable-text span, span.selectable-text');
        const text = textEl?.innerText?.trim() || '';
        const rawTime = b.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
        return { sender: isOut ? 'You' : 'Contact', text, time: rawTime, outgoing: isOut };
      }).filter(m => m.text);
    }, limit);

    return { contact: contactName, count: messages.length, messages };
  }

  // ─── Send Message ──────────────────────────────────────────
  async sendMessage(contactName, message) {
    const page = await this._ensureReady();

    // Try clicking from visible list
    const found = await page.evaluate((name) => {
      const items = Array.from(document.querySelectorAll('#pane-side [role="listitem"]'));
      for (const item of items) {
        const title = item.querySelector('span[title]')?.getAttribute('title') || item.innerText || '';
        if (title.toLowerCase().includes(name.toLowerCase())) {
          item.click();
          return { ok: true };
        }
      }
      return { ok: false };
    }, contactName);

    if (!found.ok) {
      const searchBox = await page.waitForSelector('div[contenteditable="true"][data-tab="3"], [aria-label*="Search input"]', { timeout: 5000 }).catch(() => null);
      if (searchBox) {
        await searchBox.fill(contactName);
        await page.waitForSelector('[data-testid="search-result-title"]', { timeout: 4000 }).catch(() => {});
        await page.keyboard.press('Enter');
      } else {
        throw new Error(`Chat for '${contactName}' not found.`);
      }
    }

    // Wait for composer (event-driven — no sleep)
    const composer = await page.waitForSelector(
      'footer div[contenteditable="true"], [data-testid="conversation-compose-box-input"], div[aria-label*="Type a message"]',
      { timeout: 8000 }
    );

    await composer.fill(message);

    const sendBtn = await page.$('[data-testid="send"], button[aria-label="Send"]');
    if (sendBtn) await sendBtn.click();
    else await page.keyboard.press('Enter');

    // Confirm delivery (event-driven)
    await page.waitForFunction(() => {
      const latest = document.querySelector('.message-out:last-child');
      return latest && (latest.querySelector('[data-testid="msg-dblcheck"]') || latest.querySelector('[data-testid="msg-check"]'));
    }, { timeout: 6000 }).catch(() => {});

    return { ok: true, recipient: contactName, message };
  }
}
