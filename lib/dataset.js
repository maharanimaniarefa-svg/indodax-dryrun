'use strict';
const path = require('path');
const cfg = require('./config');
const { readCandles, writeCandles, ensureDir } = require('./csv');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CANDLE_DIR = path.join(DATA_DIR, 'candles');
const RESULTS_DIR = path.join(ROOT, 'results');
const LOGS_DIR = path.join(ROOT, 'logs');

function candleFile(symbol) {
  return path.join(CANDLE_DIR, `${symbol}_${cfg.tf}.csv`);
}

function loadCandles(symbol) {
  return readCandles(candleFile(symbol));
}

function loadAll(symbols = cfg.SYMBOLS) {
  const out = {};
  for (const s of symbols) {
    const c = loadCandles(s);
    if (c && c.length) out[s] = c;
  }
  return out;
}

function saveCandles(symbol, candles) {
  ensureDir(CANDLE_DIR);
  writeCandles(candleFile(symbol), candles);
}

module.exports = {
  ROOT,
  DATA_DIR,
  CANDLE_DIR,
  RESULTS_DIR,
  LOGS_DIR,
  candleFile,
  loadCandles,
  loadAll,
  saveCandles,
};
