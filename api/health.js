'use strict';
/**
 * GET /api/health
 *
 * Status ringkas untuk monitoring: koneksi store, umur tick terakhir,
 * kill switch, dan kelengkapan environment. Tidak menampilkan nilai secret.
 */
const { createStore } = require('../lib/store');
const cfg = require('../lib/config');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method tidak didukung' }));
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const env = {
    cron_secret: !!process.env.CRON_SECRET,
    upstash_url: !!process.env.UPSTASH_REDIS_REST_URL,
    upstash_token: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    store: process.env.STORE || 'upstash',
  };

  let storeOk = false;
  let state = null;
  let killRedis = false;
  let storeError = null;
  try {
    const store = createStore(process.env);
    state = await store.getState();
    killRedis = await store.getKillSwitch();
    storeOk = true;
  } catch (err) {
    storeError = err.message;
  }

  const envKill = ['1', 'true', 'yes', 'on'].includes(String(process.env.KILL_SWITCH || '').toLowerCase());
  const lastTickSec = state?.lastTick ? Date.parse(state.lastTick.at) / 1000 : null;
  const age = lastTickSec ? now - lastTickSec : null;
  const inWindow = now >= cfg.forwardStart && now <= cfg.forwardEnd;
  const stale = inWindow ? (age == null || age > 6 * 3600) : false;
  const ok = storeOk && env.cron_secret && !stale && (!inWindow || env.upstash_url);

  res.statusCode = ok ? 200 : 503;
  res.end(JSON.stringify({
    ok,
    at: new Date(now * 1000).toISOString(),
    phase: now < cfg.forwardStart ? 'belum_mulai' : now > cfg.forwardEnd ? 'selesai' : 'berjalan',
    store_ok: storeOk,
    store_error: storeError,
    env,
    kill_switch: { env: envKill, redis: killRedis, effective: envKill || killRedis },
    last_tick: state?.lastTick || null,
    last_tick_age_sec: age,
    stale,
    forward: { start: cfg.F.forward_start_candle_utc, end: cfg.F.forward_end_utc },
    counters: state?.counters || null,
  }));
};
