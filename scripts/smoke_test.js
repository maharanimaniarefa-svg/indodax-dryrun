#!/usr/bin/env node
'use strict';
/**
 * Uji logika bot tanpa jaringan (mock API deterministik).
 *
 *   node scripts/smoke_test.js
 *
 * Membuktikan:
 *   1. entry hanya setelah candle tertutup, fill di ask (bukan close/mid)
 *   2. tick kedua pada candle yang sama tidak menggandakan order (idempotensi)
 *   3. exit dieksekusi di bid dan posisi ditutup
 *   4. kas direkonsiliasi dari order
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { runTick } = require('../lib/bot');
const { FileStore, initialState } = require('../lib/store');
const { sma } = require('../lib/strategy');

const DIR = path.resolve(process.env.SMOKE_DIR || path.join(__dirname, '..', 'tmp', 'smoke'));
const tf = cfg.tfSec;
const SYM = cfg.SYMBOLS[0];

function bar(t, o, h, l, c, v = 100000) {
  return { t, o, h, l, c, v };
}

/** 480 bar datar + 19 bar turun + dua bar terakhir sesuai skenario. */
function buildCandles(lastOpen, lastClose, beforeLastClose = 950) {
  const rows = [];
  const n = 500;
  for (let i = 0; i < n; i++) {
    const t = lastOpen - (n - 1 - i) * tf;
    let c = 1000;
    if (i >= 480 && i < 498) c = 950;
    if (i === 498) c = beforeLastClose;
    if (i === 499) c = lastClose;
    rows.push(bar(t, i === 499 ? lastClose : c, Math.max(c, 1000) * 1.01, Math.min(c, 1000) * 0.99, c));
  }
  return rows;
}

function flatCandles(lastOpen, price = 1000) {
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push(bar(lastOpen - (499 - i) * tf, price, price * 1.01, price * 0.99, price));
  return rows;
}

function makeApi(ctx) {
  return {
    async getServerTime() { return ctx.serverTime; },
    async getPairs() {
      return cfg.UNIVERSE.map(p => ({ id: p.id, is_maintenance: 0, is_market_suspended: 0 }));
    },
    async getHistory(symbol) {
      return symbol === SYM ? ctx.candles : flatCandles(ctx.lastOpen);
    },
    async getDepth(ticker) {
      const p = String(ticker).toUpperCase().replace('_', '');
      if (p === SYM) return { buy: [[ctx.bid, 50000]], sell: [[ctx.ask, 50000]], fetchedAt: ctx.serverTime };
      return { buy: [[999, 50000]], sell: [[1001, 50000]], fetchedAt: ctx.serverTime };
    },
  };
}

async function resetDir() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
}

function dropLocks() {
  fs.rmSync(path.join(DIR, 'locks.json'), { force: true });
}

async function main() {
  assert(cfg.SYMBOLS.length > 0, 'universe kosong');
  await resetDir();
  const store = new FileStore(DIR);
  await store.setState(initialState(1762500000));

  // ---------- skenario 1: entry ----------
  const lastOpen1 = 1762560000;                       // 2026-11-08 04:00 UTC
  const s1 = {
    lastOpen: lastOpen1,
    serverTime: lastOpen1 + tf + 5,
    candles: buildCandles(lastOpen1, 1100),
    bid: 1090, ask: 1100,
  };
  const maX = sma(s1.candles.map(c => c.c), cfg.X).at(-1);
  assert(1100 > maX, 'setup entry harus di atas MA150');
  const out1 = await runTick({ store, deps: { api: makeApi(s1) }, enforceWindow: false });
  assert.strictEqual(out1.orders.length, 1, 'harus ada 1 order BUY');
  assert.strictEqual(out1.orders[0].side, 'BUY');
  assert.strictEqual(out1.orders[0].fillPrice, 1100, 'fill beli harus di ask terbaik');
  console.log(`[PASS] entry: BUY ${out1.orders[0].qty} @ ${out1.orders[0].fillPrice} (ask), bukan close 1100/mid`);

  // ---------- skenario 2: idempotensi ----------
  dropLocks();
  const out2 = await runTick({ store, deps: { api: makeApi(s1) }, enforceWindow: false });
  assert.strictEqual(out2.orders.length, 0, 'tick kedua tidak boleh menambah order');
  console.log('[PASS] idempotensi: tick kedua pada candle yang sama menghasilkan 0 order');

  // ---------- skenario 3: exit ----------
  dropLocks();
  const lastOpen3 = lastOpen1 + tf;
  const s3 = {
    lastOpen: lastOpen3,
    serverTime: lastOpen3 + tf + 5,
    candles: buildCandles(lastOpen3, 800, 1100),
    bid: 800, ask: 801,
  };
  assert(800 < sma(s3.candles.map(c => c.c), cfg.X).at(-1), 'setup exit harus di bawah MA150');
  const out3 = await runTick({ store, deps: { api: makeApi(s3) }, enforceWindow: false });
  assert.strictEqual(out3.orders.length, 1, 'harus ada 1 order SELL');
  assert.strictEqual(out3.orders[0].side, 'SELL');
  assert.strictEqual(out3.orders[0].fillPrice, 800, 'fill jual harus di bid terbaik');
  const state = await store.getState();
  assert(!state.positions[SYM], 'posisi harus tertutup');
  console.log(`[PASS] exit: SELL ${out3.orders[0].qty} @ ${out3.orders[0].fillPrice} (bid), posisi tertutup`);

  // ---------- skenario 4: rekonsiliasi kas ----------
  const orders = (await store.list('orders', 100));
  let cash = cfg.capital;
  for (const o of orders) cash += o.side === 'BUY' ? -(o.notional + o.fee) : (o.notional - o.fee);
  assert(Math.abs(cash - state.cash) < 1, `kas tidak cocok: ${cash} vs ${state.cash}`);
  console.log(`[PASS] kas: Rp ${Math.round(state.cash).toLocaleString('id-ID')} cocok dengan log order (selisih < Rp1)`);

  const calls = await store.list('calls', 10);
  assert.strictEqual(calls.length, 3, 'harus ada 3 call log');
  console.log(`[PASS] log: ${orders.length} order, ${calls.length} call, ${(await store.list('equity', 10)).length} titik ekuitas`);
  console.log('\nSMOKE TEST LULUS.');
  console.log(`Log uji: ${DIR}`);
}

main().catch(err => { console.error('\nSMOKE TEST GAGAL:', err.message); process.exit(1); });
