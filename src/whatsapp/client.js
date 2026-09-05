// WhatsApp Web In-Session Agent Client (V8 Runtime Engine)

import { BrowserRuntime } from '../runtime.js';
import pc from 'picocolors';
import readline from 'readline';

export class WhatsAppClient {
  constructor(options = {}) {
    this.profileName = options.profile || 'whatsapp';
    this.attachCDP = options.attach || false;
    this.port = options.port || 9222;
    this.runtime = null;
  }

  async getRuntime(headless = true) {
    if (!this.runtime) {
      this.runtime = new BrowserRuntime({
        headless,
        profile: this.profileName,
        attach: this.attachCDP,
        port: this.port,
      });
    }
    return this.runtime;
  }

  async close() {
    if (this.runtime) {
      await this.runtime.close();
      this.runtime = null;
    }
  }

  /**
   * Pair / Authenticate with WhatsApp Web (One-time QR scan)
   */
  async login() {
    console.log(pc.bold(pc.bgGreen(pc.black(' 📱 WhatsApp Web QR Pairing Session '))) + '\n');
    console.log(pc.cyan('1. Opening WhatsApp Web in visible browser window...'));
    console.log(pc.dim('Scan the QR code with WhatsApp on your phone (Linked Devices).\n'));

    const runtime = await this.getRuntime(false);
    await runtime.init();
    await runtime.currentPage.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(pc.bold(pc.yellow('Press Enter after your chats load in the browser... ')), resolve));
    rl.close();

    await runtime.currentPage.waitForTimeout(3000);
    console.log(pc.bold(pc.green('\n✓ WhatsApp Web session paired and saved to profile: ' + this.profileName + '\n')));
    await this.close();
  }

  /**
   * Ensure WhatsApp Web is loaded and authenticated
   */
  async ensureReady(headless = true) {
    const runtime = await this.getRuntime(headless);
    await runtime.init();

    const currentUrl = runtime.currentPage.url();
    if (!currentUrl.includes('web.whatsapp.com')) {
      await runtime.currentPage.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await runtime.currentPage.waitForTimeout(5000);
    }

    // Check if logged in (search bar or pane-side is present)
    const isReady = await runtime.currentPage.evaluate(() => {
      const pane = document.querySelector('#pane-side, [data-testid="chat-list"], div[aria-label*="Chat list"], div[contenteditable="true"]');
      const qr = document.querySelector('canvas[aria-label*="Scan"], div[data-ref]');
      return { authenticated: !!pane && !qr, qrPresent: !!qr };
    });

    if (isReady.qrPresent && !isReady.authenticated) {
      throw new Error("WhatsApp Web is not authenticated. Run 'cb wa login' to pair your device via QR code.");
    }

    return runtime;
  }

  /**
   * List Recent Chats & Unread counts
   */
  async getChats(limit = 10) {
    const runtime = await this.ensureReady(true);

    const chats = await runtime.currentPage.evaluate((max) => {
      const chatElements = Array.from(
        document.querySelectorAll(
          '#pane-side div[role="listitem"], #pane-side > div > div > div > div, div[data-testid="cell-frame-container"]'
        )
      );

      const list = [];
      const seen = new Set();

      for (const el of chatElements) {
        const titleEl = el.querySelector('span[title], div[role="gridcell"] span[dir="auto"], span.x1iyjqo2');
        const name = titleEl?.getAttribute('title') || titleEl?.innerText?.trim() || '';

        if (!name || seen.has(name)) continue;
        seen.add(name);

        const snippetEl = el.querySelector('span[dir="ltr"], div.x1n2onr6 span, span.x1lliihq');
        const snippet = snippetEl?.innerText?.trim() || '';

        const timeEl = el.querySelector('div.x1rg5ohu, div.x1c4vz4f, time');
        const time = timeEl?.innerText?.trim() || '';

        const unreadEl = el.querySelector('span[aria-label*="unread"], span.x17ffhyw, div.x126k92a');
        const unreadCount = unreadEl ? parseInt(unreadEl.innerText.trim(), 10) || 1 : 0;

        list.push({
          name,
          snippet: snippet.slice(0, 120),
          time,
          unreadCount,
          isUnread: unreadCount > 0,
        });

        if (list.length >= max) break;
      }

      return list;
    }, limit);

    return chats;
  }

  /**
   * Get Only Unread Chats
   */
  async getUnread() {
    const chats = await this.getChats(30);
    return chats.filter((c) => c.isUnread);
  }

  /**
   * Read Conversation History with a Contact
   */
  async readMessages(contactName, limit = 10) {
    const runtime = await this.ensureReady(true);

    // 1. Search and click contact in chat list
    const found = await runtime.currentPage.evaluate((nameQuery) => {
      const chatItems = Array.from(document.querySelectorAll('#pane-side div[role="listitem"], #pane-side span[title]'));
      for (const item of chatItems) {
        const title = item.getAttribute('title') || item.innerText || '';
        if (title.toLowerCase().includes(nameQuery.toLowerCase())) {
          item.click();
          return { ok: true, matchedName: title };
        }
      }
      return { ok: false };
    }, contactName);

    if (!found.ok) {
      // Try searching via the top search bar
      const searchBox = await runtime.currentPage.$('div[contenteditable="true"][data-tab="3"], div[aria-label*="Search"]');
      if (searchBox) {
        await searchBox.focus();
        await searchBox.fill(contactName);
        await runtime.currentPage.waitForTimeout(2000);
        await runtime.currentPage.keyboard.press('Enter');
        await runtime.currentPage.waitForTimeout(2000);
      } else {
        throw new Error(`Chat for '${contactName}' not found in active list`);
      }
    }

    await runtime.currentPage.waitForTimeout(2500);

    // Extract message bubbles from active conversation panel
    const messages = await runtime.currentPage.evaluate((max) => {
      const bubbles = Array.from(
        document.querySelectorAll('div.message-in, div.message-out, div[data-testid="msg-container"]')
      ).slice(-max);

      return bubbles.map((b) => {
        const isOutgoing = b.classList.contains('message-out') || b.querySelector('[data-testid="tail-out"]') !== null;
        const textEl = b.querySelector('.copyable-text span, span.selectable-text, div.x12l9306');
        const text = textEl?.innerText?.trim() || '';
        const timeEl = b.querySelector('div.x1rg5ohu, div[data-pre-plain-text]');
        const rawTime = b.querySelector('div[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
        const time = timeEl?.innerText?.trim() || '';

        return {
          sender: isOutgoing ? 'You' : 'Contact',
          text,
          time: rawTime || time,
          outgoing: isOutgoing,
        };
      }).filter((m) => m.text);
    }, limit);

    return { contact: contactName, count: messages.length, messages };
  }

  /**
   * Send WhatsApp Direct Message
   */
  async sendMessage(contactName, message) {
    const runtime = await this.ensureReady(true);

    // 1. Select contact
    const found = await runtime.currentPage.evaluate((nameQuery) => {
      const chatItems = Array.from(document.querySelectorAll('#pane-side div[role="listitem"], #pane-side span[title]'));
      for (const item of chatItems) {
        const title = item.getAttribute('title') || item.innerText || '';
        if (title.toLowerCase().includes(nameQuery.toLowerCase())) {
          item.click();
          return { ok: true, matchedName: title };
        }
      }
      return { ok: false };
    }, contactName);

    if (!found.ok) {
      // Search via search input
      const searchBox = await runtime.currentPage.$('div[contenteditable="true"][data-tab="3"], div[aria-label*="Search"]');
      if (searchBox) {
        await searchBox.focus();
        await searchBox.fill(contactName);
        await runtime.currentPage.waitForTimeout(2000);
        await runtime.currentPage.keyboard.press('Enter');
        await runtime.currentPage.waitForTimeout(2000);
      } else {
        throw new Error(`Chat for '${contactName}' not found in active list`);
      }
    }

    await runtime.currentPage.waitForTimeout(2500);

    // 2. Locate message input box
    const composer = await runtime.currentPage.$(
      'footer div[contenteditable="true"], div[data-testid="conversation-compose-box-input"], div[aria-label*="Type a message"]'
    );

    if (!composer) {
      throw new Error('Message composer input not found in active chat');
    }

    // 3. Fill and send
    await composer.focus();
    await composer.fill(message);
    await runtime.currentPage.waitForTimeout(600);

    const sendBtn = await runtime.currentPage.$('span[data-testid="send"], button[aria-label="Send"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await runtime.currentPage.keyboard.press('Enter');
    }

    await runtime.currentPage.waitForTimeout(2000);
    return { ok: true, recipient: contactName, message };
  }
}
