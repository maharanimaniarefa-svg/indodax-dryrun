'use strict';
/**
 * Inti bot dry run. Dipanggil oleh api/tick.js (Vercel) dan
 * scripts/tick_local.js (uji lokal).
 *
 * Alur satu tick:
 *   1. baca state
 *   2. cek kill switch (env / Redis)
 *   3. ambil server_time, metadata pair, candle 4h, order book
 *   4. validasi data (candle tertutup, gap, harga/volume, spread)
 *   5. hitung sinyal dengan lib/strategy.js (fungsi yang sama dengan backtest)
 *   6. idempotency per candle (state + lock Redis)
 *   7. eksekusi exit di bid, lalu entry di ask (depth walk)
 *   8. catat order, equity, sinyal, error, snapshot
 *   9. simpan state
 */
const cfg = require('./config');
const api = require('./indodax');
const { computeSignals, validateCandles, floorStep } = require('./strategy');
const { walkBuy, walkSell, bestBid, bestAsk, relSpread } = require('./fill');
const { initialState } = require('./store');
const { wibDayKey, wibNextDayStart } = require('./time');

const REQ = { timeoutMs: 6000, retries: 1 };
const DEADLINE_MS = 45000;

let orderSeq = 0;
function newOrderId(symbol, side, t) {
  orderSeq = (orderSeq + 1) % 100000;
  return `${symbol}-${side}-${t}-${orderSeq}`;
}

function avgDailyTurnover(candles, bars = 180) {
  const slice = candles.slice(-bars);
  const sum = slice.reduce((a, c) => a + c.c * c.v, 0);
  const days = Math.max(1, (slice.length * cfg.tfSec) / 86400);
  return sum / days;
}

function markToBid(state, views, serverTime, slice) {
  const bySym = new Map(views.map(v => [v.pair.symbol, v]));
  let invested = 0;
  const detail = {};
  for (const [sym, pos] of Object.entries(state.positions)) {
    const v = bySym.get(sym);
    const hasBook = v && v.book && v.book.buy && v.book.buy.length > 0;
    const bid = hasBook ? bestBid(v.book) : (pos.lastBid || pos.entryFill);
    if (hasBook && bid > 0) {
      pos.lastBid = bid;
      pos.lastBidAt = serverTime;
    }
    const value = pos.qty * bid;
    invested += value;
    detail[sym] = { qty: pos.qty, bid, value };
  }
  return { equity: state.cash + invested, invested, detail };
}

async function runTick({ store, env = process.env, deps = {}, enforceWindow = true } = {}) {
  const t0 = Date.now();
  const apiClient = deps.api || api;
  const nowFn = deps.now || (() => Math.floor(Date.now() / 1000));

  const logs = { calls: [], orders: [], equity: [], errors: [], snapshots: [], kill: [] };
  const notes = [];
  const signalsOut = [];
  const processedSymbols = [];
  const entriesPlanned = [];

  const pushError = (scope, message, extra = {}) => {
    logs.errors.push({ at: new Date().toISOString(), scope, message: String(message), ...extra });
  };

  let state = (await store.getState()) || initialState(nowFn());
  if (!state.positions) state.positions = {};
  if (!state.lastProcessed) state.lastProcessed = {};
  if (!state.counters) state.counters = initialState(nowFn()).counters;
  if (!state.day) state.day = { key: null, startEquity: state.cash ?? cfg.capital, blockedLogged: false };

  // ---------- server time ----------
  let serverTime = nowFn();
  try {
    const st = await apiClient.getServerTime(REQ);
    if (Number.isFinite(st) && st > 0) serverTime = st;
    else throw new Error('server_time tidak valid');
  } catch (err) {
    pushError('server_time', err.message);
    notes.push('server_time gagal, memakai jam lokal');
  }
  const at = new Date(serverTime * 1000).toISOString();

  // ---------- batas jendela forward (dibekukan) ----------
  if (enforceWindow && serverTime < cfg.forwardStart) {
    return {
      ok: true,
      waiting: true,
      at,
      serverTime,
      message: `belum masuk jendela forward (mulai ${cfg.F.forward_start_candle_utc})`,
      forward: { start: cfg.F.forward_start_candle_utc, end: cfg.F.forward_end_utc },
      orders: [],
      processed: [],
      notes: ['tick diabaikan karena sebelum jendela forward'],
      errors: [],
    };
  }
  if (enforceWindow && serverTime > cfg.forwardEnd) {
    return {
      ok: true,
      frozen: true,
      at,
      serverTime,
      message: `jendela forward sudah selesai (${cfg.F.forward_end_utc}); bot berhenti`,
      forward: { start: cfg.F.forward_start_candle_utc, end: cfg.F.forward_end_utc },
      orders: [],
      processed: [],
      notes: ['tick diabaikan karena jendela forward selesai'],
      errors: [],
    };
  }

  // ---------- kunci global: satu tick pada satu waktu ----------
  const tickLock = await store.acquireLock('tick:global', 75);
  if (!tickLock) {
    return {
      ok: true,
      skipped: true,
      at,
      serverTime,
      message: 'tick lain sedang berjalan (lock global)',
      orders: [],
      processed: [],
      notes: ['tick dilewati: lock global'],
      errors: [],
    };
  }

  // ---------- kill switch ----------
  const envKill = ['1', 'true', 'yes', 'on'].includes(String(env.KILL_SWITCH || '').toLowerCase());
  let redisKill = false;
  try {
    redisKill = await store.getKillSwitch();
  } catch (err) {
    pushError('killswitch_read', err.message);
  }
  const killActive = envKill || redisKill;

  if (killActive && !state.killSwitch.active) {
    state.killSwitch = {
      active: true,
      reason: envKill ? 'environment KILL_SWITCH=1' : 'flag Redis killswitch=1',
      at,
      source: envKill ? 'env' : 'redis',
    };
    state.counters.killSwitchUses = (state.counters.killSwitchUses || 0) + 1;
    logs.kill.push({ at, active: true, reason: state.killSwitch.reason, source: state.killSwitch.source });
    notes.push('KILL SWITCH AKTIF: posisi baru diblokir');
  } else if (!killActive && state.killSwitch.active) {
    state.killSwitch = { active: false, reason: 'dimatikan', at, source: envKill ? 'env' : 'redis' };
    logs.kill.push({ at, active: false, reason: 'kill switch dimatikan', source: 'sync' });
    notes.push('Kill switch dimatikan');
  }

  // ---------- metadata pair live (maintenance/suspended) ----------
  let livePairs = {};
  try {
    const list = await apiClient.getPairs(REQ);
    for (const p of list) livePairs[p.id] = p;
  } catch (err) {
    pushError('pairs', err.message);
    notes.push('metadata pair live gagal, memakai config beku');
  }

  const universe = cfg.UNIVERSE;
  if (!universe.length) throw new Error('config/universe.json kosong');

  // ---------- ambil candle + order book per pair ----------
  const views = [];
  for (const pair of universe) {
    if (Date.now() - t0 > DEADLINE_MS) {
      notes.push('batas waktu tick tercapai; sebagian pair tidak diproses');
      pushError('deadline', 'tick melewati batas 45s');
      break;
    }

    const symbol = pair.symbol;
    const live = livePairs[pair.id];
    const maintenance = live ? (Number(live.is_maintenance) === 1 || Number(live.is_market_suspended) === 1) : false;

    const view = {
      pair, symbol, maintenance, ok: false, reasons: [],
      rows: [], sig: null, book: null, bookValid: false, spreadPct: NaN,
      turnover: 0,
    };

    // candle: cukup untuk MA150 + beberapa bar validasi
    const from = serverTime - (cfg.X + 90) * cfg.tfSec;
    try {
      const raw = await apiClient.getHistory(symbol, cfg.tf, from, serverTime, REQ);
      const v = validateCandles(raw, {
        tfSec: cfg.tfSec,
        serverTime,
        minBars: cfg.X + 5,
        maxCandleAgeBars: cfg.maxCandleAgeBars,
      });
      view.rows = v.rows;
      view.last = v.last;
      if (!v.ok) {
        view.reasons = v.reasons;
        for (const r of v.reasons) pushError('validasi_candle', `${symbol}: ${r}`, { symbol });
      } else {
        const sigs = computeSignals(v.rows, cfg.N, cfg.X);
        view.sig = sigs[sigs.length - 1];
        view.ok = true;
      }
      view.turnover = avgDailyTurnover(v.rows);
    } catch (err) {
      view.reasons.push('fetch candle gagal: ' + err.message);
      pushError('history', `${symbol}: ${err.message}`, { symbol });
    }

    // order book
    try {
      const book = await apiClient.getDepth(pair.id, REQ);
      view.book = book;
      view.spreadPct = relSpread(book);
      view.bookValid = book.buy.length > 0 && book.sell.length > 0 && Number.isFinite(view.spreadPct);
      if (!view.bookValid) {
        view.reasons.push('order book kosong');
        pushError('orderbook', `${symbol}: order book kosong`, { symbol });
      }
      logs.snapshots.push({
        at,
        serverTime,
        symbol,
        bid: bestBid(book),
        ask: bestAsk(book),
        spreadPct: view.spreadPct,
        bidNotionalTop10: book.buy.slice(0, 10).reduce((a, [p, q]) => a + p * q, 0),
        askNotionalTop10: book.sell.slice(0, 10).reduce((a, [p, q]) => a + p * q, 0),
        buy: book.buy.slice(0, 10),
        sell: book.sell.slice(0, 10),
      });
    } catch (err) {
      view.reasons.push('fetch order book gagal: ' + err.message);
      pushError('depth', `${symbol}: ${err.message}`, { symbol });
    }

    if (view.bookValid && view.spreadPct > cfg.maxSpreadPct) {
      view.reasons.push(`spread ${(view.spreadPct * 100).toFixed(3)}% > ${(cfg.maxSpreadPct * 100).toFixed(2)}%`);
      pushError('spread', `${symbol}: spread ${(view.spreadPct * 100).toFixed(3)}% melebihi batas`, { symbol });
    }

    views.push(view);
  }

  // ---------- equity, hari WIB, daily loss limit ----------
  const dayKey = wibDayKey(serverTime);
  let eq = markToBid(state, views, serverTime);
  let dayRolled = false;
  if (state.day.key !== dayKey) {
    state.day = { key: dayKey, startEquity: eq.equity, blockedLogged: false };
    dayRolled = true;
    notes.push(`hari WIB baru ${dayKey}: equity awal Rp ${Math.round(eq.equity).toLocaleString('id-ID')}`);
  }
  const dayPnl = state.day.startEquity > 0 ? eq.equity / state.day.startEquity - 1 : 0;
  const dayBlocked = dayPnl <= -cfg.dailyLossLimitPct;
  if (dayBlocked && !state.day.blockedLogged) {
    state.day.blockedLogged = true;
    state.counters.blockedDays = (state.counters.blockedDays || 0) + 1;
    notes.push(`DAILY LOSS LIMIT tercapai (${(dayPnl * 100).toFixed(2)}%): tidak membuka posisi baru sampai ${wibDayKey(wibNextDayStart(serverTime))} 00.00 WIB`);
  }

  // ---------- exit (diproses sebelum entry) ----------
  for (const view of views) {
    const { symbol, pair } = view;
    if (!view.ok || !view.sig) continue;
    const candleTime = view.sig.t;
    if (state.lastProcessed[symbol] === candleTime) continue;

    const lockOk = await store.acquireLock(`${symbol}:${candleTime}`, 300);
    if (!lockOk) {
      notes.push(`${symbol}: candle ${candleTime} sedang diproses panggilan lain`);
      continue;
    }

    const pos = state.positions[symbol];
    if (!pos) {
      processedSymbols.push(symbol);
      continue;
    }
    if (!view.sig.exit) {
      processedSymbols.push(symbol);
      continue;
    }
    if (!view.bookValid) {
      signalsOut.push({ symbol, candleTime, entry: view.sig.entry, exit: true, action: 'skip', reason: 'order book tidak valid', close: view.sig.close });
      pushError('exit', `${symbol}: exit tertunda, order book tidak valid`, { symbol });
      continue;
    }

    const ws = walkSell(view.book.buy, pos.qty);
    if (!(ws.qty > 0) || !Number.isFinite(ws.avgPrice)) {
      signalsOut.push({ symbol, candleTime, entry: view.sig.entry, exit: true, action: 'skip', reason: 'tidak ada bid', close: view.sig.close });
      pushError('exit', `${symbol}: tidak ada likuiditas bid`, { symbol });
      continue;
    }

    const qty = Math.min(pos.qty, floorStep(ws.qty, pair.qtyStep));
    if (!(qty > 0)) {
      pushError('exit', `${symbol}: kuantitas exit 0`, { symbol });
      continue;
    }
    const proceeds = qty * ws.avgPrice;
    const fee = proceeds * cfg.feeSell;
    const feeShare = pos.entryFee * (qty / pos.qty);
    const entryCostShare = pos.entryFill * qty + feeShare;
    const realized = proceeds - fee - entryCostShare;

    state.cash += proceeds - fee;
    if (qty >= pos.qty - Math.max(pair.qtyStep, pos.qty * 1e-9)) {
      delete state.positions[symbol];
    } else {
      pos.qty -= qty;
      pos.entryFee -= feeShare;
    }

    logs.orders.push({
      id: newOrderId(symbol, 'SELL', serverTime),
      at,
      serverTime,
      candleTime,
      mode: 'dry-run',
      symbol,
      side: 'SELL',
      qty,
      signalPrice: view.sig.close,
      bestBid: bestBid(view.book),
      bestAsk: bestAsk(view.book),
      fillPrice: ws.avgPrice,
      notional: proceeds,
      fee,
      levels: ws.levels,
      complete: ws.complete,
      spreadPct: view.spreadPct,
      slippageVsSignalPct: ws.avgPrice / view.sig.close - 1,
      realizedPnl: realized,
      reason: `Close < MA${cfg.X}`,
    });
    signalsOut.push({ symbol, candleTime, entry: view.sig.entry, exit: true, action: 'exit', reason: `Close < MA${cfg.X}`, close: view.sig.close, qty, fill: ws.avgPrice });
    state.counters.exits = (state.counters.exits || 0) + 1;
    processedSymbols.push(symbol);
  }

  // ---------- kumpulkan kandidat entry ----------
  for (const view of views) {
    const { symbol } = view;
    if (!view.ok || !view.sig) continue;
    const candleTime = view.sig.t;
    if (state.lastProcessed[symbol] === candleTime) continue;
    if (state.positions[symbol]) continue;
    if (!view.sig.entry) {
      processedSymbols.push(symbol);
      continue;
    }

    const reasons = [];
    if (view.maintenance) reasons.push('pair maintenance/suspended');
    if (!view.bookValid) reasons.push('order book tidak valid');
    if (view.bookValid && view.spreadPct > cfg.maxSpreadPct) reasons.push('spread > 2%');
    if (!(view.turnover > 0)) reasons.push('likuiditas 30 hari nol');

    if (reasons.length) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: reasons.join('; '), close: view.sig.close });
      for (const r of reasons) pushError('entry_validation', `${symbol}: ${r}`, { symbol });
      processedSymbols.push(symbol);
      continue;
    }
    entriesPlanned.push(view);
  }

  entriesPlanned.sort((a, b) => b.turnover - a.turnover);

  // ---------- eksekusi entry ----------
  for (const view of entriesPlanned) {
    const { symbol, pair } = view;
    if (Object.keys(state.positions).length >= cfg.maxPositions) break;

    const candleTime = view.sig.t;
    if (state.lastProcessed[symbol] === candleTime) continue;

    if (killActive) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: 'kill switch aktif', close: view.sig.close });
      state.counters.killSwitchUses = (state.counters.killSwitchUses || 0) + 1;
      state.killSwitch.blocks = (state.killSwitch.blocks || 0) + 1;
      processedSymbols.push(symbol);
      continue;
    }
    if (dayBlocked) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: 'daily loss limit', close: view.sig.close });
      processedSymbols.push(symbol);
      continue;
    }

    eq = markToBid(state, views, serverTime);
    const target = Math.min(cfg.allocPct * eq.equity, cfg.liquidityCapPct * view.turnover, state.cash);
    const wb = walkBuy(view.book.sell, target);
    if (!(wb.qty > 0) || !Number.isFinite(wb.avgPrice)) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: 'tidak ada ask', close: view.sig.close });
      processedSymbols.push(symbol);
      continue;
    }

    let qty = floorStep(wb.qty, pair.qtyStep);
    let notional = qty * wb.avgPrice;
    let fee = notional * cfg.feeBuy;
    if (notional < cfg.minOrderIdr) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: `di bawah minimum order Rp${cfg.minOrderIdr}`, close: view.sig.close });
      processedSymbols.push(symbol);
      continue;
    }
    if (notional + fee > state.cash) {
      qty = floorStep((state.cash / (1 + cfg.feeBuy)) / wb.avgPrice, pair.qtyStep);
      notional = qty * wb.avgPrice;
      fee = notional * cfg.feeBuy;
      if (!(qty > 0) || notional < cfg.minOrderIdr) {
        signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: 'kas tidak cukup', close: view.sig.close });
        processedSymbols.push(symbol);
        continue;
      }
    }

    const slip = wb.avgPrice / view.sig.close - 1;
    if (slip > cfg.maxFillSlippagePct) {
      signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'skip', reason: `slippage fill ${(slip * 100).toFixed(2)}% > ${(cfg.maxFillSlippagePct * 100).toFixed(0)}%`, close: view.sig.close });
      pushError('entry_slippage', `${symbol}: slippage ${(slip * 100).toFixed(2)}%`, { symbol });
      processedSymbols.push(symbol);
      continue;
    }

    state.cash -= notional + fee;
    state.positions[symbol] = {
      symbol,
      qty,
      entryTime: serverTime,
      entrySignalTime: candleTime,
      entrySignalPrice: view.sig.close,
      entryFill: wb.avgPrice,
      entryFee: fee,
      entryNotional: notional,
      lastBid: bestBid(view.book),
      lastBidAt: serverTime,
    };
    state.counters.entries = (state.counters.entries || 0) + 1;

    logs.orders.push({
      id: newOrderId(symbol, 'BUY', serverTime),
      at,
      serverTime,
      candleTime,
      mode: 'dry-run',
      symbol,
      side: 'BUY',
      qty,
      signalPrice: view.sig.close,
      bestBid: bestBid(view.book),
      bestAsk: bestAsk(view.book),
      fillPrice: wb.avgPrice,
      notional,
      fee,
      levels: wb.levels,
      complete: wb.complete,
      spreadPct: view.spreadPct,
      slippageVsSignalPct: slip,
      reason: `cross-up MA${cfg.N} + Close > MA${cfg.X}`,
    });
    signalsOut.push({ symbol, candleTime, entry: true, exit: false, action: 'entry', reason: 'cross-up', close: view.sig.close, qty, fill: wb.avgPrice });
    processedSymbols.push(symbol);
  }

  // tandai candle sudah diproses (idempotency)
  for (const sym of new Set(processedSymbols)) {
    const view = views.find(v => v.symbol === sym);
    if (view && view.ok && view.sig) state.lastProcessed[sym] = view.sig.t;
  }
  // pair tanpa sinyal juga ditandai sudah diproses
  for (const view of views) {
    if (view.ok && view.sig && !state.positions[view.symbol] && !processedSymbols.includes(view.symbol)) {
      // hanya tandai bila candle memang sudah lewat dan tidak ada aksi
      state.lastProcessed[view.symbol] = view.sig.t;
    }
  }

  // ---------- equity akhir tick ----------
  eq = markToBid(state, views, serverTime);
  state.peakEquity = Math.max(state.peakEquity || cfg.capital, eq.equity);
  state.counters.calls = (state.counters.calls || 0) + 1;
  state.counters.orders = (state.counters.orders || 0) + logs.orders.length;
  state.counters.errors = (state.counters.errors || 0) + logs.errors.length;
  state.updatedAt = at;
  state.lastTick = {
    at,
    serverTime,
    durationMs: Date.now() - t0,
    processed: [...new Set(processedSymbols)],
    orders: logs.orders.length,
    equity: eq.equity,
  };

  const call = {
    at,
    serverTime,
    mode: 'dry-run',
    durationMs: Date.now() - t0,
    killSwitch: { ...state.killSwitch },
    day: {
      key: dayKey,
      startEquity: state.day.startEquity,
      pnlPct: dayPnl,
      blocked: dayBlocked,
      rolled: dayRolled,
    },
    universe: universe.map(p => p.symbol),
    processed: [...new Set(processedSymbols)],
    signals: signalsOut,
    orders: logs.orders.length,
    equity: eq.equity,
    cash: state.cash,
    positions: Object.keys(state.positions),
    notes,
    errors: logs.errors.map(e => ({ scope: e.scope, message: e.message })),
    nextCandleCloseUtc: (Math.floor(serverTime / cfg.tfSec) + 1) * cfg.tfSec,
  };

  // ---------- simpan ----------
  await store.setState(state);
  await store.appendMany('orders', logs.orders);
  await store.appendMany('snapshots', logs.snapshots);
  await store.appendMany('errors', logs.errors);
  await store.append('equity', {
    at,
    serverTime,
    dayKey,
    equity: eq.equity,
    cash: state.cash,
    invested: eq.invested,
    npos: Object.keys(state.positions).length,
    positions: eq.detail,
    source: 'tick',
    dayStart: dayRolled,
  });
  await store.append('calls', call);
  if (logs.kill.length) await store.appendMany('kill', logs.kill);

  return {
    ok: true,
    at,
    serverTime,
    durationMs: call.durationMs,
    equity: eq.equity,
    cash: state.cash,
    positions: eq.detail,
    processed: call.processed,
    orders: logs.orders,
    signals: signalsOut,
    killSwitch: { active: killActive, reason: state.killSwitch.reason },
    day: call.day,
    notes,
    errors: call.errors,
    counters: state.counters,
  };
}

module.exports = { runTick, avgDailyTurnover };
