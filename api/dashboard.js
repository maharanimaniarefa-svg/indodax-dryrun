'use strict';
/**
 * GET /api/dashboard
 *
 * Laporan JSON untuk dashboard. Sumber:
 *  - results/*.json (backtest & recompute, dibundel saat deploy)
 *  - state + log dari Upstash (forward test)
 *
 * Kalau DASHBOARD_TOKEN diset, tambahkan ?token=... atau header Bearer.
 * Tanpa token, endpoint bersifat publik read-only.
 *
 *   ?section=static  -> hanya hasil backtest (payload kecil)
 *   ?section=live    -> state + log forward
 *   (kosong)         -> keduanya
 */
const { staticReport, liveReport } = require('../lib/report');
const { createStore } = require('../lib/store');

function tokenOk(req) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return true;
  const header = String(req.headers.authorization || '');
  const given = /^Bearer\s+/i.test(header)
    ? header.replace(/^Bearer\s+/i, '').trim()
    : (() => { try { return new URL(req.url, 'https://local').searchParams.get('token') || ''; } catch (e) { return ''; } })();
  return given === token;
}

async function readLive() {
  const store = createStore(process.env);
  const names = ['orders', 'equity', 'calls', 'errors', 'snapshots', 'kill'];
  const limits = { orders: 3000, equity: 3000, calls: 300, errors: 500, snapshots: 3000, kill: 100 };
  const [state, ...lists] = await Promise.all([
    store.getState(),
    ...names.map(n => store.list(n, limits[n]).catch(() => [])),
  ]);
  const out = { state };
  names.forEach((n, i) => { out[n] = lists[i]; });
  return liveReport(out);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method tidak didukung' }));
    return;
  }
  if (!tokenOk(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'token dashboard salah' }));
    return;
  }

  let section = 'all';
  try { section = new URL(req.url, 'https://local').searchParams.get('section') || 'all'; } catch (e) { /* abaikan */ }

  try {
    const base = staticReport();
    if (section === 'static') {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      res.statusCode = 200;
      res.end(JSON.stringify(base));
      return;
    }

    let live;
    try {
      live = await readLive();
    } catch (err) {
      live = {
        available: false,
        error: err.message,
        note: 'Data live tidak tersedia. Cek UPSTASH_REDIS_REST_URL/TOKEN atau STORE.',
      };
    }

    const payload = section === 'live'
      ? { meta: base.meta, config: base.config, live }
      : { ...base, live };

    res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=60, stale-while-revalidate=180');
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
  } catch (err) {
    console.error('dashboard gagal', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
