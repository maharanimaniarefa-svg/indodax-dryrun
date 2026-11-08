'use strict';
/**
 * Konfigurasi beku (frozen). Semua skrip backtest dan endpoint bot membaca
 * file yang sama supaya sinyal, biaya, dan aturan tidak mungkin berbeda.
 *
 * JANGAN ubah config/frozen.json setelah freeze date. Perubahan aturan
 * setelah freeze = pelanggaran aturan UAS.
 */
const frozen = require('../config/frozen.json');

let universe = { pairs: [], selected_at: null };
try {
  universe = require('../config/universe.json');
} catch (err) {
  // universe belum dipilih; skrip select_universe.js akan membuatnya
}

const F = frozen;
const UNIVERSE = universe.pairs || [];
const SYMBOLS = UNIVERSE.map(p => p.symbol);

module.exports = {
  F,
  UNIVERSE,
  SYMBOLS,
  universeMeta: universe,
  tf: F.timeframe.tf,
  tfSec: F.timeframe.seconds,
  tfLabel: F.timeframe.label,
  N: F.strategy.n,
  X: F.strategy.x,
  capital: F.capital_idr,
  maxPositions: F.max_positions,
  allocPct: F.alloc_pct,
  dailyLossLimitPct: F.daily_loss_limit_pct,
  minOrderIdr: F.min_order_idr,
  maxSpreadPct: F.max_spread_pct,
  maxFillSlippagePct: F.max_fill_slippage_pct,
  maxCandleAgeBars: F.max_candle_age_bars,
  liquidityCapPct: F.liquidity_cap_pct,
  feeBuy: F.fees.buy_taker,
  feeSell: F.fees.sell_taker,
  forwardStart: Date.parse(F.forward_start_candle_utc) / 1000,
  forwardEnd: Date.parse(F.forward_end_utc) / 1000,
  backtestStart: Date.parse(F.backtest.start) / 1000,
  backtestEnd: Date.parse(F.backtest.end) / 1000,
  warmupBars: F.backtest.warmup_bars,
  benchSymbol: F.benchmark_symbol,
};
