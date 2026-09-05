// Policy Engine & Safety Guardrails for Agentic CLI Browser

import robotsParser from 'robots-parser';

export const POLICY_STATUS = {
  ALLOWED: 'ALLOWED',
  CHALLENGE_DETECTED: 'CHALLENGE_DETECTED',
  DISALLOWED_BY_ROBOTS: 'DISALLOWED_BY_ROBOTS',
  DISALLOWED_BY_USER: 'DISALLOWED_BY_USER',
};

const robotsCache = new Map();

/**
 * Check robots.txt for a given URL
 * @param {string} urlStr - Target URL
 * @param {string} userAgent - User agent string
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
export async function checkRobotsPolicy(urlStr, userAgent = 'AgentCLI/1.0') {
  try {
    const parsed = new URL(urlStr);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;

    let robots = robotsCache.get(robotsUrl);
    if (!robots) {
      const resp = await fetch(robotsUrl, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      if (resp && resp.ok) {
        const text = await resp.text();
        robots = robotsParser(robotsUrl, text);
        robotsCache.set(robotsUrl, robots);
      }
    }

    if (robots) {
      const isAllowed = robots.isAllowed(urlStr, userAgent);
      if (isAllowed === false) {
        return {
          allowed: false,
          reason: `Disallowed by /robots.txt rule on ${parsed.host}`,
        };
      }
    }

    return { allowed: true, reason: 'Allowed by robots.txt policy' };
  } catch (err) {
    return { allowed: true, reason: 'robots.txt not found or could not be fetched (default permit)' };
  }
}

/**
 * Analyze HTML and response headers for security challenges (Cloudflare, Arkose, Turnstile, CAPTCHA)
 * @param {object} params - { statusCode, html, title, headers }
 * @returns {{isChallenge: boolean, type: string, description: string}}
 */
export function detectChallenge({ statusCode, html = '', title = '', headers = {} }) {
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // 1. Cloudflare Challenge Indicators
  if (
    lowerTitle.includes('just a moment...') ||
    lowerTitle.includes('attention required! | cloudflare') ||
    lowerHtml.includes('cf-browser-verification') ||
    lowerHtml.includes('cf-challenge') ||
    lowerHtml.includes('challenge-platform') ||
    lowerHtml.includes('turnstile') ||
    (statusCode === 403 && lowerHtml.includes('cloudflare')) ||
    (statusCode === 503 && lowerHtml.includes('cloudflare'))
  ) {
    return {
      isChallenge: true,
      type: 'CLOUDFLARE_CHALLENGE',
      description: 'Cloudflare interactive bot verification / Turnstile challenge detected',
    };
  }

  // 2. Arkose Labs / FunCaptcha
  if (lowerHtml.includes('arkoselabs') || lowerHtml.includes('arkose') || lowerHtml.includes('funcaptcha')) {
    return {
      isChallenge: true,
      type: 'ARKOSE_CHALLENGE',
      description: 'Arkose Labs interactive security challenge detected',
    };
  }

  // 3. Google reCAPTCHA / hCaptcha
  if (lowerHtml.includes('g-recaptcha') || lowerHtml.includes('hcaptcha') || lowerHtml.includes('cf-turnstile')) {
    return {
      isChallenge: true,
      type: 'CAPTCHA_CHALLENGE',
      description: 'Interactive CAPTCHA verification detected on page',
    };
  }

  return { isChallenge: false, type: 'NONE', description: 'Normal page content' };
}
