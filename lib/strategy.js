'use strict';
/**
 * FUNGSI SINYAL TUNGGAL.
 *
 * File ini dipakai oleh:
 *   - scripts/backtest.js        (backtest 3 tahun & backtest jendela forward)
 *   - lib/bot.js -> api/tick.js  (bot live)
 *
 * Karena keduanya memanggil computeSignals() yang sama, sinyal masuk/keluar
 * candle demi candle identik secara konstruksi (bukan hasil menyalin logika).
 */

/** SMA kausal. NaN bila jendela belum penuh atau ada nilai non-finite. */
function sma(values, n) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    const ok = Number.isFinite(v);
    if (ok) sum += v; else bad++;

    if (i >= n) {
      const old = Number(values[i - n]);
      if (Number.isFinite(old)) sum -= old; else bad--;
    }
    if (i >= n - 1 && bad === 0) out[i] = sum / n;
  }
  return out;
}

/**
 * Sinyal per candle.
 * entry[s] = Close[s] > SMA_N[s] && Close[s-1] <= SMA_N[s-1] && Close[s] > SMA_X[s]
 * exit[s]  = Close[s] < SMA_X[s]
 * Sinyal hanya boleh dipakai bila candle s sudah tertutup.
 */
function computeSignals(candles, n, x) {
  const closes = candles.map(c => c.c);
  const maN = sma(closes, n);
  const maX = sma(closes, x);
  const out = new Array(candles.length);

  for (let i = 0; i < candles.length; i++) {
    const c = closes[i];
    const prevC = i > 0 ? closes[i - 1] : NaN;
    const prevN = i > 0 ? maN[i - 1] : NaN;

    const exit = Number.isFinite(c) && Number.isFinite(maX[i]) && c < maX[i];
    const entry = i > 0
      && Number.isFinite(c) && Number.isFinite(maN[i]) && Number.isFinite(maX[i])
      && Number.isFinite(prevC) && Number.isFinite(prevN)
      && c > maN[i]
      && prevC <= prevN
      && c > maX[i];

    out[i] = {
      t: candles[i].t,
      close: c,
      open: candles[i].o,
      high: candles[i].h,
      low: candles[i].l,
      volume: candles[i].v,
      maN: maN[i],
      maX: maX[i],
      entry: !!entry,
      exit: !!exit,
    };
  }
  return out;
}

/** Buang candle yang belum tertutup: Time + tf > server_time. */
function closedOnly(candles, serverTime, tfSec) {
  return candles.filter(c => c.t + tfSec <= serverTime);
}

/**
 * Validasi data sebelum dipakai. Bot tidak membuka posisi bila gagal.
 * Alasan dikembalikan lengkap agar bisa dicatat di log.
 */
function validateCandles(candles, opts) {
  const { tfSec, serverTime, minBars, maxCandleAgeBars = 2 } = opts;
  const reasons = [];
  const rows = closedOnly(candles, serverTime, tfSec);
  const last = rows[rows.length - 1] || null;

  if (!last) return { ok: false, reasons: ['tidak ada candle tertutup'], last: null, rows };

  if (last.t + tfSec > serverTime + 1) reasons.push('candle terakhir belum tertutup');

  const ageSec = serverTime - (last.t + tfSec);
  if (ageSec > maxCandleAgeBars * tfSec) {
    reasons.push(`candle tertutup terakhir terlalu tua: ${Math.round(ageSec / 60)} menit > ${maxCandleAgeBars * tfSec / 60} menit`);
  }

  if (rows.length < minBars) reasons.push(`candle kurang: ${rows.length} < ${minBars}`);

  let gaps = 0;
  const start = Math.max(1, rows.length - minBars);
  for (let i = start; i < rows.length; i++) {
    if (rows[i].t - rows[i - 1].t !== tfSec) gaps++;
  }
  if (gaps > 0) reasons.push(`ada ${gaps} candle hilang di jendela indikator`);

  for (const r of rows.slice(-3)) {
    if (!(r.o > 0 && r.h > 0 && r.l > 0 && r.c > 0)) reasons.push(`harga nol/negatif pada ${r.t}`);
    if (!(r.v > 0)) reasons.push(`volume nol pada ${r.t}`);
  }

  return { ok: reasons.length === 0, reasons, last, rows };
}

/** Median nilai transaksi harian (IDR) dalam [fromT, toT), hanya hari penuh. */
function medianDailyTurnover(candles, fromT, toT, tfSec) {
  const barsPerDay = Math.round(86400 / tfSec);
  const byDay = new Map();
  for (const c of candles) {
    if (c.t < fromT || c.t >= toT) continue;
    const day = new Date(c.t * 1000).toISOString().slice(0, 10);
    const cur = byDay.get(day) || { sum: 0, bars: 0 };
    cur.sum += c.c * c.v;
    cur.bars += 1;
    byDay.set(day, cur);
  }
  const vals = [...byDay.values()].filter(d => d.bars >= barsPerDay).map(d => d.sum);
  return { median: median(vals), days: vals.length, values: vals };
}

function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function quantile(arr, q) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** Pembulatan kuantitas ke bawah sesuai quantity_increment. */
function floorStep(value, step) {
  if (!(step > 0)) return value;
  const inv = 1 / step;
  const rounded = Math.floor(value * inv + 1e-9) / inv;
  // hindari noise floating point (mis. 0.30000000000000004)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(rounded.toFixed(Math.min(12, decimals)));
}

module.exports = {
  sma,
  computeSignals,
  closedOnly,
  validateCandles,
  medianDailyTurnover,
  median,
  quantile,
  floorStep,
};
