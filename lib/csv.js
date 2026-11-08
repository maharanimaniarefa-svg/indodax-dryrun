'use strict';
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function candlesToCsv(candles) {
  const lines = ['time_utc,open,high,low,close,volume'];
  for (const c of candles) {
    lines.push([
      new Date(c.t * 1000).toISOString().replace('.000Z', 'Z'),
      c.o, c.h, c.l, c.c, c.v,
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function csvToCandles(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map(s => s.trim());
  const idx = name => head.indexOf(name);
  const iT = idx('time_utc') >= 0 ? idx('time_utc') : idx('time');
  const iO = idx('open');
  const iH = idx('high');
  const iL = idx('low');
  const iC = idx('close');
  const iV = idx('volume');
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const t = Date.parse(c[iT]) / 1000;
    const o = Number(c[iO]);
    const h = Number(c[iH]);
    const l = Number(c[iL]);
    const cl = Number(c[iC]);
    const v = Number(c[iV]);
    if ([t, o, h, l, cl, v].every(Number.isFinite)) out.push({ t, o, h, l, c: cl, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function writeCandles(file, candles) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, candlesToCsv(candles));
}

function readCandles(file) {
  if (!fs.existsSync(file)) return null;
  return csvToCandles(fs.readFileSync(file, 'utf8'));
}

/** Parser CSV kecil yang mendukung tanda kutip ganda dan newline di dalam field. */
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
    .filter(Boolean);
}

function appendJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return;
  fs.appendFileSync(file, list.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    return fallback;
  }
}

/** Gabungkan candle lama + baru berdasarkan waktu, buang duplikat. */
function mergeCandles(a = [], b = []) {
  const map = new Map();
  for (const c of a) map.set(c.t, c);
  for (const c of b) map.set(c.t, c);
  return [...map.values()].sort((x, y) => x.t - y.t);
}

module.exports = {
  ensureDir,
  candlesToCsv,
  csvToCandles,
  writeCandles,
  readCandles,
  parseCsv,
  rowsToObjects,
  readJsonl,
  appendJsonl,
  writeJson,
  readJson,
  mergeCandles,
};
