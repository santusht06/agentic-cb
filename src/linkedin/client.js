/**
 * LinkedIn API Client — 100% Direct HTTP, Zero DOM Scraping
 *
 * Architecture:
 * - Session cookies extracted ONCE from browser profile → cached to disk.
 * - All operations use Node.js native fetch() with cached cookies.
 * - No browser is launched unless session cache is missing or expired (401).
 * - Browser = authentication environment only, never a data transport.
 */

import { getSession, invalidateSession } from '../session.js';

const PROFILE = 'linkedin';
const LI_BASE = 'https://www.linkedin.com';
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class LinkedInClient {
  constructor(options = {}) {
    this.profileName = options.profile || PROFILE;
    this._session = null;
  }

  // ─── Session ──────────────────────────────────────────────
  async _getSession(forceRefresh = false) {
    if (this._session && !forceRefresh) return this._session;
    this._session = await getSession(this.profileName, forceRefresh);
    return this._session;
  }

  // ─── Core request dispatcher ──────────────────────────────
  /**
   * All API calls go through here.
   * Automatically handles:
   *  - Cookie injection
   *  - LinkedIn CSRF token
   *  - 401 auto-retry with refreshed session
   */
  async request(endpoint, { method = 'GET', body = null, headers = {} } = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${LI_BASE}${endpoint}`;

    const buildHeaders = (s) => ({
      'User-Agent': DEFAULT_UA,
      'Accept': 'application/vnd.linkedin.normalized+json+2.1, application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': s.cookieHeader,
      'csrf-token': s.csrfToken || '',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      ...headers,
    });

    const makeRequest = async (s) => fetch(url, {
      method,
      headers: {
        ...buildHeaders(s),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    let session = await this._getSession();
    let res = await makeRequest(session);

    if (res.status === 401 || res.status === 403) {
      invalidateSession(this.profileName);
      session = await this._getSession(true);
      res = await makeRequest(session);
    }

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json')
      ? await res.json().catch(() => ({}))
      : await res.text().catch(() => '');

    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
  }

  // ─── 1. IDENTITY ──────────────────────────────────────────

  async getMe() {
    const res = await this.request('/voyager/api/me');
    if (!res.ok) throw new Error(`Failed fetching member identity [HTTP ${res.status}]`);
    return res.data;
  }

  async getProfile(usernameOrUrn) {
    if (!usernameOrUrn) return this.getMe();
    const res = await this.request(
      `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(usernameOrUrn)}`
    );
    return res.data;
  }

  // ─── 2. PROFILE VIEWERS ───────────────────────────────────

  async getViewers() {
    const res = await this.request('/voyager/api/identity/wvmpCards');
    if (!res.ok || !res.data?.elements) {
      throw new Error(`Failed fetching viewers [HTTP ${res.status}]`);
    }

    const val = Object.values(res.data.elements[0]?.value || {})[0] || {};
    const insightCards = val.insightCards || [];
    let totalViews = 0, percentChange = 0;
    const viewers = [], insights = [];

    insightCards.forEach((c) => {
      const type = Object.keys(c.value || {})[0]?.split('.').pop();
      const d = Object.values(c.value || {})[0] || {};

      if (type === 'WvmpSummaryInsightCard') {
        totalViews = d.numViews || 0;
        percentChange = d.numViewsChangeInPercentage || 0;
        (d.cards || []).forEach((sc) => {
          const cd = Object.values(sc.value || {})[0] || {};
          const fv = cd.viewer?.['com.linkedin.voyager.identity.me.FullProfileViewer'];
          if (fv?.profile?.miniProfile) {
            const p = fv.profile.miniProfile;
            viewers.push({
              name: `${p.firstName} ${p.lastName}`,
              headline: p.occupation,
              distance: fv.profile.distance?.value === 'DISTANCE_1' ? '1st' : '3rd',
              publicIdentifier: p.publicIdentifier,
            });
          } else if (cd.numViewers) {
            viewers.push({ name: 'Anonymous / Company Viewers', count: cd.numViewers, distance: 'Private' });
          }
        });
      } else if (type === 'WvmpCompanyInsightCard') {
        insights.push({ category: 'Company', count: d.extraProfileViewers || d.numViews, companyId: c.objectUrn?.match(/COMPANY,(\d+)/)?.[1] });
      } else if (type === 'WvmpSourceInsightCard') {
        insights.push({ category: 'Discovery Source', source: d.referrer?.text || 'Direct / Feed', count: d.extraProfileViewers || d.numViews });
      }
    });

    return { totalViews, percentChange, viewers, insights };
  }

  // ─── 3. CONNECTIONS ───────────────────────────────────────

  async getConnections(limit = 10) {
    const res = await this.request(`/voyager/api/relationships/connections?count=${limit}`);
    if (!res.ok) throw new Error(`Failed fetching connections [HTTP ${res.status}]`);
    return (res.data?.elements || []).map((c) => {
      const p = c.miniProfile || {};
      return {
        name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        occupation: p.occupation || '',
        publicIdentifier: p.publicIdentifier || '',
        connectedAgo: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'Connected',
      };
    });
  }

  // ─── 4. MESSAGING (Direct API — no browser) ───────────────

  async getConversations(limit = 10) {
    // 1. Modern GraphQL query (fast, direct HTTP)
    try {
      const me = await this.getMe();
      const mailboxUrn = me.data?.miniProfile?.dashEntityUrn || me.miniProfile?.dashEntityUrn;
      if (mailboxUrn) {
        const url = `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=(mailboxUrn:${encodeURIComponent(mailboxUrn)})`;
        const res = await this.request(url, { headers: { accept: 'application/graphql, application/json' } });
        const elements = res.data?.data?.messengerConversationsBySyncToken?.elements;
        if (elements && elements.length > 0) {
          return elements.slice(0, limit).map((conv) => {
            const others = (conv.conversationParticipants || [])
              .map((p) => p.participantType?.member || p.hostIdentity?.member)
              .filter((m) => m && m.distance !== 'SELF')
              .map((m) => `${m.firstName?.text || ''} ${m.lastName?.text || ''}`.trim())
              .filter(Boolean);
            const lastMsg = conv.messages?.elements?.[0];
            const snippet = lastMsg?.body?.text || lastMsg?.renderContentFallbackText || (lastMsg?.renderContent?.[0]?.hostUrnData ? '[Shared Post/Attachment]' : '');
            const time = conv.lastActivityAt ? new Date(conv.lastActivityAt).toLocaleString() : '';
            return {
              name: others.join(', ') || conv.title || 'Conversation',
              snippet,
              time,
              unread: conv.unreadCount > 0,
              entityUrn: conv.entityUrn,
            };
          });
        }
      }
    } catch {}

    // 2. Legacy fallback
    const res = await this.request('/voyager/api/messaging/conversations');
    if (res.ok && res.data?.elements) {
      return res.data.elements.slice(0, limit).map((c) => {
        const participants = (c.participants || [])
          .map((p) => {
            const mini = p['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile;
            return mini ? `${mini.firstName} ${mini.lastName}` : '';
          })
          .filter(Boolean);
        const snippet = c.events?.[0]?.['com.linkedin.voyager.messaging.event.MessageEvent']?.attributedBody?.text || '';
        return { name: participants.join(', ') || 'Conversation', snippet, unread: c.unreadCount > 0, entityUrn: c.entityUrn };
      });
    }

    throw new Error('Could not fetch conversations. Ensure LinkedIn session is valid: cb --profile linkedin login https://www.linkedin.com/login');
  }

  /**
   * Send a LinkedIn DM via direct API (no browser, no DOM).
   * Uses the voyager messaging API.
   */
  async sendMessage(recipientName, message) {
    // Step 1: Find the conversation URN for this recipient
    const convos = await this.getConversations(20);
    const convo = convos.find((c) => c.name.toLowerCase().includes(recipientName.toLowerCase()));

    if (!convo?.entityUrn) {
      throw new Error(`No active conversation found for '${recipientName}'. Start a conversation on LinkedIn first.`);
    }

    const conversationId = convo.entityUrn.replace('urn:li:fs_conversation:', '');

    // Step 2: Send the message via API
    const body = {
      eventCreate: {
        value: {
          'com.linkedin.voyager.messaging.create.MessageCreate': {
            attributedBody: { text: message, attributes: [] },
            attachments: [],
          },
        },
      },
      dedupeByClientGeneratedToken: false,
    };

    const res = await this.request(
      `/voyager/api/messaging/conversations/${encodeURIComponent(conversationId)}/events`,
      { method: 'POST', body }
    );

    if (!res.ok) throw new Error(`Message send failed [HTTP ${res.status}]`);
    return { ok: true, recipient: recipientName, message };
  }

  // ─── 5. FEED (Direct API — no browser) ────────────────────

  /**
   * Fetch LinkedIn feed via direct Voyager API call.
   * No browser launched. ~80ms response time.
   */
  async getFeed(limit = 5) {
    const res = await this.request(
      `/voyager/api/feed/updatesV2?count=${limit}&start=0&q=chronological&updateType=MEMBER_SHARE,VIRAL`
    );

    if (!res.ok) throw new Error(`Failed fetching feed [HTTP ${res.status}]`);

    const elements = res.data?.elements || [];
    return elements.slice(0, limit).map((el) => {
      const actor = el.value?.['com.linkedin.voyager.feed.Update']?.actor;
      const content = el.value?.['com.linkedin.voyager.feed.Update']?.content;
      const socialDetail = el.value?.['com.linkedin.voyager.feed.Update']?.socialDetail;

      const firstName = actor?.urn ? '' : '';
      const name = actor?.name?.text || 'Author';
      const headline = actor?.description?.text || '';
      const text = content?.article?.description?.text ||
                   content?.['com.linkedin.voyager.feed.render.LinkedInArticle']?.description?.text ||
                   el.commentary?.text?.text ||
                   el.value?.['com.linkedin.voyager.feed.Update']?.commentary?.text?.text || '';

      return {
        author: name,
        headline,
        text: text.slice(0, 300),
        likes: socialDetail?.totalSocialActivityCounts?.numLikes || 0,
        comments: socialDetail?.totalSocialActivityCounts?.numComments || 0,
      };
    });
  }

  /**
   * Create a LinkedIn post via direct API.
   */
  async createPost(text) {
    const me = await this.getMe();
    const authorUrn = me.data?.miniProfile?.entityUrn || me.miniProfile?.entityUrn;

    if (!authorUrn) throw new Error('Could not determine your member URN to post.');

    const body = {
      author: authorUrn,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {},
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    const res = await this.request('/voyager/api/contentcreation/normShares', {
      method: 'POST',
      body,
    });

    if (!res.ok) throw new Error(`Post creation failed [HTTP ${res.status}]`);
    return { ok: true, postText: text };
  }

  // ─── 6. SEARCH (Direct API — no browser) ──────────────────

  /**
   * Search LinkedIn via direct Voyager search API.
   * No browser, no page navigation. ~100ms.
   */
  async search(query, type = 'people', limit = 5) {
    const typeMap = {
      people: 'PEOPLE',
      jobs: 'JOBS',
      companies: 'COMPANIES',
      posts: 'CONTENT',
    };
    const queryType = typeMap[type.toLowerCase()] || 'PEOPLE';

    const res = await this.request(
      `/voyager/api/search/blended?count=${limit}&q=all&query=(keywords:${encodeURIComponent(query)},flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(${queryType}))))`
    );

    if (!res.ok) throw new Error(`Search failed [HTTP ${res.status}]`);

    const elements = res.data?.elements || [];
    const results = [];

    for (const el of elements) {
      const items = el.elements || [];
      for (const item of items) {
        const entity = Object.values(item.image?.attributes?.[0] || {})[0] ||
                       item['*lazyLoadedActions'] || {};
        const title = item.title?.text || '';
        const subtitle = item.primarySubtitle?.text || '';
        const secondary = item.secondarySubtitle?.text || '';
        const link = item.navigationUrl || '';
        if (title) results.push({ title, subtitle, secondary, link });
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    return results;
  }
}
