// LinkedIn In-Session Direct HTTP/2 API & Automation Client
// Zero third-party scraping dependencies • Direct server API communication

import fs from "fs";
import path from "path";
import os from "os";
import { BrowserRuntime } from "../runtime.js";

export class LinkedInClient {
  constructor(options = {}) {
    this.profileName = options.profile || "linkedin";
    this.baseDir = path.join(os.homedir(), ".v8_cli");
    this.profileDir = path.join(this.baseDir, "profiles", this.profileName);
    this.sessionCacheFile = path.join(this.profileDir, "session.json");
    this.session = null;
  }

  /**
   * Initialize or retrieve cached session credentials (cookies & CSRF token)
   */
  async getSession(forceRefresh = false) {
    if (this.session && !forceRefresh) return this.session;

    if (!forceRefresh && fs.existsSync(this.sessionCacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(this.sessionCacheFile, "utf8"));
        if (cached.cookieHeader && cached.csrfToken) {
          this.session = cached;
          return this.session;
        }
      } catch {}
    }

    // Refresh from persistent context
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    const { cookies } = await runtime.getCookies();
    await runtime.close();

    if (!cookies || cookies.length === 0) {
      throw new Error(`No active LinkedIn session found for profile '${this.profileName}'. Run: cb --profile ${this.profileName} login https://www.linkedin.com/login`);
    }

    let jsession = cookies.find((c) => c.name === "JSESSIONID")?.value;
    if (!jsession) {
      jsession = '"ajax:9601853160363762136"';
    }

    const cleanCsrf = jsession.replace(/^"|"$/g, "");
    const cookieList = cookies.filter((c) => c.name !== "JSESSIONID");
    cookieList.push({ name: "JSESSIONID", value: `"${cleanCsrf}"` });

    const cookieHeader = cookieList.map((c) => `${c.name}=${c.value}`).join("; ");

    this.session = {
      cookieHeader,
      csrfToken: cleanCsrf,
      savedAt: Date.now(),
    };

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
    fs.writeFileSync(this.sessionCacheFile, JSON.stringify(this.session, null, 2));
    return this.session;
  }

  /**
   * High-Speed HTTP In-Session API Dispatcher (Direct Server Communication)
   */
  async request(endpoint, { method = "GET", body = null, headers = {} } = {}) {
    const session = await this.getSession();

    const url = endpoint.startsWith("http") ? endpoint : `https://www.linkedin.com${endpoint}`;

    const defaultHeaders = {
      "cookie": session.cookieHeader,
      "csrf-token": session.csrfToken,
      "x-restli-protocol-version": "2.0.0",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "accept": "application/vnd.linkedin.normalized+json+2.1, application/json, text/plain, */*",
      ...headers,
    };

    if (body && !defaultHeaders["Content-Type"]) {
      defaultHeaders["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers: defaultHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      const refreshedSession = await this.getSession(true);
      defaultHeaders["cookie"] = refreshedSession.cookieHeader;
      defaultHeaders["csrf-token"] = refreshedSession.csrfToken;

      const retryRes = await fetch(url, {
        method,
        headers: defaultHeaders,
        body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      });

      const retryData = await retryRes.json().catch(() => ({}));
      return { ok: retryRes.ok, status: retryRes.status, data: retryData };
    }

    const contentType = res.headers.get("content-type") || "";
    let data;
    if (contentType.includes("json")) {
      data = await res.json().catch(() => ({}));
    } else {
      data = await res.text().catch(() => "");
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      data,
    };
  }

  // --- 1. IDENTITY (Pure Server API) ---
  async getMe() {
    const res = await this.request("/voyager/api/me");
    if (!res.ok) throw new Error(`Failed fetching member identity [HTTP ${res.status}]`);
    return res.data;
  }

  async getProfile(usernameOrUrn) {
    if (!usernameOrUrn) {
      return this.getMe();
    }
    const res = await this.request(`/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(usernameOrUrn)}`);
    return res.data;
  }

  // --- 2. PROFILE VIEWERS (Pure Server API) ---
  async getViewers() {
    const res = await this.request("/voyager/api/identity/wvmpCards");
    if (!res.ok || !res.data?.elements) {
      throw new Error(`Failed fetching viewers from server [HTTP ${res.status}]`);
    }

    const val = Object.values(res.data.elements[0]?.value || {})[0] || {};
    const insightCards = val.insightCards || [];

    let totalViews = 0;
    let percentChange = 0;
    const viewers = [];
    const insights = [];

    insightCards.forEach((c) => {
      const type = Object.keys(c.value || {})[0]?.split(".").pop();
      const data = Object.values(c.value || {})[0] || {};

      if (type === "WvmpSummaryInsightCard") {
        totalViews = data.numViews || 0;
        percentChange = data.numViewsChangeInPercentage || 0;

        (data.cards || []).forEach((sc) => {
          const cardData = Object.values(sc.value || {})[0] || {};
          const fullViewer = cardData.viewer?.["com.linkedin.voyager.identity.me.FullProfileViewer"];
          if (fullViewer?.profile?.miniProfile) {
            const p = fullViewer.profile.miniProfile;
            const dist = fullViewer.profile.distance?.value === "DISTANCE_1" ? "1st" : "3rd";
            viewers.push({
              name: `${p.firstName} ${p.lastName}`,
              headline: p.occupation,
              distance: dist,
              publicIdentifier: p.publicIdentifier,
              entityUrn: p.entityUrn,
            });
          } else if (cardData.numViewers) {
            viewers.push({
              name: "Anonymous / Company Viewers",
              headline: "Multiple anonymous viewers from target industries",
              distance: "Private",
              count: cardData.numViewers,
            });
          }
        });
      } else if (type === "WvmpCompanyInsightCard") {
        const companyId = c.objectUrn?.match(/COMPANY,(d+)/)?.[1];
        insights.push({
          category: "Company",
          count: data.extraProfileViewers || data.numViews,
          companyId,
        });
      } else if (type === "WvmpSourceInsightCard") {
        insights.push({
          category: "Discovery Source",
          source: data.referrer?.text || "Direct / Feed",
          count: data.extraProfileViewers || data.numViews,
        });
      }
    });

    return {
      totalViews,
      percentChange,
      viewers,
      insights,
    };
  }

  // --- 3. CONNECTIONS & NETWORK (Pure Server API) ---
  async getConnections(limit = 10) {
    const res = await this.request(`/voyager/api/relationships/connections?count=${limit}`);
    if (!res.ok) throw new Error(`Failed fetching connections from server [HTTP ${res.status}]`);

    const elements = res.data?.elements || [];
    return elements.map((c) => {
      const p = c.miniProfile || {};
      return {
        name: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        occupation: p.occupation || "",
        publicIdentifier: p.publicIdentifier || "",
        entityUrn: p.entityUrn || "",
        connectedAgo: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "Connected",
      };
    });
  }

  // --- 4. MESSAGES ---
  async getConversations(limit = 10) {
    const res = await this.request("/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX");
    if (res.ok && res.data?.elements) {
      return res.data.elements.slice(0, limit).map((c) => {
        const participants = (c.participants || []).map((p) => {
          const mini = p["com.linkedin.voyager.messaging.MessagingMember"]?.miniProfile;
          return mini ? `${mini.firstName} ${mini.lastName}` : "";
        }).filter(Boolean);

        const lastEvent = c.events?.[0]?.["com.linkedin.voyager.messaging.event.MessageEvent"];
        const snippet = lastEvent?.attributedBody?.text || "";

        return {
          name: participants.join(", ") || "Conversation",
          snippet,
          unread: c.unreadCount > 0,
          entityUrn: c.entityUrn,
        };
      });
    }

    // Fallback: in-session query
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    try {
      await runtime.init();
      await runtime.currentPage.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 20000 });
      await runtime.currentPage.waitForTimeout(3000);

      const convos = await runtime.currentPage.evaluate((max) => {
        const items = Array.from(
          document.querySelectorAll(".msg-conversation-listitem, .msg-conversations-container__conversations-list li")
        ).slice(0, max).map((el) => {
          const name = el.querySelector(".msg-conversation-listitem__participant-names, h3")?.innerText?.trim() || "";
          const snippet = el.querySelector(".msg-overlay-list-bubble__message-snippet, p")?.innerText?.trim() || "";
          const time = el.querySelector("time, .msg-conversation-listitem__time-stamp")?.innerText?.trim() || "";
          return { name, snippet, time };
        }).filter((c) => c.name);

        return items;
      }, limit);

      return convos;
    } finally {
      await runtime.close();
    }
  }

  async sendMessage(recipient, message) {
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    try {
      await runtime.init();
      await runtime.currentPage.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 25000 });
      await runtime.currentPage.waitForTimeout(3000);

      const itemId = await runtime.currentPage.evaluate((recip) => {
        const items = Array.from(document.querySelectorAll(".msg-conversation-listitem, .msg-conversations-container__convo-item"));
        for (const item of items) {
          const name = item.querySelector(".msg-conversation-listitem__participant-names, h3")?.innerText?.trim() || "";
          if (name.toLowerCase().includes(recip.toLowerCase())) {
            return item.id;
          }
        }
        return null;
      }, recipient);

      if (!itemId) throw new Error(`Conversation for '${recipient}' not found`);

      await runtime.currentPage.click(`#${itemId}`);
      await runtime.currentPage.waitForTimeout(2000);

      const composer = await runtime.currentPage.$(".msg-form__contenteditable[contenteditable='true'], div[role='textbox']");
      if (!composer) throw new Error("Composer input not found");

      await composer.focus();
      await composer.fill(message);
      await runtime.currentPage.waitForTimeout(800);

      const sendBtn = await runtime.currentPage.$("button.msg-form__send-button");
      if (sendBtn) await sendBtn.click();
      else await runtime.currentPage.keyboard.press("Enter");

      await runtime.currentPage.waitForTimeout(2500);
      return { ok: true, recipient, message };
    } finally {
      await runtime.close();
    }
  }

  // --- 5. FEED ---
  async getFeed(limit = 5) {
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    try {
      await runtime.init();
      await runtime.currentPage.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
      await runtime.currentPage.waitForTimeout(3000);

      const posts = await runtime.currentPage.evaluate((max) => {
        const updateNodes = Array.from(document.querySelectorAll(".feed-shared-update-v2, div[data-urn*='activity']")).slice(0, max);
        return updateNodes.map((node) => {
          const author = node.querySelector(".update-components-actor__name, .feed-shared-actor__name")?.innerText?.trim() || "Author";
          const title = node.querySelector(".update-components-actor__description, .feed-shared-actor__description")?.innerText?.trim() || "";
          const text = node.querySelector(".feed-shared-update-v2__description, .update-components-text")?.innerText?.trim() || "";
          const likes = node.querySelector(".social-details-social-counts__reactions-count")?.innerText?.trim() || "0";
          const comments = node.querySelector(".social-details-social-counts__comments")?.innerText?.trim() || "0";
          return { author, title, text: text.slice(0, 300), likes, comments };
        });
      }, limit);

      return posts;
    } finally {
      await runtime.close();
    }
  }

  async createPost(text) {
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    try {
      await runtime.init();
      await runtime.currentPage.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
      await runtime.currentPage.waitForTimeout(3000);

      await runtime.smartClick("Start a post");
      await runtime.currentPage.waitForTimeout(1500);

      const editor = await runtime.currentPage.waitForSelector(".ql-editor[contenteditable='true'], div[role='textbox']", { timeout: 8000 });
      await editor.focus();
      await editor.fill(text);
      await runtime.currentPage.waitForTimeout(1000);

      const postBtn = await runtime.currentPage.waitForSelector("button.share-actions__primary-action, button.share-box-footer__primary-btn", { timeout: 5000 });
      await postBtn.click();
      await runtime.currentPage.waitForTimeout(3000);

      return { ok: true, postText: text };
    } finally {
      await runtime.close();
    }
  }

  // --- 6. SEARCH ---
  async search(query, type = "people", limit = 5) {
    const runtime = new BrowserRuntime({ headless: true, profile: this.profileName });
    try {
      await runtime.init();
      const targetUrl = `https://www.linkedin.com/search/results/${type}/?keywords=${encodeURIComponent(query)}`;
      await runtime.currentPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await runtime.currentPage.waitForTimeout(3000);

      const results = await runtime.currentPage.evaluate((max) => {
        const items = Array.from(document.querySelectorAll(".reusable-search__result-container, li.artdeco-list__item")).slice(0, max);
        return items.map((el) => {
          const titleEl = el.querySelector(".entity-result__title-text a, .app-aware-link");
          const title = titleEl?.innerText?.trim() || "";
          const link = titleEl?.getAttribute("href") || "";
          const subtitle = el.querySelector(".entity-result__primary-subtitle")?.innerText?.trim() || "";
          const secondary = el.querySelector(".entity-result__secondary-subtitle")?.innerText?.trim() || "";
          return { title, subtitle, secondary, link };
        }).filter((r) => r.title);
      }, limit);

      return results;
    } finally {
      await runtime.close();
    }
  }
}
