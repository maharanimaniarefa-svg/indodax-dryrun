#!/usr/bin/env node
'use strict';
/**
 * Mengambil snapshot order book untuk mengukur spread & slippage nyata.
 *
 *   node scripts/collect_snapshot.js                  # sekali
 *   node scripts/collect_snapshot.js --rounds=3 --gap=120000
 *
 * Output ditambahkan ke data/spread_samples.jsonl. Jalankan beberapa kali
 * pada jam berbeda, lalu `node scripts/build_spread.js`.
 *
 * Slippage diukur dengan menelusuri depth untuk notional yang sama dengan
 * target posisi (default 10% x Rp100 juta = Rp10 juta), bukan angka karangan.
 */
const path = require('path');
const cfg = require('../lib/config');
const api = require('../lib/indodax');
const ds = require('../lib/dataset');
const { walkBuy, walkSell, bestBid, bestAsk, relSpread } = require('../lib/fill');
const { appendJsonl } = require('../lib/csv');
const { sleep } = require('../lib/time');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

const NOTIONAL = Number(args.notional || Math.round(cfg.capital * cfg.allocPct));
const ROUNDS = Math.max(1, Number(args.rounds || 1));
const GAP_MS = Math.max(1000, Number(args.gap || 3000));
const OUT = args.out ? path.resolve(String(args.out)) : path.join(ds.DATA_DIR, 'spread_samples.jsonl');

async function oneRound(round, total) {
  const at = new Date().toISOString();
  const rows = [];
  for (const pair of cfg.UNIVERSE) {
    try {
      const book = await api.getDepth(pair.id, { timeoutMs: 10000, retries: 1 });
      const bid = bestBid(book);
      const ask = bestAsk(book);
      if (!(bid > 0) || !(ask > 0)) {
        console.log(`  ${pair.symbol.padEnd(9)} order book kosong`);
        continue;
      }
      const buy = walkBuy(book.sell, NOTIONAL);
      const sell = walkSell(book.buy, buy.qty);
      const row = {
        at,
        round,
        symbol: pair.symbol,
        notional_idr: NOTIONAL,
        bid,
        ask,
        spreadPct: relSpread(book),
        buyAvg: buy.avgPrice,
        sellAvg: sell.avgPrice,
        slippageBuyPct: buy.avgPrice / ask - 1,
        slippageSellPct: 1 - sell.avgPrice / bid,
        complete: buy.complete && sell.complete,
        buyLevels: buy.levels,
        sellLevels: sell.levels,
        bidNotionalTop10: book.buy.slice(0, 10).reduce((a, [p, q]) => a + p * q, 0),
        askNotionalTop10: book.sell.slice(0, 10).reduce((a, [p, q]) => a + p * q, 0),
      };
      rows.push(row);
      console.log(`  ${pair.symbol.padEnd(9)} spread ${(row.spreadPct * 100).toFixed(3)}% | slip beli ${(row.slippageBuyPct * 100).toFixed(3)}% | jual ${(row.slippageSellPct * 100).toFixed(3)}% | level ${buy.levels}/${sell.levels}${row.complete ? '' : ' (book tipis)'}`);
    } catch (err) {
      console.log(`  ${pair.symbol.padEnd(9)} GAGAL ${err.message}`);
    }
    await sleep(api.REQUEST_GAP_MS);
  }
  if (rows.length) appendJsonl(OUT, rows);
  console.log(`  ${rows.length}/${cfg.UNIVERSE.length} snapshot tersimpan (ronde ${round}/${total}).\n`);
  return rows.length;
}

async function main() {
  if (!cfg.UNIVERSE.length) throw new Error('config/universe.json kosong');
  console.log(`Snapshot order book: ${cfg.UNIVERSE.length} pair, notional Rp ${NOTIONAL.toLocaleString('id-ID')}, ${ROUNDS} ronde.`);
  console.log(`Output: ${OUT}\n`);
  let total = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    total += await oneRound(i, ROUNDS);
    if (i < ROUNDS) await sleep(GAP_MS);
  }
  console.log(`Selesai: ${total} baris. Berikutnya: node scripts/build_spread.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
