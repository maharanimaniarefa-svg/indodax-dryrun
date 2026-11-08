'use strict';
/** Metrik kinerja. Dipakai backtest, dashboard, dan skrip hitung ulang. */

const DAY = 86400;

function maxDrawdown(equityValues) {
  let peak = -Infinity;
  let mdd = 0;
  let peakAt = null;
  let troughAt = null;
  let curPeakAt = null;
  for (const p of equityValues) {
    if (p.equity > peak) {
      peak = p.equity;
      curPeakAt = p.t;
    }
    const dd = peak > 0 ? p.equity / peak - 1 : 0;
    if (dd < mdd) {
      mdd = dd;
      peakAt = curPeakAt;
      troughAt = p.t;
    }
  }
  return { mdd, peakAt, troughAt };
}

function yearFraction(startSec, endSec) {
  return Math.max(0, (endSec - startSec) / (365.25 * DAY));
}

function totalReturn(initial, final) {
  return initial > 0 ? final / initial - 1 : 0;
}

function cagr(initial, final, years) {
  if (!(years > 0) || !(initial > 0) || !(final > 0)) return null;
  return Math.pow(final / initial, 1 / years) - 1;
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/**
 * equity: [{ t, equity }] berurutan.
 * trades: [{ entryTime, exitTime, grossPnl, netPnl, fees, costs, returnPct }]
 */
function summarize(equity, trades, opts = {}) {
  const initial = opts.initialCapital ?? (equity[0] ? equity[0].equity : 0);
  const final = equity.length ? equity[equity.length - 1].equity : initial;
  const startSec = equity.length ? equity[0].t : opts.startSec;
  const endSec = equity.length ? equity[equity.length - 1].t : opts.endSec;
  const years = yearFraction(startSec, endSec);
  const { mdd, peakAt, troughAt } = maxDrawdown(equity);

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.grossPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.grossPnl, 0));
  const netProfit = wins.reduce((a, t) => a + t.netPnl, 0);
  const netLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const totalFees = trades.reduce((a, t) => a + (t.fees || 0), 0);
  const totalCosts = trades.reduce((a, t) => a + (t.costs || 0), 0);

  return {
    start: startSec,
    end: endSec,
    years,
    initialCapital: initial,
    finalEquity: final,
    totalReturn: totalReturn(initial, final),
    cagr: cagr(initial, final, years),
    maxDrawdown: mdd,
    mddPeak: peakAt,
    mddTrough: troughAt,
    calmar: mdd < 0 ? cagr(initial, final, years) / Math.abs(mdd) : null,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    netProfitFactor: netLoss > 0 ? netProfit / netLoss : null,
    avgWinPct: wins.length ? mean(wins.map(t => t.returnPct)) : 0,
    avgLossPct: losses.length ? mean(losses.map(t => t.returnPct)) : 0,
    avgWinIdr: wins.length ? mean(wins.map(t => t.netPnl)) : 0,
    avgLossIdr: losses.length ? mean(losses.map(t => t.netPnl)) : 0,
    avgHoldHours: trades.length ? mean(trades.map(t => (t.exitTime - t.entryTime) / 3600)) : 0,
    fees: totalFees,
    costs: totalCosts,
    grossProfit,
    grossLoss,
    /** Porsi biaya = (fee + spread + slippage) / laba kotor (trade yang untung). */
    costShare: grossProfit > 0 ? totalCosts / grossProfit : null,
  };
}

module.exports = {
  DAY,
  maxDrawdown,
  yearFraction,
  totalReturn,
  cagr,
  mean,
  summarize,
};
