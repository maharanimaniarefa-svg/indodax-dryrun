'use strict';
/** Util waktu. Batas "hari" untuk daily loss limit memakai WIB (UTC+7). */

const WIB_OFFSET = 7 * 3600;
const BAR_MS = 1000;

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Kunci hari WIB, contoh 2026-11-08. */
function wibDayKey(tsSec) {
  const d = new Date((tsSec + WIB_OFFSET) * BAR_MS);
  return d.toISOString().slice(0, 10);
}

/** Awal hari WIB (00.00 WIB) dalam unix detik. */
function wibDayStart(tsSec) {
  const day = wibDayKey(tsSec);
  return Date.parse(day + 'T00:00:00+07:00') / 1000;
}

/** Awal hari WIB berikutnya. */
function wibNextDayStart(tsSec) {
  return wibDayStart(tsSec) + 86400;
}

function isoUtc(tsSec) {
  return new Date(tsSec * BAR_MS).toISOString().replace('.000Z', 'Z');
}

function fmtWib(tsSec) {
  const d = new Date((tsSec + WIB_OFFSET) * BAR_MS);
  return d.toISOString().replace('T', ' ').replace('.000Z', ' WIB');
}

/** Waktu tutup candle (open time + durasi tf). */
const closeTime = (openTime, tfSec) => openTime + tfSec;

/** Daftar waktu tutup candle yang seharusnya diproses pada [startClose, endClose]. */
function expectedCandleCloses(startClose, endClose, tfSec) {
  const out = [];
  let t = Math.ceil(startClose / tfSec) * tfSec;
  for (; t <= endClose; t += tfSec) out.push(t);
  return out;
}

module.exports = {
  WIB_OFFSET,
  nowSec,
  sleep,
  wibDayKey,
  wibDayStart,
  wibNextDayStart,
  isoUtc,
  fmtWib,
  closeTime,
  expectedCandleCloses,
};
