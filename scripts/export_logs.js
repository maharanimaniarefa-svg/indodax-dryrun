#!/usr/bin/env node
'use strict';
/**
 * Mengekspor log mentah dari Upstash (atau file store) menjadi:
 *   logs/export/<nama>.jsonl   -> log mentah apa adanya (untuk audit)
 *   logs/export/<nama>.csv     -> versi tabel untuk dibaca manusia
 *   logs/export/state.json
 *   logs/export/manifest.json  -> jumlah baris + SHA-256 tiap file
 *
 *   node scripts/export_logs.js
 *   STORE=file node scripts/export_logs.js            # dari ./logs
 *   node scripts/export_logs.js --out=logs/export
 *
 * Jalankan setelah jendela forward selesai, lalu commit logs/export/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('../lib/store');
const { ensureDir, writeJson } = require('../lib/csv');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

const OUT = path.resolve(String(args.out || path.join(__dirname, '..', 'logs', 'export')));
const LIMITS = {
  calls: 5000,
  orders: 5000,
  equity: 5000,
  errors: 3000,
  snapshots: 20000,
  kill: 500,
};

const csvEscape = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (head, rows) => [head, ...rows].map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

function stateRows(state) {
  if (!state) return [];
  const pos = Object.entries(state.positions || {}).map(([sym, p]) => ({
    symbol: sym, qty: p.qty, entryFill: p.entryFill, entryFee: p.entryFee,
    entryTime: p.entryTime, entrySignalTime: p.entrySignalTime, lastBid: p.lastBid,
  }));
  return [{ ...state, positions: pos }];
}

async function main() {
  ensureDir(OUT);
  const store = createStore(process.env);
  const state = await store.getState();
  const data = {};
  for (const [name, limit] of Object.entries(LIMITS)) {
    process.stdout.write(`Mengambil ${name}... `);
    const rows = await store.list(name, limit);
    data[name] = rows;
    console.log(`${rows.length} baris`);
  }

  const files = {};
  const write = (name, text) => {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, text);
    files[name] = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
  };

  write('state.json', JSON.stringify(state, null, 2) + '\n');
  for (const [name, rows] of Object.entries(data)) {
    write(`${name}.jsonl`, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  }

  write('orders.csv', csv(
    ['id', 'at_utc', 'server_time', 'candle_time_utc', 'symbol', 'side', 'qty', 'signal_price',
      'best_bid', 'best_ask', 'fill_price', 'notional_idr', 'fee_idr', 'spread_pct',
      'slippage_vs_signal_pct', 'realized_pnl_idr', 'levels', 'complete', 'reason'],
    data.orders.map(o => [
      o.id, o.at, o.serverTime, o.candleTime ? new Date(o.candleTime * 1000).toISOString() : '',
      o.symbol, o.side, o.qty, o.signalPrice, o.bestBid, o.bestAsk, o.fillPrice,
      Math.round(o.notional), Math.round(o.fee), o.spreadPct, o.slippageVsSignalPct,
      Number.isFinite(o.realizedPnl) ? Math.round(o.realizedPnl) : '', o.levels ?? '', o.complete ?? '',
      o.reason,
    ])
  ));

  write('equity.csv', csv(
    ['at_utc', 'server_time', 'day_wib', 'equity_idr', 'cash_idr', 'invested_idr', 'npos', 'source'],
    data.equity.map(e => [
      e.at, e.serverTime, e.dayKey, Math.round(e.equity), Math.round(e.cash),
      Math.round(e.invested), e.npos, e.source,
    ])
  ));

  write('calls.csv', csv(
    ['at_utc', 'server_time', 'duration_ms', 'equity_idr', 'cash_idr', 'npos', 'orders', 'processed',
      'errors', 'kill_active', 'day_wib', 'day_pnl_pct', 'day_blocked'],
    data.calls.map(c => [
      c.at, c.serverTime, c.durationMs, Math.round(c.equity), Math.round(c.cash),
      (c.positions || []).length, c.orders, (c.processed || []).length,
      (c.errors || []).length, c.killSwitch?.active ? 1 : 0, c.day?.key || '',
      Number.isFinite(c.day?.pnlPct) ? (c.day.pnlPct * 100).toFixed(4) : '',
      c.day?.blocked ? 1 : 0,
    ])
  ));

  write('errors.csv', csv(
    ['at_utc', 'scope', 'symbol', 'message'],
    data.errors.map(e => [e.at, e.scope, e.symbol || '', e.message])
  ));

  write('snapshots.csv', csv(
    ['at_utc', 'server_time', 'symbol', 'bid', 'ask', 'spread_pct', 'bid_notional_top10', 'ask_notional_top10'],
    data.snapshots.map(s => [
      s.at, s.serverTime, s.symbol, s.bid, s.ask, s.spreadPct,
      Math.round(s.bidNotionalTop10 || 0), Math.round(s.askNotionalTop10 || 0),
    ])
  ));

  write('kill.csv', csv(
    ['at_utc', 'active', 'source', 'reason'],
    data.kill.map(k => [k.at, k.active ? 1 : 0, k.source || '', k.reason || ''])
  ));

  const manifest = {
    exported_at: new Date().toISOString(),
    store: process.env.STORE === 'file' ? 'file' : 'upstash',
    state: state ? { updatedAt: state.updatedAt, cash: state.cash, positions: Object.keys(state.positions || {}).length } : null,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    files,
    note: 'JSONL adalah log mentah; CSV adalah turunan. Manifest memuat SHA-256 untuk verifikasi.',
  };
  writeJson(path.join(OUT, 'manifest.json'), manifest);

  console.log(`\nEkspor selesai: ${OUT}`);
  console.log(`Baris: ${Object.entries(manifest.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
