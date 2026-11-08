'use strict';
/**
 * Penyimpanan state & log.
 *
 * - Upstash Redis (REST) untuk di Vercel: state persisten, log append-only.
 * - Mode file untuk uji lokal (STORE=file): logs/state.json + logs/*.jsonl
 *
 * Tidak ada dependency npm: Upstash dipanggil lewat REST API memakai fetch.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { sleep } = require('./time');

const PREFIX = 'indodax:';
const LIST_CAP = {
  calls: 5000,
  orders: 5000,
  equity: 5000,
  errors: 3000,
  snapshots: 20000,
  kill: 500,
};

function listKey(name) {
  return `${PREFIX}${name}`;
}

class UpstashStore {
  constructor(url, token) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
  }

  async request(pathname, body, attempt = 0) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const res = await fetch(this.url + pathname, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Upstash HTTP ${res.status}: ${txt.slice(0, 160)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt < 2) {
        await sleep(300 * (attempt + 1));
        return this.request(pathname, body, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async cmd(args) {
    const j = await this.request('', args);
    if (j && j.error) throw new Error('Upstash: ' + j.error);
    return j ? j.result : null;
  }

  async pipeline(cmds) {
    if (!cmds.length) return [];
    const j = await this.request('/pipeline', cmds);
    return j.map(x => (x && x.error ? { error: x.error } : x ? x.result : null));
  }

  async getState() {
    const raw = await this.cmd(['GET', `${PREFIX}state`]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  async setState(state) {
    await this.cmd(['SET', `${PREFIX}state`, JSON.stringify(state)]);
  }

  async append(name, obj) {
    const cap = LIST_CAP[name] || 5000;
    await this.pipeline([
      ['LPUSH', listKey(name), JSON.stringify(obj)],
      ['LTRIM', listKey(name), 0, cap - 1],
    ]);
  }

  async appendMany(name, objs) {
    if (!objs.length) return;
    const cap = LIST_CAP[name] || 5000;
    const cmds = [['LPUSH', listKey(name), ...objs.map(o => JSON.stringify(o))], ['LTRIM', listKey(name), 0, cap - 1]];
    await this.pipeline(cmds);
  }

  async list(name, limit = 1000) {
    const rows = await this.cmd(['LRANGE', listKey(name), 0, Math.max(0, limit - 1)]);
    if (!Array.isArray(rows)) return [];
    return rows.map(r => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean).reverse();
  }

  async acquireLock(key, ttlSec) {
    const r = await this.cmd(['SET', `${PREFIX}lock:${key}`, '1', 'NX', 'EX', String(ttlSec)]);
    return r === 'OK';
  }

  async setKillSwitch(value, reason) {
    await this.cmd(['SET', `${PREFIX}killswitch`, String(value)]);
    await this.append('kill', { at: new Date().toISOString(), active: !!value, reason: reason || null, source: 'redis' });
  }

  async getKillSwitch() {
    const v = await this.cmd(['GET', `${PREFIX}killswitch`]);
    return v === '1' || v === 'true';
  }
}

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.stateFile = path.join(dir, 'state.json');
    this.lockFile = path.join(dir, 'locks.json');
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) { return path.join(this.dir, `${name}.jsonl`); }

  async getState() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch (e) { return null; }
  }

  async setState(state) {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 1));
  }

  async append(name, obj) {
    fs.appendFileSync(this.file(name), JSON.stringify(obj) + '\n');
  }

  async appendMany(name, objs) {
    if (!objs.length) return;
    fs.appendFileSync(this.file(name), objs.map(o => JSON.stringify(o)).join('\n') + '\n');
  }

  async list(name, limit = 1000) {
    try {
      const lines = fs.readFileSync(this.file(name), 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }

  async acquireLock(key, ttlSec) {
    let locks = {};
    try { locks = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); } catch (e) { locks = {}; }
    const now = Date.now();
    for (const k of Object.keys(locks)) if (locks[k] < now) delete locks[k];
    if (locks[key] && locks[key] > now) return false;
    locks[key] = now + ttlSec * 1000;
    fs.writeFileSync(this.lockFile, JSON.stringify(locks));
    return true;
  }

  async setKillSwitch(value, reason) {
    fs.writeFileSync(path.join(this.dir, 'killswitch.txt'), value ? '1' : '0');
    await this.append('kill', { at: new Date().toISOString(), active: !!value, reason: reason || null, source: 'file' });
  }

  async getKillSwitch() {
    try { return fs.readFileSync(path.join(this.dir, 'killswitch.txt'), 'utf8').trim() === '1'; } catch (e) { return false; }
  }
}

function createStore(env = process.env) {
  if (env.STORE === 'file') {
    const dir = env.LOG_DIR || path.resolve(__dirname, '..', 'logs');
    return new FileStore(dir);
  }
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN belum diset. Untuk lokal pakai STORE=file.');
  }
  return new UpstashStore(url, token);
}

function initialState(nowSec) {
  return {
    version: 1,
    createdAt: new Date(nowSec * 1000).toISOString(),
    updatedAt: null,
    capital: cfg.capital,
    cash: cfg.capital,
    positions: {},
    lastProcessed: {},
    day: { key: null, startEquity: cfg.capital, blockedLogged: false },
    counters: { calls: 0, orders: 0, entries: 0, exits: 0, errors: 0, killSwitchUses: 0, blockedDays: 0 },
    killSwitch: { active: false, reason: null, at: null, source: null },
    lastTick: null,
    peakEquity: cfg.capital,
  };
}

module.exports = { UpstashStore, FileStore, createStore, initialState, LIST_CAP, PREFIX };
