'use strict';
/**
 * Mesin backtest.
 *
 * Aturan waktu (sama dengan bot):
 *   - sinyal dihitung dari candle s yang SUDAH TERTUTUP
 *   - eksekusi pada pembukaan bar berikutnya (s+1), setara dengan tick pertama
 *     setelah candle s tutup
 *   - tidak ada data masa depan: sinyal s hanya memakai candle <= s
 *
 * Biaya:
 *   - fee taker beli/jual dari config (all-in, tarif resmi)
 *   - spread: beli di ask, jual di bid -> setengah spread dari snapshot order book
 *   - slippage: hasil pengukuran depth walk untuk order ~10% ekuitas
 *   - harga fill dibulatkan ke kenaikan harga (priceStep) pasangan
 */
const { computeSignals, floorStep, medianDailyTurnover } = require('./strategy');
const { wibDayKey } = require('./time');
const cfg = require('./config');

const DEFAULT_SPREAD_PCT = 0.0020;   // fallback konservatif bila snapshot belum ada
const DEFAULT_SLIPPAGE_PCT = 0.0005;

function roundUp(p, step) {
  if (!(step > 0)) return p;
  return Math.ceil(p / step - 1e-9) * step;
}
function roundDown(p, step) {
  if (!(step > 0)) return p;
  return Math.floor(p / step + 1e-9) * step;
}

/** Rata-rata nilai transaksi harian 180 bar terakhir (30 hari pada 4h). */
function rollingDailyTurnover(candles, bars = 180) {
  const out = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c * candles[i].v;
    if (i >= bars) sum -= candles[i - bars].c * candles[i - bars].v;
    const n = Math.min(i + 1, bars);
    out[i] = n > 0 ? sum / n * (86400 / cfg.tfSec) : 0;
  }
  return out;
}

function buildPair(data, pair, spreadMap) {
  const candles = data[pair.symbol];
  if (!candles || candles.length === 0) return null;
  const signals = computeSignals(candles, cfg.N, cfg.X);
  const turnover = rollingDailyTurnover(candles, cfg.F.rank_lookback_bars || 180);
  const byTime = new Map();
  for (let i = 0; i < candles.length; i++) byTime.set(candles[i].t, i);

  const s = spreadMap[pair.symbol] || {};
  const spreadPct = Number.isFinite(s.spreadPct) ? s.spreadPct : DEFAULT_SPREAD_PCT;
  const slippagePct = Number.isFinite(s.slippagePct) ? s.slippagePct : DEFAULT_SLIPPAGE_PCT;

  return {
    ...pair,
    candles,
    signals,
    turnover,
    byTime,
    spreadPct,
    slippagePct,
    halfSpread: spreadPct / 2,
    priceStep: pair.priceStep || 1,
    qtyStep: pair.qtyStep || 1e-8,
  };
}

/**
 * Jalankan backtest.
 * data: { SYMBOL: [{t,o,h,l,c,v}] } (harus sudah termasuk warm-up)
 * pairs: config/universe.json pairs
 */
function runBacktest(opts) {
  const {
    data,
    pairs,
    startTime,
    endTime,
    capital = cfg.capital,
    feeBuy = cfg.feeBuy,
    feeSell = cfg.feeSell,
    spreadMap = {},
    maxPositions = cfg.maxPositions,
    allocPct = cfg.allocPct,
    dailyLossLimitPct = cfg.dailyLossLimitPct,
    minOrderIdr = cfg.minOrderIdr,
    liquidityCapPct = cfg.liquidityCapPct,
    enforceDailyLossLimit = true,
  } = opts;

  const book = new Map();
  for (const p of pairs) {
    const b = buildPair(data, p, spreadMap);
    if (b) book.set(p.symbol, b);
  }
  if (!book.size) throw new Error('Tidak ada data candle untuk universe.');

  // Timeline gabungan (semua pair memakai grid 4h yang sama).
  const timeSet = new Set();
  for (const b of book.values()) {
    for (const c of b.candles) {
      if (c.t >= startTime && c.t <= endTime) timeSet.add(c.t);
    }
  }
  const times = [...timeSet].sort((a, b) => a - b);
  if (!times.length) throw new Error('Tidak ada bar di rentang waktu yang diminta.');

  let cash = capital;
  const positions = new Map();     // symbol -> position
  const trades = [];
  const orders = [];
  const signalsLog = [];
  const equity = [];
  const skipped = [];

  let dayKey = null;
  let dayStartEquity = capital;
  let entriesBlockedDay = null;

  for (const t of times) {
    const key = wibDayKey(t);
    if (key !== dayKey) {
      dayKey = key;
      // ekuitas awal hari = nilai pasar pada penutupan bar sebelumnya
      let mv = 0;
      for (const [sym, p] of positions) {
        const b = book.get(sym);
        const idx = b.byTime.get(t);
        const prev = idx !== undefined && idx > 0 ? b.candles[idx - 1].c : (idx !== undefined ? b.candles[idx].o : p.entryFill);
        mv += p.qty * prev;
      }
      dayStartEquity = cash + mv;
    }

    const pnlToday = dayStartEquity > 0
      ? (() => {
        let mv = 0;
        for (const [sym, p] of positions) {
          const b = book.get(sym);
          const idx = b.byTime.get(t);
          // mark-to-market memakai close bar saat ini (bukan close sebelumnya)
          const px = idx !== undefined ? b.candles[idx].c : p.entryFill;
          mv += p.qty * px;
        }
        return (cash + mv) / dayStartEquity - 1;
      })()
      : 0;
    if (enforceDailyLossLimit && pnlToday <= -dailyLossLimitPct) entriesBlockedDay = key;

    // ---------- 1. KELUAR (isi dulu supaya modal bisa dipakai masuk) ----------
    for (const [sym, pos] of [...positions]) {
      const b = book.get(sym);
      const idx = b.byTime.get(t);
      if (idx === undefined) continue;
      const sig = b.signals[idx - 1];
      if (!sig || !sig.exit) continue;

      const open = b.candles[idx].o;
      const fillRaw = open * (1 - b.halfSpread - b.slippagePct);
      const fill = Math.max(b.priceStep, roundDown(fillRaw, b.priceStep));
      const qty = pos.qty;
      const proceeds = fill * qty;
      const fee = proceeds * feeSell;
      cash += proceeds - fee;

      const entryMid = Number.isFinite(pos.entryMid) ? pos.entryMid : pos.entryFill;
      const exitMid = open;
      // Laba kotor diukur dari harga mid eksekusi (open bar), bukan close sinyal.
      const grossPnl = (exitMid - entryMid) * qty;
      const netPnl = proceeds - fee - (pos.entryFill * qty + pos.entryFee);
      const costs = grossPnl - netPnl;
      const entrySpreadPct = Number.isFinite(pos.entrySpreadPct) ? pos.entrySpreadPct : b.spreadPct;
      const entrySlippagePct = Number.isFinite(pos.entrySlippagePct) ? pos.entrySlippagePct : b.slippagePct;
      const spreadCost = qty * (entryMid * entrySpreadPct / 2 + exitMid * b.halfSpread);
      const slippageCost = qty * (entryMid * entrySlippagePct + exitMid * b.slippagePct);
      const exitNotional = proceeds;

      trades.push({
        symbol: sym,
        entryTime: pos.entryTime,
        exitTime: t,
        entrySignalTime: pos.entrySignalTime,
        exitSignalTime: sig.t,
        entrySignalPrice: pos.entrySignalPrice,
        exitSignalPrice: sig.close,
        entryMid,
        exitMid,
        entryFill: pos.entryFill,
        exitFill: fill,
        qty,
        entryNotional: pos.entryFill * qty,
        exitNotional,
        fees: pos.entryFee + fee,
        spreadCost,
        slippageCost,
        otherCost: costs - pos.entryFee - fee - spreadCost - slippageCost,
        costs,
        grossPnl,
        netPnl,
        returnPct: netPnl / (pos.entryFill * qty + pos.entryFee),
        exitReason: `Close < MA${cfg.X} (sinyal ${new Date(sig.t * 1000).toISOString().slice(0, 16)}Z)`,
      });
      orders.push({
        time: t,
        signalTime: sig.t,
        symbol: sym,
        side: 'SELL',
        qty,
        signalPrice: sig.close,
        fillPrice: fill,
        midPrice: exitMid,
        bestBid: open * (1 - b.halfSpread),
        bestAsk: open * (1 + b.halfSpread),
        notional: exitNotional,
        fee,
        slippageVsSignalPct: fill / sig.close - 1,
        spreadPaidPct: b.halfSpread,
        reason: 'exit',
        levels: 1,
      });
      positions.delete(sym);
    }

    // ---------- 2. MASUK ----------
    const canEnter = !(enforceDailyLossLimit && entriesBlockedDay === key);
    if (canEnter && positions.size < maxPositions) {
      const candidates = [];
      for (const b of book.values()) {
        if (positions.has(b.symbol)) continue;
        const idx = b.byTime.get(t);
        if (idx === undefined || idx < 1) continue;
        const sig = b.signals[idx - 1];
        if (!sig || !sig.entry) continue;
        candidates.push({ b, sig, idx });
      }
      // urutkan likuiditas tertinggi (nilai transaksi 30 hari), seperti versi UTS
      candidates.sort((x, y) => y.b.turnover[y.idx - 1] - x.b.turnover[x.idx - 1]);

      for (const { b, sig, idx } of candidates) {
        if (positions.size >= maxPositions) break;
        const open = b.candles[idx].o;
        const fill = Math.max(b.priceStep, roundUp(open * (1 + b.halfSpread + b.slippagePct), b.priceStep));

        // ekuitas estimasi pada penutupan sinyal
        let eqEst = cash;
        for (const [sym, p] of positions) {
          const bb = book.get(sym);
          const ii = bb.byTime.get(t);
          const prev = ii !== undefined && ii > 0 ? bb.candles[ii - 1].c : p.entryFill;
          eqEst += p.qty * prev;
        }

        const dailyTurnover = b.turnover[idx - 1];
        const target = Math.min(allocPct * eqEst, liquidityCapPct * dailyTurnover, cash);
        let qty = floorStep(target / (fill * (1 + feeBuy)), b.qtyStep);
        let notional = qty * fill;
        if (notional > cash) {
          qty = floorStep(cash / (fill * (1 + feeBuy)), b.qtyStep);
          notional = qty * fill;
        }
        if (!(qty > 0) || notional < minOrderIdr) {
          skipped.push({
            time: t, signalTime: sig.t, symbol: b.symbol, reason: 'di bawah minimum order / kas tidak cukup',
            target, qty, notional,
          });
          continue;
        }

        const fee = notional * feeBuy;
        cash -= notional + fee;
        positions.set(b.symbol, {
          symbol: b.symbol,
          qty,
          entryTime: t,
          entrySignalTime: sig.t,
          entrySignalPrice: sig.close,
          entryMid: open,
          entryFill: fill,
          entryFee: fee,
          entrySpreadPct: b.spreadPct,
          entrySlippagePct: b.slippagePct,
          entryLevels: 1,
        });
        orders.push({
          time: t,
          signalTime: sig.t,
          symbol: b.symbol,
          side: 'BUY',
          qty,
          signalPrice: sig.close,
          fillPrice: fill,
          midPrice: open,
          bestBid: open * (1 - b.halfSpread),
          bestAsk: open * (1 + b.halfSpread),
          notional,
          fee,
          slippageVsSignalPct: fill / sig.close - 1,
          spreadPaidPct: b.halfSpread,
          reason: 'entry',
          levels: 1,
        });
      }
    }

    // ---------- 3. Catat sinyal (untuk audit kecocokan dengan bot) ----------
    for (const b of book.values()) {
      const idx = b.byTime.get(t);
      if (idx === undefined || idx < 1) continue;
      const sig = b.signals[idx - 1];
      if (!sig || (!sig.entry && !sig.exit)) continue;
      const acted = orders.some(o => o.signalTime === sig.t && o.symbol === b.symbol);
      signalsLog.push({
        time: sig.t,
        executeTime: t,
        symbol: b.symbol,
        close: sig.close,
        maN: sig.maN,
        maX: sig.maX,
        entry: sig.entry,
        exit: sig.exit,
        acted,
        inPosition: positions.has(b.symbol),
      });
    }

    // ---------- 4. Equity mark-to-market ----------
    let mv = 0;
    for (const [sym, p] of positions) {
      const b = book.get(sym);
      const idx = b.byTime.get(t);
      const px = idx !== undefined ? b.candles[idx].c : p.entryFill;
      mv += p.qty * px;
    }
    equity.push({
      t,
      equity: cash + mv,
      cash,
      invested: mv,
      npos: positions.size,
      dayKey: key,
      blocked: entriesBlockedDay === key,
    });
  }

  const lastTime = times[times.length - 1];
  const openPositions = [...positions.values()].map(p => {
    const b = book.get(p.symbol);
    const idx = b.byTime.get(lastTime);
    const lastPrice = idx !== undefined ? b.candles[idx].c : p.entryFill;
    const marketValue = p.qty * lastPrice;
    const unrealized = marketValue - p.qty * p.entryFill - p.entryFee;
    return {
      symbol: p.symbol,
      qty: p.qty,
      entryTime: p.entryTime,
      entrySignalTime: p.entrySignalTime,
      entryFill: p.entryFill,
      entryFee: p.entryFee,
      lastPrice,
      marketValue,
      unrealized,
      returnPct: unrealized / (p.qty * p.entryFill + p.entryFee),
    };
  });

  return {
    startTime,
    endTime: lastTime,
    capital,
    config: {
      feeBuy, feeSell, maxPositions, allocPct, dailyLossLimitPct,
      minOrderIdr, liquidityCapPct, N: cfg.N, X: cfg.X, tf: cfg.tf,
    },
    equity,
    trades,
    orders,
    signals: signalsLog,
    skipped,
    openPositions,
    finalCash: cash,
    finalEquity: equity.length ? equity[equity.length - 1].equity : capital,
    pairs: [...book.keys()],
  };
}

/** Buy & hold satu aset pada jendela yang sama (acuan benchmark). */
function buyAndHold(candles, startTime, endTime, capital) {
  const rows = candles.filter(c => c.t >= startTime && c.t <= endTime);
  if (rows.length < 2) return null;
  const first = rows[0].c;
  const last = rows[rows.length - 1].c;
  const curve = rows.map(r => ({ t: r.t, equity: capital * r.c / first }));
  let peak = -Infinity;
  let mdd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    mdd = Math.min(mdd, p.equity / peak - 1);
  }
  return {
    symbol: cfg.benchSymbol,
    start: rows[0].t,
    end: rows[rows.length - 1].t,
    totalReturn: last / first - 1,
    maxDrawdown: mdd,
    curve,
  };
}

module.exports = { runBacktest, buyAndHold, rollingDailyTurnover, DEFAULT_SPREAD_PCT, DEFAULT_SLIPPAGE_PCT };
