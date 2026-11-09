'use strict';
/**
 * Klien API publik Indodax (tanpa API key, tanpa login).
 * Dokumen: https://github.com/btcid/indodax-official-api-docs
 * Batas: 180 request/menit. Penarikan data historis dilakukan berurutan
 * (bukan paralel) dengan jeda, maksimal 3 request/detik.
 */
const { fetchJson } = require('./http');
const { sleep } = require('./time');

const BASE = 'https://indodax.com';
const HISTORY_URL = `${BASE}/tradingview/history_v2`;
const BARS_PER_REQUEST = 1500;     // API bisa mengirim >650 bar; loop tetap aman bila dibatasi
const REQUEST_GAP_MS = 380;        // <= 3 request/detik

async function getServerTime(opts = {}) {
  const j = await fetchJson(`${BASE}/api/server_time`, { label: 'server_time', ...opts });
  // Per 9 Nov 2026 endpoint publik mengirim MILIDETIK (mis. 1794190588758).
  // Semua perhitungan bot memakai unix detik, jadi normalisasi di sini.
  let t = Number(j && j.server_time !== undefined ? j.server_time : j);
  if (Number.isFinite(t) && t > 1e12) t = Math.floor(t / 1000);
  return t;
}

/** Array metadata semua pasangan (450 pair). API kadang membungkus {value:[...]}. */
async function getPairs(opts = {}) {
  const j = await fetchJson(`${BASE}/api/pairs`, { label: 'pairs', ...opts });
  if (Array.isArray(j)) return j;
  return j.value || j.pairs || [];
}

async function getPairsById() {
  const list = await getPairs();
  const out = {};
  for (const p of list) out[p.id] = p;
  return out;
}

/** { btc_idr: "1000", ... } kenaikan harga minimum per pasangan. */
async function getPriceIncrements() {
  const j = await fetchJson(`${BASE}/api/price_increments`, { label: 'price_increments', retries: 3 });
  return j.increments || {};
}

async function getTickerAll() {
  const j = await fetchJson(`${BASE}/api/ticker_all`, { label: 'ticker_all' });
  return j.tickers || {};
}

/** Order book. Level: [harga, kuantitas] sebagai number, sudah diurut terbaik dulu. */
async function getDepth(tickerId, opts = {}) {
  // API depth memakai id pair tanpa garis bawah (btcidr), bukan ticker_id (btc_idr).
  const id = String(tickerId || '').toLowerCase().replace(/_/g, '');
  const j = await fetchJson(`${BASE}/api/depth/${id}`, { label: `depth/${id}`, ...opts });
  const map = levels => (Array.isArray(levels) ? levels : [])
    .map(([p, q]) => [Number(p), Number(q)])
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
  const buy = map(j.buy).sort((a, b) => b[0] - a[0]);
  const sell = map(j.sell).sort((a, b) => a[0] - b[0]);
  return { buy, sell, fetchedAt: Math.floor(Date.now() / 1000) };
}

function normalizeHistory(j) {
  const rows = Array.isArray(j) ? j : (j && j.value) || [];
  const out = [];
  for (const r of rows) {
    const t = Number(r.Time);
    const o = Number(r.Open);
    const h = Number(r.High);
    const l = Number(r.Low);
    const c = Number(r.Close);
    const v = Number(r.Volume);
    if ([t, o, h, l, c, v].every(Number.isFinite) && t > 0) out.push({ t, o, h, l, c, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Satu request history_v2. */
async function getHistory(symbol, tf, from, to, opts = {}) {
  const url = `${HISTORY_URL}?symbol=${encodeURIComponent(symbol)}&tf=${tf}&from=${from}&to=${to}`;
  const j = await fetchJson(url, { label: `history/${symbol}`, ...opts });
  return normalizeHistory(j);
}

/**
 * Tarik candle mundur sampai startSec. Satu request hanya +/- 650 bar,
 * jadi to digeser ke bar paling awal yang sudah didapat lalu diulang.
 * Dijalankan serial dengan jeda agar tidak diblokir.
 */
async function fetchHistoryBackward(symbol, { tf, tfSec, startSec, endSec, onProgress } = {}) {
  const barSec = tfSec || (tf === '1D' ? 86400 : tf * 60);
  const byTime = new Map();
  let to = endSec;
  let requests = 0;
  let guard = 0;

  while (to > startSec && guard < 200) {
    guard++;
    const span = BARS_PER_REQUEST * barSec;
    const from = Math.max(startSec, to - span);
    const rows = await getHistory(symbol, tf, from, to);
    requests++;

    let added = 0;
    for (const r of rows) {
      if (r.t >= startSec && r.t <= endSec && !byTime.has(r.t)) {
        byTime.set(r.t, r);
        added++;
      }
    }
    if (onProgress) onProgress({ symbol, requests, got: byTime.size, from, to, added });
    if (rows.length === 0) break;

    const earliest = rows[0].t;
    if (earliest <= startSec) break;
    const nextTo = earliest - 1;
    if (nextTo >= to) break;          // tidak ada kemajuan
    to = nextTo;
    if (rows.length < BARS_PER_REQUEST) {
      // kemungkinan sudah mentok di awal data pair; lanjut satu kali lagi
      if (to <= startSec) break;
    }
    await sleep(REQUEST_GAP_MS);
  }

  const data = [...byTime.values()].sort((a, b) => a.t - b.t);
  return { data, requests };
}

/** Ringkas metadata pair dari /api/pairs + /api/price_increments. */
function pairMeta(pair, increments) {
  const inc = Number(increments[pair.ticker_id]);
  return {
    id: pair.id,
    symbol: pair.symbol,
    ticker: pair.ticker_id,
    base: pair.traded_currency_unit,
    description: pair.description,
    qtyStep: Number(pair.quantity_increment) || 1e-8,
    priceStep: Number.isFinite(inc) && inc > 0 ? inc : 1,
    apiMinOrderIdr: Number(pair.trade_min_base_currency) || 0,
    takerPercentApi: Number(pair.trade_fee_percent_taker) || 0,
    maintenance: Number(pair.is_maintenance) === 1,
    suspended: Number(pair.is_market_suspended) === 1,
  };
}

module.exports = {
  BASE,
  BARS_PER_REQUEST,
  REQUEST_GAP_MS,
  getServerTime,
  getPairs,
  getPairsById,
  getPriceIncrements,
  getTickerAll,
  getDepth,
  getHistory,
  fetchHistoryBackward,
  pairMeta,
};
