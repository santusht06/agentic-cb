// Dynamic Self-Healing V8 Browser Runtime Engine

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';
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

  /**
   * Self-Healing: Clean stale SingletonLock files if no live Chrome process owns them
   */
  cleanStaleLocks() {
    if (!fs.existsSync(this.profileDir)) return;
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

    for (const file of lockFiles) {
      const p = path.join(this.profileDir, file);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  }

  async init() {
    // 1. Auto-connect to Native Chrome (port 9222) if active
    if (!this.browserContext) {
      try {
        this.browserContext = await chromium.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`, { timeout: 1000 });
        const contexts = this.browserContext.contexts();
        const defaultContext = contexts.length > 0 ? contexts[0] : this.browserContext;
        const pages = defaultContext.pages();
        this.currentPage = pages.length > 0 ? pages[0] : await defaultContext.newPage();
        this.isNativeAttached = true;
        return;
      } catch (e) {}
    }

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    // Auto-heal locks before launching
    this.cleanStaleLocks();

    if (!this.browserContext) {
      this.browserContext = await chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        channel: fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
  }

  /**
   * Universal Smart Clicker: Resolves leaf nodes, climbs to clickable containers, and emits full mouse event sequence
   */
  async smartClick(textOrSelector) {
    await this.init();

    const clicked = await this.currentPage.evaluate((query) => {
      // 1. If direct CSS selector exists
      try {
        const direct = document.querySelector(query);
        if (direct && direct.offsetWidth > 0 && direct.offsetHeight > 0) {
          direct.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          direct.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          direct.click();
          return { ok: true, matched: query };
        }
      } catch {}

      // 2. Scan leaf elements for text
      const all = Array.from(document.querySelectorAll('span, div, p, a, button, [role="button"], [role="listitem"], [role="treeitem"]'));
      const q = query.toLowerCase().trim();

      const target =
        all.find((el) => el.children.length === 0 && (el.innerText || '').trim().toLowerCase() === q && el.offsetWidth > 0) ||
        all.find((el) => (el.innerText || '').trim().toLowerCase() === q && el.offsetWidth > 0) ||
        all.find((el) => (el.innerText || '').toLowerCase().includes(q) && el.offsetWidth > 0);

      if (!target) return { ok: false };

      // Climb to nearest clickable container
      let p = target;
      while (p && !p.className.includes('ajDw2c') && !p.getAttribute('role') && p.tagName !== 'BUTTON' && p.tagName !== 'A' && p.parentElement) {
        p = p.parentElement;
      }

      const elemToClick = p || target;
      elemToClick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      elemToClick.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      elemToClick.click();
      return { ok: true, matched: target.innerText };
    }, textOrSelector);

    if (!clicked.ok) {
      throw new Error(`Element matching '${textOrSelector}' not found or not clickable`);
    }

    return clicked;
  }

  /**
   * Universal Smart Typer: Focuses rich contenteditable or input, emits hardware keyboard events, and dispatches submit
   */
  async smartType(text, { submit = true, delay = 15 } = {}) {
    await this.init();

    // 1. Locate editable
    const composer = await this.currentPage.waitForSelector(
      'div[role="textbox"].editable, div[aria-label*="History is on"], div[aria-label*="Send a message"], div[aria-label*="Type a message"], div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"], div[role="textbox"]',
      { timeout: 8000 }
    );

    if (!composer) {
      throw new Error('No interactive text composer located on active page');
    }

    await composer.focus();
    await this.currentPage.waitForTimeout(200);

    // 2. Real keyboard stream
    await this.currentPage.keyboard.type(text, { delay });
    await this.currentPage.waitForTimeout(400);

    // 3. Submit
    if (submit) {
      const sendBtn = await this.currentPage.$('button[aria-label*="Send"], button[aria-label*="send"], span[data-testid="send"]');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await this.currentPage.keyboard.press('Enter');
      }
    }

    return { ok: true, typed: text };
  }

  /**
   * Fast In-Session API Bridge
   */
  async sessionFetch(endpointOrUrl, { method = 'GET', body = null, headers = {}, origin = 'https://www.linkedin.com' } = {}) {
    await this.init();

    const currentUrl = this.currentPage.url();
    if (!currentUrl.startsWith(origin)) {
      await this.currentPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.currentPage.waitForTimeout(1500);
    }

    const result = await this.currentPage.evaluate(
      async ({ ep, m, b, h }) => {
        try {
          const defaultHeaders = {
            'x-restli-protocol-version': '2.0.0',
            'accept': 'application/vnd.linkedin.normalized+json+2.1, application/json, text/plain, */*',
            ...h,
          };

          const cookies = document.cookie.split(';');
          const jsessionCookie = cookies.find((c) => c.trim().startsWith('JSESSIONID='));
          if (jsessionCookie && !defaultHeaders['csrf-token']) {
            const csrfVal = jsessionCookie.split('=')[1].trim().replace(/^"|"$/g, '');
            defaultHeaders['csrf-token'] = csrfVal;
          }

          if (b && !defaultHeaders['Content-Type']) {
            defaultHeaders['Content-Type'] = 'application/json';
          }

          const res = await window.fetch(ep, {
            method: m,
            headers: defaultHeaders,
            body: b ? (typeof b === 'string' ? b : JSON.stringify(b)) : undefined,
          });

          const contentType = res.headers.get('content-type') || '';
          let data;
          if (contentType.includes('json')) {
            data = await res.json().catch(() => ({}));
          } else {
            data = await res.text().catch(() => '');
          }

          return { ok: res.ok, status: res.status, statusText: res.statusText, data };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },
      { ep: endpointOrUrl, m: method, b: body, h: headers }
    );

    return result;
  }

  async navigate(url, options = {}) {
    await this.init();
    const policyResult = await checkRobotsPolicy(url);

    if (!policyResult.allowed && !options.force) {
      return {
        url,
        status: POLICY_STATUS.DISALLOWED_BY_ROBOTS,
        reason: policyResult.reason,
        effectiveUrl: url,
        pageTitle: '',
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const resp = await this.currentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const durationMs = Date.now() - startTime;

    return {
      url,
      status: POLICY_STATUS.ALLOWED,
      statusCode: resp ? resp.status() : 200,
      effectiveUrl: this.currentPage.url(),
      pageTitle: await this.currentPage.title(),
      robotsPolicy: policyResult,
      durationMs,
    };
  }

  async getSemanticSnapshot() {
    await this.init();
    const snapshot = await this.currentPage.evaluate(() => {
      const interactiveElements = Array.from(
        document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]')
      );

      const items = [];
      interactiveElements.forEach((el, index) => {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
        const ref = index + 1;
        el.setAttribute('data-agent-ref', `@${ref}`);

        items.push({
          ref: `@${ref}`,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: el.innerText?.trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.value || '',
          href: el.getAttribute('href') || null,
        });
      });

      return {
        url: window.location.href,
        title: document.title,
        elements: items.slice(0, 100),
      };
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
    if (this.browserContext && !this.isNativeAttached && !this.attachCDP) {
      try {
        await this.browserContext.close();
      } catch {}
    }
    this.browserContext = null;
    this.currentPage = null;
  }
}
