#!/usr/bin/env node
'use strict';
/**
 * Membangun dashboard offline + laporan JSON.
 *
 *   node scripts/build_dashboard.js
 *
 * Input : results/*.json, results/*.csv, logs/export/*, config/*
 * Output: results/report.json
 *         public/data.js            (laporan tertanam, bisa dibuka via file://)
 *         public/data/*             (salinan artefak untuk diunduh)
 *
 * Dashboard online memakai /api/dashboard (data live dari Upstash).
 * Dashboard offline memakai public/data.js sehingga tetap bisa dibuka tanpa
 * server dan tanpa internet.
 */
const fs = require('fs');
const path = require('path');
const ds = require('../lib/dataset');
const { staticReport, liveReport, buildReport } = require('../lib/report');
const { readJson, readJsonl, writeJson, ensureDir } = require('../lib/csv');

const ROOT = ds.ROOT;
const PUBLIC = path.join(ROOT, 'public');
const OUT_DATA = path.join(PUBLIC, 'data');
const EXPORT = path.join(ds.LOGS_DIR, 'export');

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function loadLive() {
  const orders = readJsonl(path.join(EXPORT, 'orders.jsonl'));
  const equity = readJsonl(path.join(EXPORT, 'equity.jsonl'));
  if (!orders.length && !equity.length) return null;
  return liveReport({
    state: readJson(path.join(EXPORT, 'state.json'), null),
    orders,
    equity,
    calls: readJsonl(path.join(EXPORT, 'calls.jsonl')),
    errors: readJsonl(path.join(EXPORT, 'errors.jsonl')),
    snapshots: readJsonl(path.join(EXPORT, 'snapshots.jsonl')),
    kill: readJsonl(path.join(EXPORT, 'kill.jsonl')),
  });
}

function main() {
  ensureDir(PUBLIC);
  ensureDir(OUT_DATA);

  const live = loadLive();
  const report = buildReport(live);
  report.meta.built_offline_at = new Date().toISOString();
  report.meta.live_included = !!live;

  writeJson(path.join(ds.RESULTS_DIR, 'report.json'), report);
  fs.writeFileSync(
    path.join(PUBLIC, 'data.js'),
    '/* dibuat otomatis oleh scripts/build_dashboard.js; jangan diedit manual */\n' +
    'window.__REPORT__ = ' + JSON.stringify(report) + ';\n'
  );

  const copies = [
    ['results/backtest_summary.json', 'backtest_summary.json'],
    ['results/backtest_trades.csv', 'backtest_trades.csv'],
    ['results/backtest_equity.csv', 'backtest_equity.csv'],
    ['results/backtest_signals.csv', 'backtest_signals.csv'],
    ['results/recompute.json', 'recompute.json'],
    ['results/recompute_live_trades.csv', 'recompute_live_trades.csv'],
    ['results/freeze_manifest.json', 'freeze_manifest.json'],
    ['results/backtest_full.json', 'backtest_full.json'],
    ['results/backtest_forward.json', 'backtest_forward.json'],
    ['logs/export/manifest.json', 'export_manifest.json'],
    ['logs/export/state.json', 'live_state.json'],
    ['logs/export/orders.csv', 'live_orders.csv'],
    ['logs/export/equity.csv', 'live_equity.csv'],
    ['logs/export/calls.csv', 'live_calls.csv'],
    ['logs/export/errors.csv', 'live_errors.csv'],
    ['logs/export/snapshots.csv', 'live_snapshots.csv'],
    ['logs/export/kill.csv', 'live_kill.csv'],
  ];
  const copied = [];
  for (const [srcRel, destName] of copies) {
    if (copyIfExists(path.join(ROOT, srcRel), path.join(OUT_DATA, destName))) copied.push(destName);
  }
  for (const name of ['orders', 'equity', 'calls', 'errors', 'snapshots', 'kill']) {
    const src = path.join(EXPORT, `${name}.jsonl`);
    if (copyIfExists(src, path.join(OUT_DATA, 'raw', `${name}.jsonl`))) copied.push(`raw/${name}.jsonl`);
  }

  const size = fs.statSync(path.join(PUBLIC, 'data.js')).size;
  console.log('Dashboard dibangun.');
  console.log(`  results/report.json`);
  console.log(`  public/data.js (${(size / 1024).toFixed(1)} KB)`);
  console.log(`  ${copied.length} artefak disalin ke public/data/`);
  console.log(`  Data live ${live ? 'disertakan' : 'belum tersedia (jalankan export_logs.js setelah forward test)'}`);
  if (report.backtest?.metrics) {
    const m = report.backtest.metrics;
    console.log(`  Backtest: return ${(m.totalReturn * 100).toFixed(2)}%, MDD ${(m.maxDrawdown * 100).toFixed(2)}%, ${m.trades} trade`);
  }
}

try { main(); } catch (err) { console.error(err); process.exit(1); }
