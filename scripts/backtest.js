#!/usr/bin/env node
'use strict';
/**
 * Backtest 3 tahun + backtest ulang jendela forward dengan fungsi sinyal
 * yang sama seperti bot.
 *
 *   node scripts/backtest.js
 *
 * Output:
 *   results/backtest_full.json      ringkasan + equity + trade (3 tahun)
 *   results/backtest_forward.json   backtest jendela forward
 *   results/backtest_summary.json   ringkasan angka (untuk dashboard)
 *   results/backtest_trades.csv     log trade
 *   results/backtest_equity.csv     kurva ekuitas
 *   results/backtest_signals.csv    log sinyal (audit kecocokan dengan bot)
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const ds = require('../lib/dataset');
const { runBacktest, buyAndHold, DEFAULT_SPREAD_PCT, DEFAULT_SLIPPAGE_PCT } = require('../lib/backtest');
const { summarize } = require('../lib/metrics');
const { readJson, writeJson } = require('../lib/csv');
const { isoUtc } = require('../lib/time');

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function tradesCsv(trades) {
  const head = [
    'symbol', 'entry_time_utc', 'exit_time_utc', 'entry_signal_utc', 'exit_signal_utc',
    'entry_signal_price', 'exit_signal_price', 'entry_fill', 'exit_fill', 'qty',
    'entry_notional_idr', 'exit_notional_idr', 'fees_idr', 'spread_cost_idr', 'slippage_cost_idr',
    'other_cost_idr', 'costs_idr', 'gross_pnl_idr', 'net_pnl_idr', 'return_pct', 'exit_reason',
  ];
  const rows = trades.map(t => [
    t.symbol, isoUtc(t.entryTime), isoUtc(t.exitTime), isoUtc(t.entrySignalTime), isoUtc(t.exitSignalTime),
    t.entrySignalPrice, t.exitSignalPrice, t.entryFill, t.exitFill, t.qty,
    Math.round(t.entryNotional), Math.round(t.exitNotional), Math.round(t.fees),
    Math.round(t.spreadCost || 0), Math.round(t.slippageCost || 0), Math.round(t.otherCost || 0),
    Math.round(t.costs), Math.round(t.grossPnl), Math.round(t.netPnl),
    (t.returnPct * 100).toFixed(4), t.exitReason,
  ]);
  return [head, ...rows].map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
}

function equityCsv(equity) {
  const head = ['time_utc', 'equity_idr', 'cash_idr', 'invested_idr', 'npos', 'day_wib', 'entries_blocked'];
  const rows = equity.map(e => [
    isoUtc(e.t), Math.round(e.equity), Math.round(e.cash), Math.round(e.invested), e.npos, e.dayKey, e.blocked ? 1 : 0,
  ]);
  return [head, ...rows].map(r => r.join(',')).join('\n') + '\n';
}

function signalsCsv(signals) {
  const head = ['signal_time_utc', 'execute_time_utc', 'symbol', 'close', 'sma20', 'sma150', 'entry', 'exit', 'acted'];
  const rows = signals.map(s => [
    isoUtc(s.time), isoUtc(s.executeTime), s.symbol, s.close,
    Number.isFinite(s.maN) ? s.maN.toFixed(2) : '', Number.isFinite(s.maX) ? s.maX.toFixed(2) : '',
    s.entry ? 1 : 0, s.exit ? 1 : 0, s.acted ? 1 : 0,
  ]);
  return [head, ...rows].map(r => r.join(',')).join('\n') + '\n';
}

function metricsOf(result) {
  return summarize(result.equity, result.trades, { initialCapital: result.capital });
}

function costBreakdownOf(result) {
  const sum = key => result.trades.reduce((a, t) => a + (Number(t[key]) || 0), 0);
  return {
    fees: sum('fees'),
    spread: sum('spreadCost'),
    slippage: sum('slippageCost'),
    other: sum('otherCost'),
    total: sum('costs'),
  };
}

/** Kurva besar dipotong untuk dashboard tanpa mengubah bentuk secara berarti. */
function downsample(rows, max = 720) {
  if (!Array.isArray(rows) || rows.length <= max) return rows || [];
  const out = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)]);
  return out;
}

function loadAllSpread(symbols) {
  const saved = readJson(path.join(ds.DATA_DIR, 'spread.json'), null);
  const out = {};
  for (const s of symbols) {
    out[s] = saved && saved.pairs && saved.pairs[s]
      ? { spreadPct: saved.pairs[s].spreadPct, slippagePct: saved.pairs[s].slippagePct }
      : { spreadPct: DEFAULT_SPREAD_PCT, slippagePct: DEFAULT_SLIPPAGE_PCT };
  }
  return out;
}

function rollingReturns(equity) {
  const monthEnd = new Map();
  for (const e of equity) monthEnd.set(new Date(e.t * 1000).toISOString().slice(0, 7), e.equity);
  const keys = [...monthEnd.keys()].sort();
  const out = [];
  let prev = equity.length ? equity[0].equity : cfg.capital;
  for (const k of keys) {
    const v = monthEnd.get(k);
    out.push({ month: k, returnPct: prev > 0 ? v / prev - 1 : 0 });
    prev = v;
  }
  return out;
}

function main() {
  const pairs = cfg.UNIVERSE;
  if (!pairs.length) throw new Error('config/universe.json kosong. Jalankan scripts/select_universe.js dulu.');

  const symbols = pairs.map(p => p.symbol);
  const data = ds.loadAll(symbols);
  const missing = symbols.filter(s => !data[s]);
  if (missing.length) throw new Error(`Candle tidak ditemukan untuk: ${missing.join(', ')}. Jalankan scripts/fetch_history.js.`);

  const bench = ds.loadCandles(cfg.benchSymbol) || data[cfg.benchSymbol] || null;
  const spreadMap = loadAllSpread(symbols);
  const hasMeasured = fs.existsSync(path.join(ds.DATA_DIR, 'spread.json'));
  if (!hasMeasured) {
    console.warn(`PERINGATAN: data/spread.json belum ada. Memakai asumsi spread ${(DEFAULT_SPREAD_PCT * 100).toFixed(2)}% dan slippage ${(DEFAULT_SLIPPAGE_PCT * 100).toFixed(3)}%. Jalankan scripts/collect_snapshot.js + build_spread.js.`);
  }

  const lastBar = Math.max(...symbols.map(s => data[s][data[s].length - 1].t));

  // ---------- Backtest 3 tahun ----------
  console.log(`Backtest ${isoUtc(cfg.backtestStart).slice(0, 10)} s/d ${isoUtc(Math.min(cfg.backtestEnd, lastBar)).slice(0, 10)} | MA${cfg.N}/MA${cfg.X} ${cfg.tfLabel} | ${symbols.length} pair`);
  const full = runBacktest({
    data,
    pairs,
    startTime: cfg.backtestStart,
    endTime: Math.min(cfg.backtestEnd, lastBar),
    spreadMap,
  });
  const fullMetrics = metricsOf(full);
  const benchFull = bench ? buyAndHold(bench, cfg.backtestStart, Math.min(cfg.backtestEnd, lastBar), cfg.capital) : null;

  // ---------- Backtest ulang jendela forward ----------
  let fwd = null;
  let fwdMetrics = null;
  let benchFwd = null;
  const fwdEnd = Math.min(cfg.forwardEnd, lastBar);
  if (fwdEnd >= cfg.forwardStart) {
    fwd = runBacktest({
      data,
      pairs,
      startTime: cfg.forwardStart,
      endTime: fwdEnd,
      spreadMap,
    });
    fwdMetrics = metricsOf(fwd);
    benchFwd = bench ? buyAndHold(bench, cfg.forwardStart, fwdEnd, cfg.capital) : null;
  } else {
    console.log('Jendela forward belum punya candle (forward test belum berjalan).');
  }

  const spreadUsed = {};
  for (const p of pairs) spreadUsed[p.symbol] = { ...spreadMap[p.symbol], source: hasMeasured ? 'snapshot order book' : 'asumsi default' };

  const summary = {
    generated_at: new Date().toISOString(),
    strategy: cfg.F.strategy,
    timeframe: cfg.tfLabel,
    params: { N: cfg.N, X: cfg.X },
    universe: pairs.map(p => ({ symbol: p.symbol, earlyMedianTurnoverIdr: p.earlyMedianTurnoverIdr })),
    costs: {
      fee_buy_taker: cfg.feeBuy,
      fee_sell_taker: cfg.feeSell,
      min_order_idr: cfg.minOrderIdr,
      spread_used: spreadUsed,
      has_measured_spread: hasMeasured,
    },
    backtest: {
      window: { start: full.startTime, end: full.endTime },
      metrics: fullMetrics,
      cost_breakdown: costBreakdownOf(full),
      benchmark: benchFull ? {
        symbol: benchFull.symbol,
        totalReturn: benchFull.totalReturn,
        maxDrawdown: benchFull.maxDrawdown,
        curve: downsample(benchFull.curve),
      } : null,
      open_positions: full.openPositions,
      monthly_returns: rollingReturns(full.equity),
      skipped_count: full.skipped.length,
    },
    forward_backtest: fwd ? {
      window: { start: fwd.startTime, end: fwd.endTime },
      metrics: fwdMetrics,
      cost_breakdown: costBreakdownOf(fwd),
      benchmark: benchFwd ? {
        symbol: benchFwd.symbol,
        totalReturn: benchFwd.totalReturn,
        maxDrawdown: benchFwd.maxDrawdown,
        curve: downsample(benchFwd.curve),
      } : null,
      open_positions: fwd.openPositions,
      skipped_count: fwd.skipped.length,
    } : null,
  };

  writeJson(path.join(ds.RESULTS_DIR, 'backtest_summary.json'), summary);
  writeJson(path.join(ds.RESULTS_DIR, 'backtest_full.json'), {
    ...summary.backtest,
    config: full.config,
    trades: full.trades,
    orders: full.orders,
    equity: full.equity,
    skipped: full.skipped,
  });
  if (fwd) {
    writeJson(path.join(ds.RESULTS_DIR, 'backtest_forward.json'), {
      ...summary.forward_backtest,
      config: fwd.config,
      trades: fwd.trades,
      orders: fwd.orders,
      equity: fwd.equity,
      signals: fwd.signals,
      skipped: fwd.skipped,
    });
  }

  fs.writeFileSync(path.join(ds.RESULTS_DIR, 'backtest_trades.csv'), tradesCsv(full.trades));
  fs.writeFileSync(path.join(ds.RESULTS_DIR, 'backtest_equity.csv'), equityCsv(full.equity));
  fs.writeFileSync(path.join(ds.RESULTS_DIR, 'backtest_signals.csv'), signalsCsv(full.signals));

  // ---------- cetak ----------
  const pct = x => x == null || !Number.isFinite(x) ? 'n/a' : (x * 100).toFixed(2) + '%';
  const idr = x => 'Rp ' + Math.round(x).toLocaleString('id-ID');
  const m = fullMetrics;
  console.log('\n=== HASIL BACKTEST 3 TAHUN ===');
  console.log(`Periode      : ${isoUtc(full.startTime)} s/d ${isoUtc(full.endTime)} (${m.years.toFixed(2)} tahun)`);
  console.log(`Return total : ${pct(m.totalReturn)} | CAGR ${pct(m.cagr)} | Max DD ${pct(m.maxDrawdown)}`);
  console.log(`Ekuitas akhir: ${idr(m.finalEquity)} (awal ${idr(m.initialCapital)})`);
  console.log(`Trade        : ${m.trades} | Win rate ${pct(m.winRate)} | Profit factor ${m.profitFactor == null ? 'n/a' : m.profitFactor.toFixed(2)}`);
  console.log(`Rata2 untung : ${pct(m.avgWinPct)} | Rata2 rugi ${pct(m.avgLossPct)} | Rata2 hold ${m.avgHoldHours.toFixed(1)} jam`);
  console.log(`Biaya        : fee ${idr(m.fees)} | total (fee+spread+slippage) ${idr(m.costs)} | porsi dr laba kotor ${pct(m.costShare)}`);
  console.log(`B&H ${cfg.benchSymbol}: return ${benchFull ? pct(benchFull.totalReturn) : 'n/a'} | Max DD ${benchFull ? pct(benchFull.maxDrawdown) : 'n/a'}`);
  console.log(`Posisi terbuka saat akhir: ${full.openPositions.length}`);

  if (fwd) {
    const f = fwdMetrics;
    console.log('\n=== BACKTEST JENDELA FORWARD (candle yang sama dengan bot) ===');
    console.log(`Periode      : ${isoUtc(fwd.startTime)} s/d ${isoUtc(fwd.endTime)}`);
    console.log(`Return total : ${pct(f.totalReturn)} | Max DD ${pct(f.maxDrawdown)} | Trade ${f.trades}`);
    console.log(`Posisi terbuka: ${fwd.openPositions.length} | B&H ${cfg.benchSymbol}: ${benchFwd ? pct(benchFwd.totalReturn) : 'n/a'}`);
  }

  console.log(`\nFile: results/backtest_summary.json, backtest_full.json, backtest_trades.csv, backtest_equity.csv, backtest_signals.csv`);
}

main();
