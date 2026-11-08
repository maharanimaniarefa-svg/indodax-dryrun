#!/usr/bin/env node
'use strict';
/**
 * Menjalankan satu tick bot secara lokal memakai API Indodax sungguhan
 * (dry-run: tidak ada API key, tidak ada order nyata).
 *
 *   node scripts/tick_local.js                 # simpan di ./logs
 *   node scripts/tick_local.js --dir=tmp/test  # folder lain
 *   node scripts/tick_local.js --no-window     # paksa di luar jendela (uji)
 *
 * Di Vercel gunakan /api/tick; skrip ini untuk uji lokal & bukti idempotensi.
 */
const path = require('path');
const fs = require('fs');
const { runTick } = require('../lib/bot');
const { createStore } = require('../lib/store');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

async function main() {
  process.env.STORE = process.env.STORE || 'file';
  if (args.dir) process.env.LOG_DIR = path.resolve(String(args.dir));
  if (!process.env.LOG_DIR) process.env.LOG_DIR = path.resolve(__dirname, '..', 'logs');
  fs.mkdirSync(process.env.LOG_DIR, { recursive: true });

  const store = createStore(process.env);
  const out = await runTick({ store, enforceWindow: !args['no-window'] });

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const idr = x => (Number.isFinite(x) ? 'Rp ' + Math.round(x).toLocaleString('id-ID') : 'n/a');
  const pct = x => (Number.isFinite(x) ? (x * 100).toFixed(2) + '%' : 'n/a');

  console.log('=== TICK DRY-RUN ===');
  console.log(`Waktu server : ${out.at || '-'}`);
  console.log(`Status       : ${out.frozen ? 'SELESAI (frozen)' : out.waiting ? 'MENUNGGU JENDELA' : out.skipped ? 'DILEWATI (lock)' : 'OK'}`);
  if (out.message) console.log(`Pesan        : ${out.message}`);
  console.log(`Ekuitas      : ${idr(out.equity)} | kas ${idr(out.cash)}`);
  if (out.day) console.log(`Hari WIB     : ${out.day.key} | PnL harian ${pct(out.day.pnlPct)}${out.day.blocked ? ' | ENTRY DIBLOKIR' : ''}`);
  if (out.killSwitch) console.log(`Kill switch  : ${out.killSwitch.active ? 'AKTIF' : 'nonaktif'}${out.killSwitch.reason ? ' (' + out.killSwitch.reason + ')' : ''}`);
  if (out.processed) console.log(`Diproses     : ${out.processed.length ? out.processed.join(', ') : '-'}`);

  if (out.orders && out.orders.length) {
    console.log(`\nOrder (${out.orders.length}):`);
    for (const o of out.orders) {
      console.log(`  ${o.side.padEnd(4)} ${o.symbol.padEnd(9)} qty ${o.qty} @ ${o.fillPrice} | notional ${idr(o.notional)} | fee ${idr(o.fee)} | spread ${pct(o.spreadPct)} | slip ${pct(o.slippageVsSignalPct)}`);
    }
  }
  if (out.signals && out.signals.length) {
    console.log('\nSinyal:');
    for (const s of out.signals) {
      console.log(`  ${s.symbol.padEnd(9)} ${s.action.padEnd(6)} ${s.reason || ''}${s.reason ? ' | ' : ''}close ${s.close}`);
    }
  }
  if (out.errors && out.errors.length) {
    console.log(`\nError (${out.errors.length}):`);
    for (const e of out.errors) console.log(`  [${e.scope}] ${e.message}`);
  }
  if (out.notes && out.notes.length) {
    console.log('\nCatatan:');
    for (const n of out.notes) console.log('  - ' + n);
  }
  console.log(`\nLog tersimpan di ${process.env.LOG_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
