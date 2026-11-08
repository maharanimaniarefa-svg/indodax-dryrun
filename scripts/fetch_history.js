#!/usr/bin/env node
'use strict';
/**
 * Menarik / memperbarui candle 4h untuk universe yang sudah dibekukan.
 * Dipakai sebelum backtest dan untuk menyiapkan data jendela forward.
 *
 *   node scripts/fetch_history.js                # semua pair di config/universe.json
 *   node scripts/fetch_history.js --symbols=BTCIDR,ETHIDR
 *   node scripts/fetch_history.js --include-bench
 */
const path = require('path');
const cfg = require('../lib/config');
const api = require('../lib/indodax');
const ds = require('../lib/dataset');
const { writeJson, mergeCandles } = require('../lib/csv');
const { nowSec } = require('../lib/time');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

async function main() {
  const t0 = Date.now();
  let symbols = args.symbols ? String(args.symbols).split(',').map(s => s.trim().toUpperCase()) : cfg.SYMBOLS.slice();
  if (args['include-bench'] && !symbols.includes(cfg.benchSymbol)) symbols.push(cfg.benchSymbol);
  if (!symbols.length) throw new Error('Universe kosong. Jalankan scripts/select_universe.js dulu.');

  const startSec = cfg.backtestStart - cfg.warmupBars * cfg.tfSec;
  const endSec = nowSec();
  let totalRequests = 0;

  for (const symbol of symbols) {
    const t1 = Date.now();
    const existing = ds.loadCandles(symbol) || [];
    const { data, requests } = await api.fetchHistoryBackward(symbol, {
      tf: cfg.tf,
      tfSec: cfg.tfSec,
      startSec,
      endSec,
      onProgress: p => {
        if (p.requests % 4 === 0) process.stdout.write(`  ${symbol}: ${p.got} bar (${p.requests} req)\n`);
      },
    });
    const merged = mergeCandles(existing, data);
    ds.saveCandles(symbol, merged);
    totalRequests += requests;
    console.log(`${symbol.padEnd(10)} ${String(merged.length).padStart(5)} bar total (+${data.length} baru), ${requests} request, ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }

  writeJson(path.join(ds.DATA_DIR, 'meta.json'), {
    fetched_at: new Date().toISOString(),
    source: 'https://indodax.com/tradingview/history_v2',
    timeframe: cfg.tf,
    start: new Date(startSec * 1000).toISOString(),
    end: new Date(endSec * 1000).toISOString(),
    symbols,
    requests: totalRequests,
    elapsed_sec: Number(((Date.now() - t0) / 1000).toFixed(1)),
  });

  console.log(`\nSelesai: ${symbols.length} pair, ${totalRequests} request, ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main().catch(err => { console.error(err); process.exit(1); });
