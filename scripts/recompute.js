#!/usr/bin/env node
'use strict';
/**
 * Audit hitung ulang (recompute).
 *
 * Membaca artefak mentah lalu menghitung ulang metrik secara independen:
 *   - backtest: results/backtest_trades.csv, results/backtest_equity.csv,
 *     results/backtest_full.json, results/backtest_summary.json
 *   - forward : logs/export/orders.jsonl + equity.jsonl + calls.jsonl + state.json
 *
 * Output: results/recompute.json (lengkap dengan daftar check PASS/FAIL)
 *         results/recompute_live_trades.csv
 *
 *   node scripts/recompute.js
 *
 * Tidak memanggil API dan tidak memakai angka dari dashboard.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const ds = require('../lib/dataset');
const { readJson, parseCsv, rowsToObjects, readJsonl, writeJson, ensureDir } = require('../lib/csv');
const { summarize, maxDrawdown } = require('../lib/metrics');
const { deriveTradesFromOrders, costBreakdownOf } = require('../lib/report');
const { isoUtc } = require('../lib/time');
const { createStore } = require('../lib/store');

const ROOT = ds.ROOT;
const EXPORT = path.join(ds.LOGS_DIR, 'export');

function near(a, b, { abs = 1e-6, rel = 1e-9 } = {}) {
  if (a == null && b == null) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
}

function check(id, label, pass, detail) {
  return { id, label, pass: !!pass, detail };
}

function metricChecks(reported, calc, prefix) {
  const fields = [
    ['totalReturn', 1e-6, 1e-6],
    ['maxDrawdown', 1e-6, 1e-6],
    ['winRate', 1e-9, 1e-6],
    ['profitFactor', 1e-6, 1e-6],
    ['trades', 0, 0],
    ['fees', 1, 1e-9],
    ['costs', 1, 1e-9],
  ];
  return fields.map(([k, abs, rel]) => check(
    `${prefix}.${k}`,
    `${prefix}: ${k} sama dengan hasil hitung ulang`,
    near(calc?.[k], reported?.[k], { abs, rel }),
    { reported: reported?.[k], recomputed: calc?.[k] }
  ));
}

// ---------------------------------------------------------------- backtest
function recomputeBacktest() {
  const summary = readJson(path.join(ds.RESULTS_DIR, 'backtest_summary.json'), null);
  const full = readJson(path.join(ds.RESULTS_DIR, 'backtest_full.json'), null);
  if (!summary || !full) {
    return { available: false, note: 'results/backtest_summary.json atau backtest_full.json belum ada' };
  }

  // 1) Hitung ulang dari JSON mentah (trade + equity yang dipakai engine).
  const calc = summarize(full.equity, full.trades, { initialCapital: full.capital });
  const reported = summary.backtest?.metrics || null;

  // 2) Hitung ulang dari CSV (jalur independen, hanya field yang dibulatkan).
  const tradesCsvFile = path.join(ds.RESULTS_DIR, 'backtest_trades.csv');
  const equityCsvFile = path.join(ds.RESULTS_DIR, 'backtest_equity.csv');
  const tradeRows = fs.existsSync(tradesCsvFile)
    ? rowsToObjects(parseCsv(fs.readFileSync(tradesCsvFile, 'utf8')))
    : [];
  const eqRows = fs.existsSync(equityCsvFile)
    ? rowsToObjects(parseCsv(fs.readFileSync(equityCsvFile, 'utf8')))
    : [];

  const csvFees = tradeRows.reduce((a, r) => a + Number(r.fees_idr || 0), 0);
  const csvCosts = tradeRows.reduce((a, r) => a + Number(r.costs_idr || 0), 0);
  const csvNet = tradeRows.reduce((a, r) => a + Number(r.net_pnl_idr || 0), 0);
  const wins = tradeRows.filter(r => Number(r.net_pnl_idr) > 0).length;
  const csvEquity = eqRows.map(r => ({ t: Date.parse(r.time_utc) / 1000, equity: Number(r.equity_idr) }))
    .filter(r => Number.isFinite(r.t) && Number.isFinite(r.equity));
  const csvFinal = csvEquity.length ? csvEquity[csvEquity.length - 1].equity : null;
  const csvTotalReturn = csvEquity.length ? csvFinal / Number(cfg.capital) - 1 : null;
  const csvMdd = csvEquity.length ? maxDrawdown(csvEquity).mdd : null;

  const checks = [
    ...metricChecks(reported, calc, 'backtest'),
    check('bt.csv.trade_count', 'jumlah trade CSV = jumlah trade JSON', tradeRows.length === full.trades.length,
      { csv: tradeRows.length, json: full.trades.length }),
    check('bt.csv.equity_count', 'jumlah baris ekuitas CSV = panjang kurva JSON', csvEquity.length === full.equity.length,
      { csv: csvEquity.length, json: full.equity.length }),
    check('bt.csv.fees', 'total fee CSV ≈ total fee JSON (toleransi Rp100)', Math.abs(csvFees - calc.fees) <= 100,
      { csv: csvFees, json: calc.fees }),
    check('bt.csv.costs', 'total biaya CSV ≈ total biaya JSON (toleransi Rp100)', Math.abs(csvCosts - calc.costs) <= 100,
      { csv: csvCosts, json: calc.costs }),
    check('bt.csv.return', 'return dari CSV ekuitas ≈ return JSON (pembulatan Rp1)', near(csvTotalReturn, calc.totalReturn, { abs: 1e-6 }),
      { csv: csvTotalReturn, json: calc.totalReturn }),
    check('bt.csv.mdd', 'max drawdown dari CSV ekuitas ≈ MDD JSON (pembulatan Rp1)', near(csvMdd, calc.maxDrawdown, { abs: 1e-6 }),
      { csv: csvMdd, json: calc.maxDrawdown }),
    check('bt.csv.wins', 'jumlah trade untung CSV = JSON', wins === full.trades.filter(t => t.netPnl > 0).length,
      { csv: wins, json: full.trades.filter(t => t.netPnl > 0).length }),
  ];

  // 3) Integritas trade & order.
  let badPnl = 0;
  let badFees = 0;
  let earlyExit = 0;
  for (const t of full.trades) {
    if (!near(t.netPnl, t.grossPnl - t.costs, { abs: 0.02 })) badPnl++;
    if (t.exitTime <= t.entryTime) earlyExit++;
  }
  for (const o of full.orders) {
    const rate = o.side === 'BUY' ? cfg.feeBuy : cfg.feeSell;
    if (!near(o.fee, o.notional * rate, { abs: 1 })) badFees++;
  }
  checks.push(
    check('bt.pnl.identity', 'netPnl = grossPnl - biaya pada setiap trade', badPnl === 0, { bad: badPnl }),
    check('bt.order.fee', 'fee setiap order = notional x tarif taker', badFees === 0, { bad: badFees }),
    check('bt.time.order', 'setiap exit terjadi setelah entry', earlyExit === 0, { bad: earlyExit })
  );

  // 4) Disiplin daily loss limit & minimum order pada log order.
  const blockedAt = new Map();
  for (const e of full.equity) {
    if (e.blocked && !blockedAt.has(e.dayKey)) blockedAt.set(e.dayKey, e.t);
  }
  const buysAfterBlock = full.orders.filter(o => {
    if (o.side !== 'BUY') return false;
    const day = new Date((o.time + 7 * 3600) * 1000).toISOString().slice(0, 10);
    const b = blockedAt.get(day);
    return b != null && o.time > b;
  });
  const smallOrders = full.orders.filter(o => o.side === 'BUY' && o.notional < cfg.minOrderIdr);
  checks.push(
    check('bt.risk.daily_loss', 'tidak ada entry baru setelah daily loss limit aktif', buysAfterBlock.length === 0,
      { violations: buysAfterBlock.length }),
    check('bt.risk.min_order', 'semua order beli >= minimum Rp' + cfg.minOrderIdr, smallOrders.length === 0,
      { violations: smallOrders.length })
  );

  const recomputed = {
    ...calc,
    cost_breakdown: costBreakdownOf(full.trades),
    csv: {
      trades: tradeRows.length,
      equity_rows: csvEquity.length,
      fees: csvFees,
      costs: csvCosts,
      net_pnl: csvNet,
      total_return: csvTotalReturn,
      max_drawdown: csvMdd,
    },
  };
  return { available: true, reported, recomputed, checks, passed: checks.every(c => c.pass) };
}

// -------------------------------------------------------------------- live
async function loadLiveRaw() {
  const files = {
    orders: path.join(EXPORT, 'orders.jsonl'),
    equity: path.join(EXPORT, 'equity.jsonl'),
    calls: path.join(EXPORT, 'calls.jsonl'),
    errors: path.join(EXPORT, 'errors.jsonl'),
    state: path.join(EXPORT, 'state.json'),
  };
  const hasExport = Object.values(files).some(f => fs.existsSync(f));
  if (hasExport) {
    return {
      source: 'logs/export',
      orders: readJsonl(files.orders),
      equity: readJsonl(files.equity),
      calls: readJsonl(files.calls),
      errors: readJsonl(files.errors),
      state: readJson(files.state, null),
    };
  }
  try {
    const store = createStore(process.env);
    const [state, orders, equity, calls, errors] = await Promise.all([
      store.getState(),
      store.list('orders', 5000),
      store.list('equity', 5000),
      store.list('calls', 5000),
      store.list('errors', 3000),
    ]);
    return { source: 'store', state, orders, equity, calls, errors };
  } catch (err) {
    return { source: null, note: err.message, state: null, orders: [], equity: [], calls: [], errors: [] };
  }
}

function recomputeLive(raw) {
  const orders = raw.orders || [];
  // Log bot menulis waktu equity di `serverTime` (unix detik); jalur export/CSV
  // memakai `t`. Normalisasi agar audit forward tidak menganggap log kosong.
  const equity = (raw.equity || [])
    .map(e => ({ ...e, t: Number.isFinite(e.t) ? e.t : Number(e.serverTime) }))
    .filter(e => Number.isFinite(e.t) && Number.isFinite(e.equity));
  if (!orders.length && !equity.length) {
    return { available: false, source: raw.source, note: raw.note || 'belum ada log forward (export atau store)' };
  }

  const trades = deriveTradesFromOrders(orders);
  const metrics = equity.length >= 2 ? summarize(equity, trades, { initialCapital: cfg.capital }) : null;
  const checks = [];

  const seen = new Set();
  const dup = [];
  for (const o of orders) {
    const key = `${o.symbol}:${o.candleTime}:${o.side}`;
    if (seen.has(key)) dup.push(key);
    seen.add(key);
  }
  checks.push(check('live.idempotency', 'tidak ada order ganda untuk simbol+candle+side', dup.length === 0,
    { duplicates: dup.slice(0, 10), count: dup.length }));

  const late = orders.filter(o => !(Number(o.candleTime) + cfg.tfSec <= Number(o.serverTime) + 1));
  checks.push(check('live.closed_candle', 'semua order dieksekusi setelah candle sinyal tertutup', late.length === 0,
    { violations: late.length }));

  let badFee = 0;
  let small = 0;
  for (const o of orders) {
    const rate = o.side === 'BUY' ? cfg.feeBuy : cfg.feeSell;
    if (!near(o.fee, o.notional * rate, { abs: 1 })) badFee++;
    if (o.side === 'BUY' && o.notional < cfg.minOrderIdr) small++;
  }
  checks.push(
    check('live.fee', 'fee order = notional x tarif taker', badFee === 0, { violations: badFee }),
    check('live.min_order', 'order beli >= minimum Rp' + cfg.minOrderIdr, small === 0, { violations: small })
  );

  // Rekonsiliasi kas: modal awal - beli + jual = kas akhir.
  let cash = cfg.capital;
  for (const o of orders) {
    if (o.side === 'BUY') cash -= Number(o.notional) + Number(o.fee);
    else cash += Number(o.notional) - Number(o.fee);
  }
  const stateCash = raw.state ? Number(raw.state.cash) : null;
  checks.push(check('live.cash', 'kas dari log order = kas di state', stateCash != null && Math.abs(cash - stateCash) <= 2,
    { from_orders: cash, from_state: stateCash }));

  // Tidak boleh ada SELL tanpa posisi.
  const holding = new Map();
  let orphanSell = 0;
  for (const o of [...orders].sort((a, b) => a.serverTime - b.serverTime)) {
    if (o.side === 'BUY') holding.set(o.symbol, (holding.get(o.symbol) || 0) + Number(o.qty));
    else {
      const q = holding.get(o.symbol) || 0;
      if (q <= 0) orphanSell++;
      holding.set(o.symbol, Math.max(0, q - Number(o.qty)));
    }
  }
  checks.push(check('live.position_sequence', 'tidak ada SELL tanpa posisi', orphanSell === 0, { violations: orphanSell }));

  // Daily loss: setelah blocked=true, tidak boleh ada BUY pada hari WIB yang sama.
  const blocked = new Map();
  for (const c of raw.calls || []) {
    if (c.day?.blocked && c.day?.key && !blocked.has(c.day.key)) blocked.set(c.day.key, c.serverTime);
  }
  const badDay = orders.filter(o => {
    if (o.side !== 'BUY') return false;
    const key = new Date((o.serverTime + 7 * 3600) * 1000).toISOString().slice(0, 10);
    const b = blocked.get(key);
    return b != null && o.serverTime > b;
  });
  checks.push(check('live.daily_loss', 'tidak ada entry setelah daily loss limit aktif', badDay.length === 0,
    { violations: badDay.length }));

  // Jumlah candle yang SUDAH TERTUTUP dalam jendela. Candle yang masih berjalan
  // (open <= now < open+tf) belum dihitung; rumus lama (+1) menghitungnya.
  const now = Math.min(Math.floor(Date.now() / 1000), cfg.forwardEnd);
  const expected = Math.max(0, Math.floor((now - cfg.forwardStart) / cfg.tfSec));
  const progress = {};
  let minProgress = 1;
  for (const sym of cfg.SYMBOLS) {
    const last = raw.state?.lastProcessed?.[sym];
    const n = Number.isFinite(last)
      ? Math.max(0, Math.min(expected, Math.floor((last - cfg.forwardStart) / cfg.tfSec) + 1))
      : 0;
    progress[sym] = { processed: n, expected };
    if (expected > 0) minProgress = Math.min(minProgress, n / expected);
  }
  checks.push(check('live.progress', 'setiap simbol memproses >= 90% candle yang seharusnya', minProgress >= 0.9,
    { min_coverage: minProgress, expected_candles: expected, per_symbol: progress }));

  // Bandingkan dengan backtest jendela forward (kalau data candle sudah diperbarui).
  const fwd = readJson(path.join(ds.RESULTS_DIR, 'backtest_forward.json'), null);
  let comparison = null;
  if (fwd?.metrics) {
    comparison = {
      live_return: metrics?.totalReturn ?? null,
      backtest_return: fwd.metrics.totalReturn,
      selisih_return: (metrics?.totalReturn ?? 0) - fwd.metrics.totalReturn,
      live_trades: trades.length,
      backtest_trades: fwd.metrics.trades,
      catatan: 'Perbedaan wajar: bot memakai bid/ask nyata tiap tick, backtest memakai open + spread/slippage terukur.',
    };
  }

  return {
    available: true,
    source: raw.source,
    orders: orders.length,
    equity_points: equity.length,
    trades: trades.length,
    metrics,
    cost_breakdown: costBreakdownOf(trades),
    checks,
    passed: checks.every(c => c.pass),
    comparison,
    progress,
  };
}

function writeLiveTradesCsv(trades) {
  ensureDir(ds.RESULTS_DIR);
  const head = ['symbol', 'entry_time_utc', 'exit_time_utc', 'entry_fill', 'exit_fill', 'qty',
    'entry_notional_idr', 'exit_notional_idr', 'fees_idr', 'spread_idr', 'slippage_idr',
    'costs_idr', 'gross_pnl_idr', 'net_pnl_idr', 'return_pct'];
  const rows = trades.map(t => [
    t.symbol, isoUtc(t.entryTime), isoUtc(t.exitTime), t.entryFill, t.exitFill, t.qty,
    Math.round(t.entryNotional), Math.round(t.exitNotional), Math.round(t.fees),
    Math.round(t.spreadCost), Math.round(t.slippageCost), Math.round(t.costs),
    Math.round(t.grossPnl), Math.round(t.netPnl), (t.returnPct * 100).toFixed(4),
  ]);
  fs.writeFileSync(path.join(ds.RESULTS_DIR, 'recompute_live_trades.csv'), [head, ...rows].map(r => r.join(',')).join('\n') + '\n');
}

async function main() {
  const backtest = recomputeBacktest();
  const raw = await loadLiveRaw();
  const live = recomputeLive(raw);
  if (live.available && live.trades != null) {
    const trades = deriveTradesFromOrders(raw.orders || []);
    writeLiveTradesCsv(trades);
  }

  const overall = (backtest.available ? backtest.passed : true) && (live.available ? live.passed : true);
  const out = {
    generated_at: new Date().toISOString(),
    inputs: {
      backtest_full: 'results/backtest_full.json',
      backtest_summary: 'results/backtest_summary.json',
      backtest_trades_csv: 'results/backtest_trades.csv',
      backtest_equity_csv: 'results/backtest_equity.csv',
      live_source: raw.source,
      live_export: 'logs/export/*.jsonl',
    },
    backtest,
    live,
    overall_passed: overall,
  };
  writeJson(path.join(ds.RESULTS_DIR, 'recompute.json'), out);

  const mark = p => (p ? 'PASS' : 'FAIL');
  console.log('=== RECOMPUTE BACKTEST ===');
  if (!backtest.available) console.log(backtest.note);
  else {
    for (const c of backtest.checks) console.log(`[${mark(c.pass)}] ${c.label}`);
    console.log(`Backtest: ${mark(backtest.passed)}`);
  }

  console.log('\n=== RECOMPUTE FORWARD ===');
  if (!live.available) console.log(live.note || 'belum ada data');
  else {
    for (const c of live.checks) console.log(`[${mark(c.pass)}] ${c.label}`);
    console.log(`Forward : ${mark(live.passed)} (${live.orders} order, ${live.trades} trade selesai)`);
    if (live.comparison) {
      console.log(`Return live ${(live.comparison.live_return * 100).toFixed(2)}% vs backtest ${(live.comparison.backtest_return * 100).toFixed(2)}%`);
    }
  }
  console.log(`\nHasil: ${overall ? 'SEMUA CHECK PASS' : 'ADA CHECK GAGAL'} -> results/recompute.json`);
  if (live.available && !live.passed) process.exitCode = 2;
}

main().catch(err => { console.error(err); process.exit(1); });
