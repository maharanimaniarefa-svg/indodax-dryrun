'use strict';
/**
 * Penyusun laporan untuk dashboard.
 *
 * Sumber data:
 *  - results/backtest_*.json  : hasil backtest (dibuat scripts/backtest.js)
 *  - results/recompute.json   : hasil audit hitung ulang (scripts/recompute.js)
 *  - config/frozen.json       : parameter beku
 *  - state + log dari store   : data forward test (Upstash atau file)
 *
 * Tidak ada angka yang diketik manual di dashboard: semua dihitung dari
 * artefak di atas.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const ds = require('./dataset');
const { readJson } = require('./csv');
const { summarize } = require('./metrics');
const { isoUtc } = require('./time');

const REPORT_VERSION = 1;

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (err) {
    return null;
  }
}

/** Hash gabungan file yang menentukan sinyal & aturan. */
function freezeHash() {
  const files = [
    'config/frozen.json',
    'config/universe.json',
    'lib/strategy.js',
    'lib/backtest.js',
    'lib/bot.js',
    'lib/fill.js',
    'lib/metrics.js',
  ];
  const h = crypto.createHash('sha256');
  const perFile = {};
  for (const rel of files) {
    const abs = path.join(ds.ROOT, rel);
    const digest = sha256File(abs);
    perFile[rel] = digest;
    h.update(rel + ':' + (digest || 'missing') + '\n');
  }
  return { aggregate: h.digest('hex'), files: perFile };
}

function downsample(rows, max = 800) {
  if (!Array.isArray(rows) || rows.length <= max) return rows || [];
  const out = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)]);
  return out;
}

function midOf(o) {
  const b = Number(o.bestBid);
  const a = Number(o.bestAsk);
  if (b > 0 && a > 0) return (a + b) / 2;
  return Number(o.fillPrice) || 0;
}

/**
 * Rekonstruksi trade dari log order mentah (BUY/SELL).
 * Bot hanya memegang satu posisi per simbol, tetapi partial exit tetap
 * didukung dengan pembagian proporsional.
 */
function deriveTradesFromOrders(orders) {
  const sorted = [...(orders || [])]
    .filter(o => o && (o.side === 'BUY' || o.side === 'SELL') && Number(o.qty) > 0)
    .sort((a, b) => (Number(a.serverTime) || 0) - (Number(b.serverTime) || 0));
  const open = new Map();
  const trades = [];

  for (const o of sorted) {
    const sym = o.symbol;
    const st = open.get(sym) || null;
    if (o.side === 'BUY') {
      const mid = midOf(o);
      const base = st || {
        qty: 0,
        cost: 0,
        fee: 0,
        entryTime: o.serverTime,
        entrySignalTime: o.candleTime,
        entrySignalPrice: o.signalPrice,
        entryMid: mid,
        entrySpreadPct: Number.isFinite(o.spreadPct) ? o.spreadPct : 0,
      };
      base.qty += Number(o.qty);
      base.cost += Number(o.notional);
      base.fee += Number(o.fee);
      base.entryFill = base.cost / base.qty;
      open.set(sym, base);
      continue;
    }

    if (!st || !(st.qty > 0)) continue;              // SELL tanpa posisi: tidak dihitung
    const qty = Math.min(Number(o.qty), st.qty);
    const share = qty / st.qty;
    const entryBase = st.cost * share;
    const entryFee = st.fee * share;
    const entryFill = entryBase / qty;
    const exitMid = midOf(o);
    const exitFill = Number(o.fillPrice);
    const fees = entryFee + Number(o.fee) * share;
    const netPnl = Number.isFinite(o.realizedPnl)
      ? Number(o.realizedPnl) * share
      : (Number(o.notional) - Number(o.fee)) * share - entryBase - entryFee;
    const grossPnl = (exitMid - st.entryMid) * qty;
    const costs = grossPnl - netPnl;

    const entrySpread = Number.isFinite(st.entrySpreadPct) ? st.entrySpreadPct : 0;
    const exitSpread = Number.isFinite(o.spreadPct) ? o.spreadPct : 0;
    const spreadCost = qty * st.entryMid * entrySpread / 2 + qty * exitMid * exitSpread / 2;
    const execCost = qty * Math.max(0, entryFill - st.entryMid) + qty * Math.max(0, exitMid - exitFill);
    const slippageCost = Math.max(0, execCost - spreadCost);

    trades.push({
      symbol: sym,
      entryTime: st.entryTime,
      exitTime: o.serverTime,
      entrySignalTime: st.entrySignalTime,
      exitSignalTime: o.candleTime,
      entrySignalPrice: st.entrySignalPrice,
      exitSignalPrice: o.signalPrice,
      entryMid: st.entryMid,
      exitMid,
      entryFill,
      exitFill,
      qty,
      entryNotional: entryBase,
      exitNotional: Number(o.notional) * share,
      fees,
      spreadCost,
      slippageCost,
      otherCost: costs - fees - spreadCost - slippageCost,
      costs,
      grossPnl,
      netPnl,
      returnPct: entryBase + entryFee > 0 ? netPnl / (entryBase + entryFee) : 0,
      exitReason: o.reason || 'exit',
      orderId: o.id || null,
    });

    if (qty >= st.qty - 1e-12) open.delete(sym);
    else {
      st.qty -= qty;
      st.cost -= entryBase;
      st.fee -= entryFee;
    }
  }
  trades.sort((a, b) => a.exitTime - b.exitTime);
  return trades;
}

function costBreakdownOf(trades) {
  const sum = key => (trades || []).reduce((a, t) => a + (Number(t[key]) || 0), 0);
  return {
    fees: sum('fees'),
    spread: sum('spreadCost'),
    slippage: sum('slippageCost'),
    other: sum('otherCost'),
    total: sum('costs'),
  };
}

/** Ringkas alasan sinyal yang dilewati agar mudah diaudit. */
function summarizeSkipped(skipped) {
  const byReason = {};
  for (const s of skipped || []) {
    const key = String(s.reason || 'lainnya').replace(/Rp[\d.,]+/g, 'Rp…').slice(0, 90);
    byReason[key] = (byReason[key] || 0) + 1;
  }
  return {
    count: (skipped || []).length,
    by_reason: Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    sample: (skipped || []).slice(0, 25),
  };
}

function staticReport() {
  const summary = readJson(path.join(ds.RESULTS_DIR, 'backtest_summary.json'), null);
  const full = readJson(path.join(ds.RESULTS_DIR, 'backtest_full.json'), null);
  const fwd = readJson(path.join(ds.RESULTS_DIR, 'backtest_forward.json'), null);
  const recompute = readJson(path.join(ds.RESULTS_DIR, 'recompute.json'), null);
  const spread = readJson(path.join(ds.DATA_DIR, 'spread.json'), null);
  const meta = readJson(path.join(ds.DATA_DIR, 'meta.json'), null);
  const hash = freezeHash();

  const backtest = full ? {
    window: { start: full.startTime || full.window?.start, end: full.endTime || full.window?.end },
    metrics: summary?.backtest?.metrics || null,
    benchmark: summary?.backtest?.benchmark || null,
    monthly_returns: summary?.backtest?.monthly_returns || [],
    cost_breakdown: summary?.backtest?.cost_breakdown || costBreakdownOf(full.trades),
    open_positions: full.open_positions || [],
    trades: full.trades || [],
    equity: downsample(full.equity, 900),
    orders: (full.orders || []).slice(-400),
    skipped: summarizeSkipped(full.skipped),
  } : null;

  const forwardBacktest = fwd ? {
    window: { start: fwd.startTime || fwd.window?.start, end: fwd.endTime || fwd.window?.end },
    metrics: summary?.forward_backtest?.metrics || null,
    benchmark: summary?.forward_backtest?.benchmark || null,
    cost_breakdown: summary?.forward_backtest?.cost_breakdown || costBreakdownOf(fwd.trades),
    open_positions: fwd.open_positions || [],
    trades: fwd.trades || [],
    equity: downsample(fwd.equity, 900),
    skipped: summarizeSkipped(fwd.skipped),
  } : null;

  return {
    meta: {
      report_version: REPORT_VERSION,
      generated_at: new Date().toISOString(),
      student: cfg.F.student,
      strategy: cfg.F.strategy.name,
      parameter_version: cfg.F.version,
      timeframe: cfg.tfLabel,
      frozen_at_wib: cfg.F.frozen_at_wib,
      forward_start_utc: cfg.F.forward_start_candle_utc,
      forward_end_utc: cfg.F.forward_end_utc,
      freeze_hash: hash.aggregate,
      freeze_hash_files: hash.files,
      data_fetched_at: meta?.fetched_at || null,
      spread_source: spread
        ? { generated_at: spread.generated_at, method: spread.method, samples: spread.samples, notional_idr: spread.notional_idr }
        : null,
    },
    config: {
      capital_idr: cfg.capital,
      max_positions: cfg.maxPositions,
      alloc_pct: cfg.allocPct,
      daily_loss_limit_pct: cfg.dailyLossLimitPct,
      min_order_idr: cfg.minOrderIdr,
      max_spread_pct: cfg.maxSpreadPct,
      max_fill_slippage_pct: cfg.maxFillSlippagePct,
      liquidity_cap_pct: cfg.liquidityCapPct,
      max_candle_age_bars: cfg.maxCandleAgeBars,
      fees: cfg.F.fees,
      min_order_source: cfg.F.min_order_source,
      benchmark_symbol: cfg.benchSymbol,
      universe: cfg.UNIVERSE,
    },
    backtest,
    forward_backtest: forwardBacktest,
    spread: spread ? {
      generated_at: spread.generated_at,
      method: spread.method,
      samples: spread.samples,
      notional_idr: spread.notional_idr,
      source_file: spread.source_file,
      pairs: spread.pairs,
    } : null,
    recompute,
    artifacts: [
      { name: 'Ringkasan backtest', file: 'data/backtest_summary.json', desc: 'metrik utama 3 tahun + jendela forward' },
      { name: 'Trade backtest', file: 'data/backtest_trades.csv', desc: 'satu baris per trade, termasuk biaya' },
      { name: 'Ekuitas backtest', file: 'data/backtest_equity.csv', desc: 'kurva ekuitas per candle 4 jam' },
      { name: 'Sinyal backtest', file: 'data/backtest_signals.csv', desc: 'audit sinyal entry/exit per candle' },
      { name: 'Order forward', file: 'data/live_orders.csv', desc: 'order bot dry-run (bid/ask nyata)' },
      { name: 'Ekuitas forward', file: 'data/live_equity.csv', desc: 'mark-to-market tiap tick' },
      { name: 'Hitung ulang', file: 'data/recompute.json', desc: 'hasil audit independen + status check' },
      { name: 'Manifest freeze', file: 'data/freeze_manifest.json', desc: 'SHA-256 file aturan & data' },
    ],
  };
}

function callCandleTime(call) {
  const st = Number(call?.serverTime);
  if (!Number.isFinite(st)) return null;
  // Candle terakhir yang sudah tertutup pada serverTime.
  return Math.floor(st / cfg.tfSec) * cfg.tfSec - cfg.tfSec;
}

/**
 * Coverage dihitung dari candle yang benar-benar diproses di log `calls`,
 * bukan hanya dari state.lastProcessed. Ini penting jika deployment molor:
 * bot hanya memproses candle terbaru, sehingga candle awal jendela hilang.
 * lastProcessed saja akan membuat coverage terlihat 100% padahal tidak.
 *
 * Fallback ke lastProcessed hanya bila log calls belum tersedia (mis. laporan
 * offline lama tanpa export).
 */
function progressOf(state, nowSec, calls = []) {
  const symbols = cfg.SYMBOLS;
  const start = cfg.forwardStart;
  const end = Math.min(nowSec || cfg.forwardEnd, cfg.forwardEnd);
  const expected = Math.max(0, Math.floor((end - start) / cfg.tfSec));
  const firstSlot = start;

  const seen = new Map(symbols.map(sym => [sym, new Set()]));
  let firstTick = null;
  let lastTick = null;
  for (const call of Array.isArray(calls) ? calls : []) {
    const t = callCandleTime(call);
    if (!Number.isFinite(t) || t < firstSlot || t > end) continue;
    const st = Number(call.serverTime);
    if (Number.isFinite(st)) {
      if (firstTick === null || st < firstTick) firstTick = st;
      if (lastTick === null || st > lastTick) lastTick = st;
    }
    for (const sym of call.processed || []) {
      if (seen.has(sym)) seen.get(sym).add(t);
    }
    for (const sig of call.signals || []) {
      if (seen.has(sig.symbol) && Number.isFinite(Number(sig.candleTime))) {
        const ct = Number(sig.candleTime);
        if (ct >= firstSlot && ct <= end) seen.get(sig.symbol).add(ct);
      }
    }
  }
  const hasLogCoverage = Array.from(seen.values()).some(set => set.size > 0);
  const perSymbol = {};
  let done = 0;
  for (const sym of symbols) {
    const last = state?.lastProcessed?.[sym];
    let n;
    let method;
    if (hasLogCoverage) {
      n = Math.min(expected, seen.get(sym).size);
      method = 'calls';
    } else {
      // Fallback: contiguous dari candle pertama jendela.
      n = Number.isFinite(last)
        ? Math.max(0, Math.min(expected, Math.floor((last - start) / cfg.tfSec) + 1))
        : 0;
      method = 'lastProcessed';
    }
    perSymbol[sym] = {
      lastProcessed: Number.isFinite(last) ? isoUtc(last) : null,
      processed: n,
      expected,
      method,
    };
    if (expected > 0) done += n / expected;
  }
  return {
    expected_candles: expected,
    coverage_pct: symbols.length && expected > 0 ? done / symbols.length : 0,
    per_symbol: perSymbol,
    started: expected > 0,
    method: hasLogCoverage ? 'calls' : 'lastProcessed',
    first_tick_utc: firstTick === null ? null : isoUtc(firstTick),
    last_tick_utc: lastTick === null ? null : isoUtc(lastTick),
    window_start_utc: cfg.F.forward_start_candle_utc,
    window_end_utc: cfg.F.forward_end_utc,
  };
}

/**
 * live = { state, orders, equity, calls, errors, snapshots, kill }
 * Array log diharapkan urut lama -> baru (seperti keluaran store.list).
 */
function liveReport({ state, orders, equity, calls, errors, snapshots, kill }, nowSec = Math.floor(Date.now() / 1000)) {
  const arr = x => (Array.isArray(x) ? x : []);
  const eq = arr(equity).filter(e => e && Number.isFinite(e.t) && Number.isFinite(e.equity));
  const od = arr(orders);
  const trades = deriveTradesFromOrders(od);
  const metrics = eq.length >= 2 ? summarize(eq.map(e => ({ t: e.t, equity: e.equity })), trades, { initialCapital: cfg.capital }) : null;
  const last = eq[eq.length - 1] || null;
  const lastTick = state?.lastTick || null;
  const lastTs = last?.serverTime || last?.t || (lastTick ? Date.parse(lastTick.at) / 1000 : null);
  const nextCandle = Math.floor(nowSec / cfg.tfSec) * cfg.tfSec + cfg.tfSec;
  const available = !!(state || eq.length || od.length);
  const phase = nowSec < cfg.forwardStart
    ? 'belum_mulai'
    : !available
      ? 'belum_ada_data'
      : nowSec > cfg.forwardEnd
        ? 'selesai'
        : 'berjalan';

  return {
    available,
    window: { start: cfg.F.forward_start_candle_utc, end: cfg.F.forward_end_utc },
    phase,
    now_utc: new Date(nowSec * 1000).toISOString(),
    last_tick_age_sec: lastTs ? Math.max(0, nowSec - lastTs) : null,
    next_candle_close_utc: new Date(nextCandle * 1000).toISOString(),
    progress: progressOf(state, nowSec, calls),
    state: state ? {
      cash: state.cash,
      equity: last ? last.equity : state.cash,
      peak_equity: state.peakEquity,
      positions: state.positions || {},
      npos: Object.keys(state.positions || {}).length,
      counters: state.counters || {},
      day: state.day || null,
      kill_switch: state.killSwitch || { active: false },
      last_tick: lastTick,
      updated_at: state.updatedAt,
    } : null,
    metrics,
    equity: downsample(eq, 900),
    trades,
    orders: od.slice(-600),
    calls: arr(calls).slice(-120),
    errors: arr(errors).slice(-200),
    kill: arr(kill).slice(-50),
    snapshots: arr(snapshots).filter(s => s && s.symbol).slice(-400).map(s => ({
      at: s.at, serverTime: s.serverTime, symbol: s.symbol, bid: s.bid, ask: s.ask,
      spreadPct: s.spreadPct,
    })),
    cost_breakdown: costBreakdownOf(trades),
  };
}

function buildReport(live = null) {
  const base = staticReport();
  const l = live || liveReport({}, Math.floor(Date.now() / 1000));
  return { ...base, live: l, meta: { ...base.meta, generated_at: new Date().toISOString() } };
}

module.exports = {
  REPORT_VERSION,
  freezeHash,
  deriveTradesFromOrders,
  costBreakdownOf,
  summarizeSkipped,
  staticReport,
  liveReport,
  buildReport,
  downsample,
};
