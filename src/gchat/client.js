// Google Chat In-Session Client Engine
// Dynamic self-healing automation for AI agents and developers

import { BrowserRuntime } from "../runtime.js";
import pc from "picocolors";
import readline from "readline";

export class GoogleChatClient {
  constructor(options = {}) {
    this.profileName = options.profile || "google";
    this.attachCDP = options.attach || false;
    this.port = options.port || 9222;
    this.runtime = null;
    this.roomCache = options.roomCache || {};
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

  async login() {
    console.log(pc.bold(pc.bgBlue(pc.white(" 💬 Google Chat Login & Pairing Session "))) + "\n");
    const runtime = await this.getRuntime(false);
    await runtime.init();
    try {
      await runtime.currentPage.goto("https://chat.google.com/app/home", { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {}

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(pc.bold(pc.yellow("\nPress Enter after login completes... ")), resolve));
    rl.close();

    console.log(pc.bold(pc.green("\n✓ Google Chat session authenticated!\n")));
    await this.close();
  }

  async ensureReady(headless = true) {
    const runtime = await this.getRuntime(headless);
    await runtime.init();

    const currentUrl = runtime.currentPage.url();
    if (!currentUrl.includes("chat.google.com") && !currentUrl.includes("mail.google.com/chat")) {
      try {
        await runtime.currentPage.goto("https://chat.google.com/app/home", { waitUntil: "domcontentloaded", timeout: 35000 });
      } catch {}
      await runtime.currentPage.waitForTimeout(3000);
    }
    return runtime;
  }

  /**
   * Universal Dynamic Message Dispatcher (Self-Healing Smart Engine)
   */
  async sendMessage(targetName, message) {
    const runtime = await this.ensureReady(true);
    const queryKey = targetName.toLowerCase().trim();
    const directUrl = this.roomCache[queryKey];

    if (directUrl && directUrl.includes("/chat/")) {
      await runtime.currentPage.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } else {
      await runtime.currentPage.goto("https://chat.google.com/app/home", { waitUntil: "domcontentloaded", timeout: 20000 });
      try {
        await runtime.smartClick(targetName);
      } catch {
        // Search fallback via New chat
        await runtime.smartClick("New chat");
        await runtime.smartType(targetName, { submit: false });
        await runtime.currentPage.waitForTimeout(1500);
        await runtime.currentPage.keyboard.press("ArrowDown");
        await runtime.currentPage.keyboard.press("Enter");
      }
    }

    // Universal Smart Type + Auto-Submit
    await runtime.smartType(message, { submit: true, delay: 15 });
    await runtime.currentPage.waitForTimeout(1000);

    return { ok: true, recipient: targetName, message };
  }

  async getConversations(limit = 10) {
    const runtime = await this.ensureReady(true);
    await runtime.currentPage.goto("https://chat.google.com/app/home", { waitUntil: "domcontentloaded", timeout: 25000 });
    await runtime.currentPage.waitForSelector(".ajDw2c, [role=\"treeitem\"], [role=\"listitem\"]", { timeout: 8000 });

    const convos = await runtime.currentPage.evaluate((max) => {
      const items = Array.from(document.querySelectorAll(".ajDw2c, [data-group-id], [role=\"treeitem\"], [role=\"listitem\"]"));
      const list = [];
      const seen = new Set();

      for (const el of items) {
        const raw = el.innerText?.trim();
        if (!raw || raw.length < 3 || !raw.includes("\n")) continue;

        const lines = raw.split("\n").map((l) => l.trim()).filter((l) => Boolean(l) && l !== "Away" && l !== "Active" && l !== "Options" && l !== "Open in a pop-up" && l !== "Press tab for more options.");
        const name = lines[0] || "";

        if (!name || seen.has(name) || name === "Direct messages" || name === "Spaces" || name === "Apps") continue;
        seen.add(name);

        const time = lines.find((l) => l === "Yesterday" || l.includes("Apr") || l.includes("May") || l.includes("Jan") || l.includes("Feb") || l.includes("Mar") || l.includes("Jun") || l.includes("Jul") || l.includes("Aug") || l.includes(":")) || "";
        const snippet = lines.find((l) => l !== name && l !== time) || "";

        list.push({ name, time, snippet: snippet.slice(0, 120), isUnread: raw.includes("unread") });
        if (list.length >= max) break;
      }

      return list;
    }, limit);

    return convos;
  }

  /**
   * Read Message History with a Contact or Space
   */
  async readMessages(targetName, limit = 10) {
    const runtime = await this.ensureReady(true);
    const queryKey = targetName.toLowerCase().trim();
    const directUrl = this.roomCache[queryKey];

    if (directUrl && directUrl.includes("/chat/")) {
      await runtime.currentPage.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } else {
      await runtime.currentPage.goto("https://chat.google.com/app/home", { waitUntil: "domcontentloaded", timeout: 20000 });
      try {
        await runtime.smartClick(targetName);
      } catch {
        await runtime.smartClick("New chat");
        await runtime.smartType(targetName, { submit: false });
        await runtime.currentPage.waitForTimeout(1500);
        await runtime.currentPage.keyboard.press("ArrowDown");
        await runtime.currentPage.keyboard.press("Enter");
      }
    }

    await runtime.currentPage.waitForTimeout(3000);

    const messages = await runtime.currentPage.evaluate((max) => {
      const msgNodes = Array.from(document.querySelectorAll("[data-message-id], [role=\"region\"], div[role=\"main\"] div[role=\"row\"], .nF6spd, .Zc1Eee"));
      const list = [];

      for (const node of msgNodes) {
        const text = node.innerText?.trim();
        if (!text || text.length < 2) continue;

        const authorEl = node.querySelector("[data-sender-name], span.FvYvyf, span.jB9Z9, div.d3071b");
        const author = authorEl?.innerText?.trim() || "Sender";

        list.push({
          author,
          text: text.slice(0, 500),
        });
      }

      return list.slice(-max);
    }, limit);

    return { target: targetName, count: messages.length, messages };
  }
}
