'use strict';
/**
 * Eksekusi simulasi terhadap order book sungguhan.
 * Aturan UAS: beli di ask, jual di bid, habiskan level berikutnya bila order
 * lebih besar dari level terbaik, dan pakai harga rata-rata. DILARANG
 * memakai harga mid atau close sebagai harga fill.
 */

function bestBid(book) {
  return book && book.buy && book.buy.length ? book.buy[0][0] : NaN;
}

function bestAsk(book) {
  return book && book.sell && book.sell.length ? book.sell[0][0] : NaN;
}

/** Spread relatif terhadap mid. */
function relSpread(book) {
  const b = bestBid(book);
  const a = bestAsk(book);
  if (!(b > 0) || !(a > 0)) return NaN;
  return (a - b) / ((a + b) / 2);
}

function bookNotional(levels, side) {
  let sum = 0;
  for (const [p, q] of levels) sum += p * q;
  return sum;
}

/**
 * Beli dengan notional IDR tertentu, menelusuri ask dari harga terendah.
 * Return qty base, biaya IDR, harga rata-rata, dan apakah book cukup.
 */
function walkBuy(asks, notionalIdr) {
  let remaining = notionalIdr;
  let qty = 0;
  let cost = 0;
  let levels = 0;
  for (const [p, q] of asks) {
    if (remaining <= 1e-6) break;
    const avail = p * q;
    if (avail >= remaining) {
      qty += remaining / p;
      cost += remaining;
      remaining = 0;
      levels++;
      break;
    }
    qty += q;
    cost += avail;
    remaining -= avail;
    levels++;
  }
  return {
    qty,
    cost,
    avgPrice: qty > 0 ? cost / qty : NaN,
    filledNotional: cost,
    complete: remaining <= 1e-6,
    levels,
  };
}

/** Jual qty base tertentu, menelusuri bid dari harga tertinggi. */
function walkSell(bids, qtyBase) {
  let remaining = qtyBase;
  let sold = 0;
  let proceeds = 0;
  let levels = 0;
  for (const [p, q] of bids) {
    if (remaining <= 1e-12) break;
    const take = Math.min(q, remaining);
    proceeds += take * p;
    sold += take;
    remaining -= take;
    levels++;
  }
  return {
    qty: sold,
    proceeds,
    avgPrice: sold > 0 ? proceeds / sold : NaN,
    complete: remaining <= Math.max(1e-12, qtyBase * 1e-9),
    levels,
    unfilled: remaining,
  };
}

/** Ringkasan order book untuk log (top N level). */
function snapshotBook(book, depth = 10) {
  return {
    bid: bestBid(book),
    ask: bestAsk(book),
    spreadPct: relSpread(book),
    bidNotionalTop: bookNotional((book.buy || []).slice(0, depth)),
    askNotionalTop: bookNotional((book.sell || []).slice(0, depth)),
    buy: (book.buy || []).slice(0, depth),
    sell: (book.sell || []).slice(0, depth),
  };
}

module.exports = {
  bestBid,
  bestAsk,
  relSpread,
  bookNotional,
  walkBuy,
  walkSell,
  snapshotBook,
};
