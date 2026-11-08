#!/usr/bin/env node
'use strict';
/**
 * Manifest freeze + verifikasi integritas.
 *
 *   node scripts/freeze.js            # buat results/freeze_manifest.json
 *   node scripts/freeze.js --verify   # cocokkan file sekarang dengan manifest
 *
 * Yang di-hash: parameter, kode sinyal, data candle, hasil backtest, dan
 * config universe. Kalau ada yang berubah setelah freeze, --verify gagal.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const cfg = require('../lib/config');
const ds = require('../lib/dataset');
const { readJson, writeJson } = require('../lib/csv');
const { freezeHash } = require('../lib/report');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

const MANIFEST = path.join(ds.RESULTS_DIR, 'freeze_manifest.json');

const FILES = [
  'config/frozen.json',
  'config/universe.json',
  'lib/config.js',
  'lib/strategy.js',
  'lib/backtest.js',
  'lib/bot.js',
  'lib/fill.js',
  'lib/metrics.js',
  'lib/indodax.js',
  'lib/store.js',
  'data/spread.json',
  'data/meta.json',
  'data/universe_candidates.json',
  'results/backtest_summary.json',
  'results/backtest_full.json',
  'results/backtest_forward.json',
  'results/backtest_trades.csv',
  'results/backtest_equity.csv',
  'results/backtest_signals.csv',
  'results/recompute.json',
  'logs/export/orders.jsonl',
  'logs/export/equity.jsonl',
  'logs/export/calls.jsonl',
  'logs/export/state.json',
];

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (err) {
    return null;
  }
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ds.ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function build() {
  const files = {};
  const missing = [];
  for (const rel of FILES) {
    const digest = sha256(path.join(ds.ROOT, rel));
    if (digest) files[rel] = digest;
    else missing.push(rel);
  }
  for (const sym of cfg.SYMBOLS) {
    const rel = `data/candles/${sym}_${cfg.tf}.csv`;
    const digest = sha256(path.join(ds.ROOT, rel));
    if (digest) files[rel] = digest;
    else missing.push(rel);
  }

  const manifest = {
    frozen_at_wib: cfg.F.frozen_at_wib,
    generated_at: new Date().toISOString(),
    strategy: cfg.F.strategy.name,
    timeframe: cfg.tfLabel,
    universe: cfg.SYMBOLS,
    freeze_hash: freezeHash(),
    git_commit: gitCommit(),
    node: process.version,
    files,
    missing,
    note: 'Jalankan `node scripts/freeze.js --verify` untuk memastikan tidak ada file yang berubah setelah freeze.',
  };
  writeJson(MANIFEST, manifest);
  console.log(`Manifest freeze ditulis: ${path.relative(ds.ROOT, MANIFEST)}`);
  console.log(`File di-hash : ${Object.keys(files).length}`);
  console.log(`Hash gabungan: ${manifest.freeze_hash.aggregate}`);
  if (missing.length) console.log(`Belum ada   : ${missing.join(', ')}`);
  if (manifest.git_commit) console.log(`Commit       : ${manifest.git_commit}`);
}

function verify() {
  const manifest = readJson(MANIFEST, null);
  if (!manifest) throw new Error('Manifest belum ada. Jalankan node scripts/freeze.js dulu.');
  let changed = 0;
  let missing = 0;
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = sha256(path.join(ds.ROOT, rel));
    if (!actual) { missing++; console.log(`[HILANG]  ${rel}`); }
    else if (actual !== expected) { changed++; console.log(`[BERUBAH] ${rel}`); }
  }
  const nowHash = freezeHash().aggregate;
  const hashOk = nowHash === manifest.freeze_hash.aggregate;
  if (!hashOk) console.log(`[BERUBAH] hash gabungan aturan: ${nowHash} != ${manifest.freeze_hash.aggregate}`);
  console.log(`\nDiverifikasi ${Object.keys(manifest.files).length} file: ${changed} berubah, ${missing} hilang.`);
  console.log(hashOk && !changed && !missing ? 'FREEZE UTUH.' : 'FREEZE TIDAK UTUH.');
  if (!hashOk || changed || missing) process.exitCode = 1;
}

try {
  if (args.verify) verify(); else build();
} catch (err) { console.error(err.message); process.exit(1); }
