'use strict';
/**
 * POST/GET /api/kill
 *
 * Mengaktifkan atau mematikan kill switch di Redis (tanpa mengubah env).
 *   ?active=1&reason=manual      -> blokir entry baru
 *   ?active=0                    -> izinkan lagi (kecuali env KILL_SWITCH=1)
 *
 * Exit tetap berjalan saat kill switch aktif; yang diblokir hanya posisi baru.
 */
const crypto = require('crypto');
const { createStore } = require('../lib/store');

function equal(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: 'CRON_SECRET belum diset' };
  const header = String(req.headers.authorization || '');
  const given = /^Bearer\s+/i.test(header)
    ? header.replace(/^Bearer\s+/i, '').trim()
    : (() => { try { return new URL(req.url, 'https://local').searchParams.get('secret') || ''; } catch (e) { return ''; } })();
  return equal(given, secret) ? { ok: true } : { ok: false, error: 'tidak berwenang' };
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

function parseActive(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method tidak didukung' }));
    return;
  }

  const a = auth(req);
  if (!a.ok) {
    res.statusCode = a.error.includes('belum') ? 500 : 401;
    res.end(JSON.stringify({ ok: false, error: a.error }));
    return;
  }

  let url;
  try { url = new URL(req.url, 'https://local'); } catch (e) { url = new URL('https://local'); }
  const body = readBody(req);
  const rawActive = body.active !== undefined ? body.active : url.searchParams.get('active');
  const active = parseActive(rawActive);
  const reason = body.reason || url.searchParams.get('reason') || 'manual';

  try {
    const store = createStore(process.env);
    await store.setKillSwitch(active, reason);
    const envActive = ['1', 'true', 'yes', 'on'].includes(String(process.env.KILL_SWITCH || '').toLowerCase());
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      redis_kill_switch: active,
      env_kill_switch: envActive,
      effective: active || envActive,
      reason,
      note: envActive
        ? 'KILL_SWITCH=1 di environment Vercel tetap memblokir entry; ubah env untuk mematikan sepenuhnya.'
        : 'Exit tetap berjalan; hanya entry baru yang diblokir saat aktif.',
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
