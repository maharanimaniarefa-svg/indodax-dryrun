'use strict';
/**
 * POST/GET /api/tick
 *
 * Dipanggil oleh Vercel Cron (GET + Authorization: Bearer CRON_SECRET) atau
 * GitHub Actions. Satu panggilan = satu tick bot dry-run.
 *
 * Keamanan:
 *  - wajib CRON_SECRET; tanpa secret endpoint menolak semua permintaan
 *  - idempoten per candle: tick berulang tidak menggandakan order
 */
const crypto = require('crypto');
const { runTick } = require('../lib/bot');
const { createStore } = require('../lib/store');

function equal(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function providedSecret(req) {
  const header = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  try {
    const url = new URL(req.url, 'https://local');
    return url.searchParams.get('secret') || '';
  } catch (err) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method tidak didukung' }));
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'CRON_SECRET belum diset di environment' }));
    return;
  }
  if (!equal(providedSecret(req), secret)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'tidak berwenang' }));
    return;
  }

  const started = Date.now();
  try {
    const store = createStore(process.env);
    const out = await runTick({ store });
    res.statusCode = 200;
    res.end(JSON.stringify({ ...out, server_ms: Date.now() - started }));
  } catch (err) {
    console.error('tick gagal', err);
    res.statusCode = 500;
    res.end(JSON.stringify({
      ok: false,
      error: err.message,
      server_ms: Date.now() - started,
      hint: 'Periksa environment UPSTASH, CRON_SECRET, dan status API Indodax.',
    }));
  }
};
