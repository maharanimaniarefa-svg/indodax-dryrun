'use strict';
/** HTTP JSON dengan timeout dan retry terbatas (tidak pernah retry tanpa batas). */

const { sleep } = require('./time');

const DEFAULT_TIMEOUT_MS = 12000;
const RETRY_DELAYS_MS = [400, 1200];

async function fetchJson(url, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    headers = {},
    label = url,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'uas-algotrading-indodax-dryrun/1.0',
          ...headers,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${res.statusText} (${label}) ${body.slice(0, 180)}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(RETRY_DELAYS_MS[attempt] || 1200);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

module.exports = { fetchJson, RETRY_DELAYS_MS };
