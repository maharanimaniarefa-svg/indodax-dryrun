#!/usr/bin/env node
'use strict';
/**
 * Mengubah sampel order book menjadi data/spread.json untuk backtest.
 *
 *   node scripts/build_spread.js
 *   node scripts/build_spread.js --min-samples=5
 *
 * Metode (konservatif):
 *   spreadPct   = median spread relatif dari semua sampel
 *   slippagePct = max(median slippage beli, median slippage jual)
 * Sampel dengan order book tidak lengkap tetap dicatat, tetapi tidak dipakai
 * bila ada cukup sampel lengkap. Pair tanpa sampel memakai fallback di
 * lib/backtest.js dan ditandai di output.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const ds = require('../lib/dataset');
const { readJsonl, writeJson } = require('../lib/csv');
const { median } = require('../lib/strategy');
const { DEFAULT_SPREAD_PCT, DEFAULT_SLIPPAGE_PCT } = require('../lib/backtest');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

const MIN_SAMPLES = Math.max(1, Number(args['min-samples'] || 3));
const IN = args.in ? path.resolve(String(args.in)) : path.join(ds.DATA_DIR, 'spread_samples.jsonl');
const OUT = args.out ? path.resolve(String(args.out)) : path.join(ds.DATA_DIR, 'spread.json');

function main() {
  const samples = readJsonl(IN);
  if (!samples.length) {
    throw new Error(`Belum ada sampel di ${IN}. Jalankan scripts/collect_snapshot.js.`);
  }

  const bySymbol = new Map();
  for (const s of samples) {
    if (!s || !s.symbol) continue;
    if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
    bySymbol.get(s.symbol).push(s);
  }

  const pairs = {};
  const missing = [];
  for (const pair of cfg.UNIVERSE) {
    const all = bySymbol.get(pair.symbol) || [];
    const complete = all.filter(s => s.complete !== false);
    const use = complete.length >= MIN_SAMPLES ? complete : all;
    if (!use.length) {
      missing.push(pair.symbol);
      pairs[pair.symbol] = {
        spreadPct: DEFAULT_SPREAD_PCT,
        slippagePct: DEFAULT_SLIPPAGE_PCT,
        samples: 0,
        source: 'fallback (tidak ada sampel)',
        lowSample: true,
      };
      continue;
    }
    const spreadPct = median(use.map(s => s.spreadPct).filter(Number.isFinite));
    const slipBuy = median(use.map(s => s.slippageBuyPct).filter(Number.isFinite));
    const slipSell = median(use.map(s => s.slippageSellPct).filter(Number.isFinite));
    const slippagePct = Math.max(
      Number.isFinite(slipBuy) ? slipBuy : 0,
      Number.isFinite(slipSell) ? slipSell : 0,
      DEFAULT_SLIPPAGE_PCT
    );
    pairs[pair.symbol] = {
      spreadPct: Math.max(Number.isFinite(spreadPct) ? spreadPct : DEFAULT_SPREAD_PCT, 0.0005),
      rawSpreadPct: spreadPct,
      slippagePct,
      slippageBuyPct: slipBuy,
      slippageSellPct: slipSell,
      samples: use.length,
      samplesComplete: complete.length,
      samplesTotal: all.length,
      notional_idr: use[0].notional_idr,
      source: 'snapshot order book',
      lowSample: use.length < MIN_SAMPLES,
      firstSample: use[0].at,
      lastSample: use[use.length - 1].at,
    };
  }

  const out = {
    generated_at: new Date().toISOString(),
    method: 'median spread order book + max(median slippage beli, median slippage jual) pada notional target posisi',
    notional_idr: Number(samples[0].notional_idr) || Math.round(cfg.capital * cfg.allocPct),
    min_samples: MIN_SAMPLES,
    samples: samples.length,
    source_file: path.relative(ds.ROOT, IN),
    missing,
    pairs,
  };
  writeJson(OUT, out);

  console.log(`Sampel: ${samples.length} baris, ${bySymbol.size} pair.\n`);
  console.log('Pair       Spread    Slip beli  Slip jual  Sampel  Sumber');
  for (const [sym, p] of Object.entries(pairs)) {
    console.log(
      `${sym.padEnd(10)} ${(p.spreadPct * 100).toFixed(3).padStart(6)}%  ` +
      `${(p.slippagePct * 100).toFixed(3).padStart(8)}%  ` +
      `${(Number.isFinite(p.slippageSellPct) ? (p.slippageSellPct * 100).toFixed(3) : 'n/a').padStart(8)}%  ` +
      `${String(p.samples).padStart(6)}  ${p.source}${p.lowSample ? ' (sampel sedikit)' : ''}`
    );
  }
  if (missing.length) console.log(`\nTanpa sampel (fallback): ${missing.join(', ')}`);
  console.log(`\nDisimpan ke ${path.relative(ds.ROOT, OUT)}.`);
}

try { main(); } catch (err) { console.error(err.message); process.exit(1); }
