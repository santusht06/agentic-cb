/**
 * V8 Browser Runtime Engine
 *
 * Design principle: This runtime is an AUTHENTICATION ENVIRONMENT, not a data transport.
 * - Use it to hold browser sessions (cookies, localStorage).
 * - Use `fetchDirect()` to make API calls from Node.js with browser cookies — no page navigation.
 * - Only use `navigate()`, `smartClick()`, `smartType()` when DOM interaction is unavoidable.
 * - All waits are event-driven (waitForSelector, waitForFunction) — no waitForTimeout().
 */

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { checkRobotsPolicy, POLICY_STATUS } from './policy.js';

export class BrowserRuntime {
  constructor(options = {}) {
    this.headless = options.headless !== undefined ? options.headless : true;
    this.profileName = options.profile || 'default';
    this.attachCDP = options.attach || false;
    this.cdpPort = options.port || 9222;
    this.baseDir = path.join(os.homedir(), '.v8_cli');
    this.profileDir = path.join(this.baseDir, 'profiles', this.profileName);
    this.snapshotFile = path.join(this.profileDir, 'snapshot.json');
    this.browserContext = null;
    this.currentPage = null;
    this.isNativeAttached = false;
  }

  cleanStaleLocks() {
    if (!fs.existsSync(this.profileDir)) return;
    for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const p = path.join(this.profileDir, file);
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
    }
  }

  async init() {
    if (this.browserContext) return;

    // 1. Try CDP attach (fastest — reuse running Chrome)
    try {
      this.browserContext = await chromium.connectOverCDP(
        `http://127.0.0.1:${this.cdpPort}`,
        { timeout: 1000 }
      );
      const contexts = this.browserContext.contexts();
      const ctx = contexts.length > 0 ? contexts[0] : this.browserContext;
      const pages = ctx.pages();
      this.currentPage = pages.length > 0 ? pages[0] : await ctx.newPage();
      this.isNativeAttached = true;
      return;
    } catch {}

    // 2. Launch persistent context
    if (!fs.existsSync(this.profileDir)) fs.mkdirSync(this.profileDir, { recursive: true });
    this.cleanStaleLocks();

    this.browserContext = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      channel: fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--lang=en-US,en',
      ],
    });

    const pages = this.browserContext.pages();
    this.currentPage = pages.length > 0 ? pages[0] : await this.browserContext.newPage();
  }

  /**
   * Extract a Cookie header string from the browser context.
   * Used to seed the session cache for direct API calls.
   */
  extractCookieHeader(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Make a direct HTTP request using Playwright's APIRequestContext.
   *
   * KEY OPTIMIZATION: `browserContext.request` sends browser cookies automatically
   * WITHOUT navigating to any page. This is equivalent to fetch() inside the page
   * but runs in Node.js — no rendering, no DOM, no waits needed.
   *
   * Use this instead of page.evaluate(fetch(...)) for all API calls.
   */
  async fetchDirect(url, { method = 'GET', body = null, headers = {} } = {}) {
    await this.init();

    const opts = { headers };
    if (body) {
      opts.data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }

    const ctx = this.browserContext;
    const res = method === 'POST'
      ? await ctx.request.post(url, opts)
      : await ctx.request.get(url, opts);

    const ct = res.headers()['content-type'] || '';
    let data;
    try {
      data = ct.includes('json') ? await res.json() : await res.text();
    } catch {
      data = {};
    }

    return { ok: res.ok(), status: res.status(), data };
  }

  /**
   * Smart text-based element clicker.
   * Scans visible leaf elements — no sleep, event-driven.
   */
  async smartClick(textOrSelector) {
    await this.init();

    const clicked = await this.currentPage.evaluate((query) => {
      try {
        const direct = document.querySelector(query);
        if (direct && direct.offsetWidth > 0) {
          direct.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          direct.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          direct.click();
          return { ok: true, matched: query };
        }
      } catch {}

      const all = Array.from(document.querySelectorAll('span, div, p, a, button, [role="button"], [role="listitem"], [role="treeitem"]'));
      const q = query.toLowerCase().trim();

      const target =
        all.find(el => el.children.length === 0 && (el.innerText || '').trim().toLowerCase() === q && el.offsetWidth > 0) ||
        all.find(el => (el.innerText || '').trim().toLowerCase() === q && el.offsetWidth > 0) ||
        all.find(el => (el.innerText || '').toLowerCase().includes(q) && el.offsetWidth > 0);

      if (!target) return { ok: false };

      let p = target;
      while (p && !p.className?.includes('ajDw2c') && !p.getAttribute('role') && p.tagName !== 'BUTTON' && p.tagName !== 'A' && p.parentElement) {
        p = p.parentElement;
      }
      const elem = p || target;
      elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      elem.click();
      return { ok: true, matched: target.innerText };
    }, textOrSelector);

    if (!clicked.ok) throw new Error(`Element '${textOrSelector}' not found or not clickable`);
    return clicked;
  }

  /**
   * Smart text input into the first available composer.
   * Uses waitForSelector (event-driven) instead of waitForTimeout.
   */
  async smartType(text, { submit = true, delay = 15 } = {}) {
    await this.init();

    const composer = await this.currentPage.waitForSelector(
      'div[role="textbox"].editable, div[aria-label*="History is on"], div[aria-label*="Send a message"], div[aria-label*="Type a message"], div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"], div[role="textbox"]',
      { timeout: 8000 }
    );

    if (!composer) throw new Error('No text composer found on active page');

    await composer.focus();
    await this.currentPage.keyboard.type(text, { delay });

    if (submit) {
      const sendBtn = await this.currentPage.$('button[aria-label*="Send"], button[aria-label*="send"], span[data-testid="send"]');
      if (sendBtn) await sendBtn.click();
      else await this.currentPage.keyboard.press('Enter');
    }

    return { ok: true, typed: text };
  }

  async navigate(url, options = {}) {
    await this.init();
    const policyResult = await checkRobotsPolicy(url);

    if (!policyResult.allowed && !options.force) {
      return {
        url, status: POLICY_STATUS.DISALLOWED_BY_ROBOTS,
        reason: policyResult.reason, effectiveUrl: url, pageTitle: '', durationMs: 0,
      };
    }

    const startTime = Date.now();
    const resp = await this.currentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return {
      url,
      status: POLICY_STATUS.ALLOWED,
      statusCode: resp ? resp.status() : 200,
      effectiveUrl: this.currentPage.url(),
      pageTitle: await this.currentPage.title(),
      robotsPolicy: policyResult,
      durationMs: Date.now() - startTime,
    };
  }

  async getSemanticSnapshot() {
    await this.init();
    const snapshot = await this.currentPage.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]'
      )).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);

      const items = els.map((el, i) => {
        el.setAttribute('data-agent-ref', `@${i + 1}`);
        return {
          ref: `@${i + 1}`,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: el.innerText?.trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.value || '',
          href: el.getAttribute('href') || null,
        };
      });

      return { url: window.location.href, title: document.title, elements: items.slice(0, 100) };
    });

    fs.writeFileSync(this.snapshotFile, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  async getCookies() {
    await this.init();
    const cookies = await this.browserContext.cookies();
    return { ok: true, count: cookies.length, cookies };
  }

  async close() {
    if (this.browserContext && !this.isNativeAttached) {
      try { await this.browserContext.close(); } catch {}
    }
    this.browserContext = null;
    this.currentPage = null;
  }
}
