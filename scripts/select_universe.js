#!/usr/bin/env node
'use strict';
/**
 * Memilih universe 3-10 pasangan IDR.
 *
 * Aturan pemilihan (dibekukan sebelum forward test):
 *  1. Kandidat: 60 pair IDR dengan volume 24 jam tertinggi saat ini + daftar
 *     pair mayor yang sudah lama ada (mengurangi bias "hanya yang ramai hari ini").
 *  2. Buang stablecoin, token emas/indeks, pair maintenance/suspended.
 *  3. Saring dengan candle 1D: harus punya data >= 80% dari 30 hari pertama
 *     periode backtest (pair yang baru listed otomatis gugur).
 *  4. Ukur likuiditas pada AWAL periode backtest: median nilai transaksi
 *     harian (IDR) 30 hari pertama, BUKAN volume hari ini.
 *  5. Ambil kandidat teratas, unduh candle 4h 3 tahun, syarat cakupan >= 90%.
 *  6. Pilih 8 pair dengan likuiditas awal tertinggi.
 *
 * Hasil: config/universe.json, data/candles/*.csv, data/universe_candidates.json
 */
const path = require('path');
const cfg = require('../lib/config');
const api = require('../lib/indodax');
const { median } = require('../lib/strategy');
const ds = require('../lib/dataset');
const { writeJson, ensureDir } = require('../lib/csv');
const { nowSec } = require('../lib/time');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.replace(/^--/, '').split('=');
  return [m[0], m[1] === undefined ? true : m[1]];
}));

const CANDIDATE_TOP = Number(args.top || 60);
const PICK = Number(args.pick || 8);
const TF = cfg.tf;
const TF_SEC = cfg.tfSec;
const BACKTEST_START = cfg.backtestStart;
const BACKTEST_END = cfg.backtestEnd;
const FETCH_START = BACKTEST_START - cfg.warmupBars * TF_SEC;
const EARLY_WINDOW_END = BACKTEST_START + 30 * 86400;

// Pair yang bukan aset kripto berisiko / tidak cocok untuk trend following.
const EXCLUDE_BASE = new Set([
  'USDT', 'USDC', 'USDD', 'DAI', 'TUSD', 'USAT', 'USDX', 'AUSD', 'OKUSD',
  'XAUT', 'PAXG', 'IDX', 'USDE', 'FDUSD', 'PYUSD',
]);

// Pair mayor yang sudah ada jauh sebelum 2023.
const MAJORS = [
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'LINK', 'AVAX', 'DOT',
  'LTC', 'BCH', 'TRX', 'TON', 'POL', 'MATIC', 'ATOM', 'NEAR', 'UNI', 'SUI',
  'APT', 'ARB', 'OP', 'INJ', 'FIL', 'ETC', 'XLM', 'HBAR', 'ICP', 'RENDER',
  'ALGO', 'VET', 'SAND', 'MANA', 'AXS', 'GALA', 'THETA', 'EGLD', 'FLOW',
  'CHZ', 'ENJ', 'BAT', 'ZIL', 'WAVES', 'KSM', 'NEO', 'IOTA', 'XTZ', 'QTUM',
  'ZRX', 'SNX', 'CRV', 'COMP', 'MKR', 'AAVE', 'SUSHI', 'YFI', 'LRC', 'ANKR',
  'STORJ', 'KNC', 'BAND', 'RSR', 'GRT', 'CHR', 'CELO', 'ONE', 'RVN', 'IOST',
  'ONT', 'ICX', 'ARK', 'STEEM', 'DGB', 'DASH', 'ZEC', 'XMR', 'LSK',
];

const fmtIdr = x => {
  if (!Number.isFinite(x)) return 'n/a';
  if (x >= 1e12) return (x / 1e12).toFixed(2) + ' T';
  if (x >= 1e9) return (x / 1e9).toFixed(2) + ' M';
  if (x >= 1e6) return (x / 1e6).toFixed(2) + ' jt';
  return Math.round(x).toLocaleString('id-ID');
};

/** Likuiditas awal dari candle 1D (1 bar = 1 hari). */
async function screenDaily(m) {
  const from = BACKTEST_START - 10 * 86400;
  const to = EARLY_WINDOW_END + 2 * 86400;
  const rows = await api.getHistory(m.symbol, '1D', from, to);
  const early = rows.filter(c => c.t >= BACKTEST_START && c.t < EARLY_WINDOW_END);
  const dailyTurnover = early.map(c => c.c * c.v).filter(v => v > 0);
  return {
    days: early.length,
    coverage: early.length / 30,
    medianTurnoverIdr: median(dailyTurnover),
  };
}

async function main() {
  const t0 = Date.now();
  console.log('Mengambil metadata pair dan ticker...');
  const [pairs, increments, tickers] = await Promise.all([
    api.getPairs(),
    api.getPriceIncrements(),
    api.getTickerAll(),
  ]);

  const byBase = new Map();
  for (const p of pairs) {
    if (!p.id.endsWith('idr')) continue;
    if (Number(p.is_maintenance) === 1 || Number(p.is_market_suspended) === 1) continue;
    if (EXCLUDE_BASE.has(String(p.traded_currency_unit || '').toUpperCase())) continue;
    const meta = api.pairMeta(p, increments);
    const vol = Number(tickers[p.ticker_id] && tickers[p.ticker_id].vol_idr) || 0;
    const prev = byBase.get(meta.base);
    if (!prev || vol > prev.vol24h) byBase.set(meta.base, { ...meta, vol24h: vol });
  }

  const all = [...byBase.values()];
  const top = [...all].sort((a, b) => b.vol24h - a.vol24h).slice(0, CANDIDATE_TOP);
  const majorSet = new Set(MAJORS);
  const majors = all.filter(m => majorSet.has(String(m.base).toUpperCase()));

  const candidates = new Map();
  for (const m of [...top, ...majors]) candidates.set(m.symbol, m);

  console.log(`Kandidat: ${candidates.size} pair (top ${CANDIDATE_TOP} volume + ${majors.length} mayor).`);
  console.log(`Backtest: ${new Date(BACKTEST_START * 1000).toISOString().slice(0, 10)} s/d ${new Date(BACKTEST_END * 1000).toISOString().slice(0, 10)}`);
  console.log('Tahap 1: saring likuiditas 30 hari pertama dengan candle 1D...\n');

  const screened = [];
  let i = 0;
  for (const m of candidates.values()) {
    i++;
    try {
      const s = await screenDaily(m);
      const ok = s.coverage >= 0.8 && Number.isFinite(s.medianTurnoverIdr) && s.medianTurnoverIdr > 0;
      screened.push({ ...m, ...s, earlyOk: ok });
      console.log(`[1:${i}/${candidates.size}] ${m.symbol.padEnd(10)} ${ok ? 'OK   ' : 'GAGAL'} hari=${s.days}/30 likuiditas awal Rp ${fmtIdr(s.medianTurnoverIdr)}`);
    } catch (err) {
      screened.push({ ...m, days: 0, coverage: 0, medianTurnoverIdr: NaN, earlyOk: false, err: err.message });
      console.log(`[1:${i}/${candidates.size}] ${m.symbol.padEnd(10)} GAGAL fetch: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, api.REQUEST_GAP_MS));
  }

  const eligible = screened.filter(s => s.earlyOk).sort((a, b) => b.medianTurnoverIdr - a.medianTurnoverIdr);
  console.log(`\nLolos saringan awal: ${eligible.length} pair.`);

  console.log('\nTahap 2: unduh candle 4h 3 tahun untuk kandidat teratas...\n');
  const expectedFull = Math.round((BACKTEST_END - BACKTEST_START) / TF_SEC);
  const checked = [];
  const batchSize = Math.max(PICK * 2, 16);

  for (let k = 0; k < eligible.length; k += batchSize) {
    const batch = eligible.slice(k, k + batchSize);
    for (const m of batch) {
      const t1 = Date.now();
      let fetched;
      try {
        fetched = await api.fetchHistoryBackward(m.symbol, {
          tf: TF, tfSec: TF_SEC, startSec: FETCH_START, endSec: nowSec(),
          onProgress: p => { if (p.requests % 5 === 0) process.stdout.write(`  ${m.symbol}: ${p.got} bar\n`); },
        });
      } catch (err) {
        console.log(`[2] ${m.symbol}: GAGAL ${err.message}`);
        checked.push({ ...m, fullOk: false, reason: 'fetch gagal: ' + err.message });
        continue;
      }
      const candles = fetched.data;
      const inBacktest = candles.filter(c => c.t >= BACKTEST_START && c.t < BACKTEST_END);
      const coverageFull = expectedFull > 0 ? inBacktest.length / expectedFull : 0;
      const early = inBacktest.filter(c => c.t < EARLY_WINDOW_END);
      const earlyMedian = median(early.map(c => c.c * c.v));
      const fullOk = coverageFull >= 0.9;

      checked.push({
        ...m,
        fullOk,
        reason: fullOk ? 'lolos' : `cakupan 3 tahun rendah (${(coverageFull * 100).toFixed(0)}%)`,
        bars: candles.length,
        coverageFull,
        earlyMedianTurnoverIdr: earlyMedian,
        firstBar: candles[0] ? new Date(candles[0].t * 1000).toISOString() : null,
        lastBar: candles[candles.length - 1] ? new Date(candles[candles.length - 1].t * 1000).toISOString() : null,
        requests: fetched.requests,
        _candles: candles,
      });
      console.log(`[2] ${m.symbol.padEnd(10)} ${fullOk ? 'OK   ' : 'GAGAL'} cakupan ${(coverageFull * 100).toFixed(0)}% | ${candles.length} bar, ${fetched.requests} req, ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    }
    const passed = checked.filter(c => c.fullOk).sort((a, b) => b.earlyMedianTurnoverIdr - a.earlyMedianTurnoverIdr);
    if (passed.length >= PICK) break;
  }

  const eligibleFull = checked.filter(c => c.fullOk).sort((a, b) => b.earlyMedianTurnoverIdr - a.earlyMedianTurnoverIdr);
  const selected = eligibleFull.slice(0, PICK);
  if (selected.length < 3) throw new Error(`Hanya ${selected.length} pair memenuhi syarat; minimal 3.`);

  const universe = {
    selected_at: new Date().toISOString(),
    selection_rule: 'median nilai transaksi harian IDR 30 hari pertama backtest; kandidat top volume + mayor; cakupan 1D >= 80% dan 4h 3 tahun >= 90%',
    timeframe: cfg.tfLabel,
    pairs: selected.map(r => ({
      id: r.id,
      symbol: r.symbol,
      ticker: r.ticker,
      base: r.base,
      description: r.description,
      qtyStep: r.qtyStep,
      priceStep: r.priceStep,
      apiMinOrderIdr: r.apiMinOrderIdr,
      takerPercentApi: r.takerPercentApi,
      earlyMedianTurnoverIdr: Math.round(r.earlyMedianTurnoverIdr),
      coverage: Number(r.coverageFull.toFixed(4)),
      firstBar: r.firstBar,
    })),
  };

  writeJson(path.join(ds.ROOT, 'config', 'universe.json'), universe);
  writeJson(path.join(ds.DATA_DIR, 'universe_candidates.json'), {
    generated_at: new Date().toISOString(),
    backtest_start: new Date(BACKTEST_START * 1000).toISOString(),
    early_window_days: 30,
    candidate_top: CANDIDATE_TOP,
    pick: PICK,
    selected: universe.pairs.map(p => p.symbol),
    screening_1d: screened.map(({ ...s }) => ({
      symbol: s.symbol,
      days: s.days,
      coverage: Number(s.coverage.toFixed(4)),
      earlyMedianTurnoverIdr: Number.isFinite(s.medianTurnoverIdr) ? Math.round(s.medianTurnoverIdr) : null,
      earlyOk: s.earlyOk,
    })),
    verified_4h: checked.map(({ _candles, ...r }) => ({
      symbol: r.symbol,
      ok: r.fullOk,
      reason: r.reason,
      bars: r.bars,
      coverageFull: Number((r.coverageFull || 0).toFixed(4)),
      earlyMedianTurnoverIdr: Number.isFinite(r.earlyMedianTurnoverIdr) ? Math.round(r.earlyMedianTurnoverIdr) : null,
    })),
  });

  ensureDir(ds.CANDLE_DIR);
  for (const r of selected) ds.saveCandles(r.symbol, r._candles);
  if (!selected.some(r => r.symbol === cfg.benchSymbol)) {
    console.log(`\nMengunduh benchmark ${cfg.benchSymbol}...`);
    const b = await api.fetchHistoryBackward(cfg.benchSymbol, { tf: TF, tfSec: TF_SEC, startSec: FETCH_START, endSec: nowSec() });
    ds.saveCandles(cfg.benchSymbol, b.data);
  }

  writeJson(path.join(ds.DATA_DIR, 'meta.json'), {
    fetched_at: new Date().toISOString(),
    source: 'https://indodax.com/tradingview/history_v2',
    timeframe: TF,
    universe: selected.map(r => r.symbol),
    elapsed_sec: Number(((Date.now() - t0) / 1000).toFixed(1)),
  });

  console.log('\n=== UNIVERSE TERPILIH (' + selected.length + ' pair) ===');
  for (const r of selected) {
    console.log(`${r.symbol.padEnd(10)} likuiditas awal Rp ${fmtIdr(r.earlyMedianTurnoverIdr).padStart(16)} | cakupan ${(r.coverageFull * 100).toFixed(0)}%`);
  }
  console.log(`\nDisimpan ke config/universe.json dan data/candles/. Total ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main().catch(err => { console.error(err); process.exit(1); });
