/**
 * Universal Session Manager
 *
 * Design principle: V8/Chrome is ONLY an authentication environment.
 * 1. `get(profile)` — returns cached session from disk (no browser).
 * 2. `extract(profile)` — launches browser ONCE, saves cookies to disk, closes browser.
 * 3. `fetch(profile, url, opts)` — makes direct HTTP call from Node.js using cached cookies.
 *    Automatically retries with fresh cookies on 401/403.
 *
 * Sessions are valid for 24 hours. After that, cookies are re-extracted headlessly.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { BrowserRuntime } from './runtime.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (auto-refreshed on 401/403)

const BASE_DIR = path.join(os.homedir(), '.v8_cli');

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function sessionPath(profileName) {
  return path.join(BASE_DIR, 'profiles', profileName, 'session.json');
}

function loadFromDisk(profileName) {
  try {
    const file = sessionPath(profileName);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.cookieHeader) return null;
    if (Date.now() - (data.savedAt || 0) > SESSION_TTL_MS) return null; // expired

    // Ensure LinkedIn always has matching JSESSIONID cookie and csrfToken
    const isLinkedIn = profileName.toLowerCase().includes('linkedin') ||
                       (data.cookies && data.cookies.some((c) => c.name === 'li_at'));
    if (isLinkedIn) {
      if (!data.csrfToken) {
        const rand = crypto.randomBytes(8).toString('hex');
        data.csrfToken = `ajax:${rand}`;
      }
      if (!data.cookieHeader.includes('JSESSIONID')) {
        data.cookieHeader = `${data.cookieHeader}; JSESSIONID="${data.csrfToken}"`;
      }
    }

    return data;
  } catch {
    return null;
  }
}

function saveToDisk(profileName, session) {
  const file = sessionPath(profileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...session, savedAt: Date.now() }, null, 2));
}

/**
 * Compute Google SAPISIDHASH for APIs that require it.
 * Used for chat.google.com internal APIs.
 */
function computeSAPIHASH(sapisid, origin = 'https://chat.google.com') {
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash('sha1')
    .update(`${ts} ${sapisid} ${origin}`)
    .digest('hex');
  return `SAPISIDHASH ${ts}_${hash}`;
}

// ─────────────────────────────────────────────────────────────
// Session extraction via headless browser (one-time)
// ─────────────────────────────────────────────────────────────

async function extractSession(profileName) {
  const runtime = new BrowserRuntime({ headless: true, profile: profileName });
  try {
    await runtime.init();
    const { cookies } = await runtime.getCookies();
    if (!cookies || cookies.length === 0) {
      throw new Error(
        `No session found for profile '${profileName}'. ` +
        `Run: cb --profile ${profileName} login <url>`
      );
    }

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // LinkedIn CSRF token
    let jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value?.replace(/^"|"$/g, '');
    const isLinkedIn = profileName.toLowerCase().includes('linkedin') ||
                       cookies.some((c) => c.name === 'li_at');
    if (isLinkedIn) {
      if (!jsession) {
        const rand = crypto.randomBytes(8).toString('hex');
        jsession = `ajax:${rand}`;
      }
      if (!cookieHeader.includes('JSESSIONID')) {
        cookieHeader = `${cookieHeader}; JSESSIONID="${jsession}"`;
      }
    }

    // Google SAPISID for SAPISID hash computation
    const sapisid = cookies.find((c) => c.name === 'SAPISID')?.value ||
                    cookies.find((c) => c.name === '__Secure-3PAPISID')?.value;

    const session = {
      cookieHeader,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
      csrfToken: jsession || null,
      sapisid: sapisid || null,
      savedAt: Date.now(),
    };

    saveToDisk(profileName, session);
    return session;
  } finally {
    await runtime.close();
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Get session for a profile.
 * Loads from disk cache first; extracts from browser only if missing/expired.
 */
export async function getSession(profileName, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadFromDisk(profileName);
    if (cached) return cached;
  }
  return extractSession(profileName);
}

/**
 * Invalidate cached session (call this on 401 responses).
 */
export function invalidateSession(profileName) {
  try {
    const file = sessionPath(profileName);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

/**
 * Universal authenticated HTTP fetch.
 *
 * Makes a direct Node.js fetch() with:
 *  - Cached session cookies (no browser launch needed)
 *  - Auto 401/403 retry with refreshed session
 *  - SAPISIDHASH header for Google APIs (when origin is google.com)
 *
 * @param {string} profileName   - Profile to load session from
 * @param {string} url           - Full URL to fetch
 * @param {object} [opts]        - fetch options (method, body, headers)
 * @returns {{ ok, status, data }}
 */
export async function sessionFetch(profileName, url, opts = {}) {
  let session = await getSession(profileName);

  const buildHeaders = (s) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': s.cookieHeader,
      ...opts.headers,
    };

    // LinkedIn CSRF
    if (url.includes('linkedin.com') && s.csrfToken) {
      headers['csrf-token'] = s.csrfToken;
      headers['x-restli-protocol-version'] = '2.0.0';
    }

    // Google SAPISID hash (required for internal Google APIs)
    if (url.includes('google.com') && s.sapisid) {
      const origin = new URL(url).origin;
      headers['Authorization'] = computeSAPIHASH(s.sapisid, origin);
      headers['X-Goog-AuthUser'] = '0';
      headers['X-Origin'] = origin;
    }

    return headers;
  };

  const doFetch = async (s) => {
    const options = {
      method: opts.method || 'GET',
      headers: buildHeaders(s),
    };
    if (opts.body) {
      options.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      options.headers['Content-Type'] = opts.headers?.['Content-Type'] || 'application/json';
    }
    return fetch(url, options);
  };

  let res = await doFetch(session);

  // Auto-refresh on auth failure
  if (res.status === 401 || res.status === 403) {
    invalidateSession(profileName);
    session = await getSession(profileName, true);
    res = await doFetch(session);
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');

  return { ok: res.ok, status: res.status, data };
}

/**
 * Get SAPISID hash string for manual use in Google API calls.
 */
export async function getGoogleAuthHeader(profileName, origin = 'https://chat.google.com') {
  const session = await getSession(profileName);
  if (!session.sapisid) return null;
  return computeSAPIHASH(session.sapisid, origin);
}
