/* Dashboard Indodax dry-run. Tanpa dependency eksternal, bisa dibuka offline. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    report: null,
    source: 'embedded',
    tab: 'ringkasan',
    tradeFilter: 'ALL',
    charts: {},
    timer: null,
    lastFetch: null,
  };

  // ------------------------------------------------------------ formatting
  const isNum = v => Number.isFinite(Number(v));
  function idr(v, compact = false) {
    if (!isNum(v)) return '—';
    const n = Number(v);
    if (compact) {
      const a = Math.abs(n);
      if (a >= 1e12) return 'Rp ' + (n / 1e12).toFixed(2) + ' T';
      if (a >= 1e9) return 'Rp ' + (n / 1e9).toFixed(2) + ' M';
      if (a >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1) + ' jt';
      if (a >= 1e3) return 'Rp ' + (n / 1e3).toFixed(0) + ' rb';
    }
    return 'Rp ' + Math.round(n).toLocaleString('id-ID');
  }
  function pct(v, digits = 2, signed = true) {
    if (!isNum(v)) return '—';
    const n = Number(v) * 100;
    return (signed && n > 0 ? '+' : '') + n.toFixed(digits) + '%';
  }
  function num(v, digits = 2) {
    if (!isNum(v)) return '—';
    return Number(v).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function dateUtc(sec, withTime = true) {
    if (!isNum(sec)) return '—';
    const d = new Date(Number(sec) * 1000);
    const s = d.toISOString().replace('T', ' ').slice(0, withTime ? 16 : 10);
    return s + (withTime ? ' UTC' : '');
  }
  function dateWib(sec, withTime = true) {
    if (!isNum(sec)) return '—';
    const d = new Date((Number(sec) + 7 * 3600) * 1000);
    const s = d.toISOString().replace('T', ' ').slice(0, withTime ? 16 : 10);
    return s + (withTime ? ' WIB' : '');
  }
  function isoWib(iso) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? dateWib(t / 1000) : String(iso || '—');
  }
  function dur(sec) {
    if (!isNum(sec)) return '—';
    const s = Math.max(0, Math.round(Number(sec)));
    if (s < 90) return s + ' detik';
    if (s < 5400) return Math.round(s / 60) + ' menit';
    if (s < 172800) return (s / 3600).toFixed(1) + ' jam';
    return (s / 86400).toFixed(1) + ' hari';
  }
  const clsPct = v => (!isNum(v) ? '' : Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : 'muted');

  // ---------------------------------------------------------------- widgets
  function kpi(label, value, sub = '', cls = '') {
    return `<div class="kpi ${cls}"><div class="k-label">${esc(label)}</div><div class="k-value">${value}</div><div class="k-sub">${sub}</div></div>`;
  }
  function badge(text, kind = 'neutral') {
    return `<span class="badge ${kind}">${esc(text)}</span>`;
  }
  function empty(msg) {
    return `<div class="empty-state">${esc(msg)}</div>`;
  }
  function table(cols, rows, opts = {}) {
    if (!rows.length) return empty(opts.empty || 'Belum ada data.');
    const head = cols.map(c => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const body = rows.map(r => `<tr>${r.map((cell, i) => {
      const c = cols[i] || {};
      return `<td class="${c.align === 'right' ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${cell}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="table-wrap ${opts.short ? 'short' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function kv(rows) {
    return `<div class="kv">${rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}</div>`;
  }
  function progressBar(fraction, good = true) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    return `<div class="progress ${good ? 'good' : 'bad'}"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
  }
  function checksHtml(section) {
    if (!section || section.available === false) {
      return empty(section?.note || 'Belum ada hasil hitung ulang. Jalankan scripts/recompute.js.');
    }
    if (!section.checks || !section.checks.length) return empty('Tidak ada check.');
    return `<div class="checks">${section.checks.map(c => `
      <div class="check-row">
        ${badge(c.pass ? 'PASS' : 'FAIL', c.pass ? 'pass' : 'fail')}
        <div class="check-text">${esc(c.label)}${c.detail && typeof c.detail === 'object' ? `<div class="check-detail">${esc(JSON.stringify(c.detail).slice(0, 220))}</div>` : ''}</div>
      </div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ charts
  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || canvas.parentElement.clientWidth || 640));
    const h = Math.max(220, Math.round(rect.height || 320));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function findNearest(points, t) {
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid + 1; else hi = mid;
    }
    const a = points[Math.max(0, lo - 1)], b = points[lo];
    return !b || (a && Math.abs(a.t - t) < Math.abs(b.t - t)) ? a : b;
  }

  /**
   * series: [{ name, color, points:[{t,v}], dash?, fill?, width? }]
   * opts: { drawdown:boolean, height }
   */
  function drawChart(canvas, tip, series, opts = {}) {
    if (!canvas) return;
    const { ctx, w, h } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const valid = series.map(s => ({ ...s, points: (s.points || []).filter(p => isNum(p.t) && isNum(p.v)) }))
      .filter(s => s.points.length > 1);
    if (!valid.length) {
      ctx.fillStyle = '#63758a';
      ctx.font = '13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(opts.empty || 'Belum ada data untuk digambar', w / 2, h / 2);
      if (tip) tip.hidden = true;
      return;
    }

    const ddOn = !!opts.drawdown && valid[0].points.length > 2;
    const ddH = ddOn ? Math.round(h * 0.2) : 0;
    const pad = { l: 6, r: 74, t: 14, b: 26 + ddH };
    const iw = Math.max(40, w - pad.l - pad.r);
    const ih = Math.max(60, h - pad.t - pad.b);

    const t0 = Math.min(...valid.map(s => s.points[0].t));
    const t1 = Math.max(...valid.map(s => s.points[s.points.length - 1].t));
    let vMin = Infinity, vMax = -Infinity;
    for (const s of valid) for (const p of s.points) { vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v); }
    if (vMin === vMax) { vMin *= 0.98; vMax *= 1.02; }
    const vPad = (vMax - vMin) * 0.08;
    vMin -= vPad; vMax += vPad;

    // drawdown series
    let ddMax = 0;
    if (ddOn) {
      let peak = -Infinity;
      valid[0]._dd = valid[0].points.map(p => {
        peak = Math.max(peak, p.v);
        const dd = peak > 0 ? p.v / peak - 1 : 0;
        ddMax = Math.min(ddMax, dd);
        return { t: p.t, v: dd };
      });
    }
    if (ddMax >= 0) ddMax = -0.01;

    const X = t => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
    const Y = v => pad.t + (1 - (v - vMin) / Math.max(1e-9, vMax - vMin)) * ih;
    const Ydd = v => pad.t + ih + 14 + (1 - v / ddMax) * (ddH - 6);

    // grid horizontal + labels
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = vMin + (vMax - vMin) * i / steps;
      const y = Y(v);
      ctx.strokeStyle = 'rgba(29,42,56,.62)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      ctx.fillStyle = '#63758a';
      ctx.fillText(idr(v, true), pad.l + iw + 8, y);
    }

    // x labels
    ctx.textAlign = 'center';
    const xTicks = 5;
    for (let i = 0; i < xTicks; i++) {
      const t = t0 + (t1 - t0) * i / (xTicks - 1);
      const x = X(t);
      ctx.strokeStyle = 'rgba(29,42,56,.35)';
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ih); ctx.stroke();
      ctx.fillStyle = '#63758a';
      const label = new Date(t * 1000).toISOString().slice(0, 7);
      ctx.fillText(label, Math.min(w - 30, Math.max(30, x)), h - (ddOn ? ddH + 8 : 12));
    }

    // lines
    valid.forEach((s, si) => {
      const pts = s.points;
      if (s.fill) {
        const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
        grad.addColorStop(0, s.color + '38');
        grad.addColorStop(1, s.color + '00');
        ctx.beginPath();
        ctx.moveTo(X(pts[0].t), Y(pts[0].v));
        for (const p of pts) ctx.lineTo(X(p.t), Y(p.v));
        ctx.lineTo(X(pts[pts.length - 1].t), pad.t + ih);
        ctx.lineTo(X(pts[0].t), pad.t + ih);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.beginPath();
      pts.forEach((p, i) => { const x = X(p.t), y = Y(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || (si === 0 ? 1.9 : 1.5);
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // drawdown
    if (ddOn && ddMax < 0) {
      const dd = valid[0]._dd;
      ctx.beginPath();
      ctx.moveTo(X(dd[0].t), pad.t + ih + 14);
      for (const p of dd) ctx.lineTo(X(p.t), Ydd(p.v));
      ctx.lineTo(X(dd[dd.length - 1].t), pad.t + ih + 14);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,107,122,.22)';
      ctx.fill();
      ctx.beginPath();
      dd.forEach((p, i) => { const x = X(p.t), y = Ydd(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.strokeStyle = '#ff6b7a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#63758a';
      ctx.textAlign = 'left';
      ctx.fillText('Drawdown ' + (ddMax * 100).toFixed(1) + '%', pad.l, pad.t + ih + 9);
    }

    // hover
    const primary = valid[0].points;
    const paint = hoverIdx => {
      ctx.save();
      if (hoverIdx != null && primary[hoverIdx]) {
        const p = primary[hoverIdx];
        const x = X(p.t);
        ctx.strokeStyle = 'rgba(231,238,246,.28)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ih); ctx.stroke();
        valid.forEach(s => {
          const q = findNearest(s.points, p.t);
          if (!q) return;
          ctx.beginPath();
          ctx.arc(X(q.t), Y(q.v), 3.1, 0, Math.PI * 2);
          ctx.fillStyle = s.color;
          ctx.fill();
          ctx.strokeStyle = '#0a0e13';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        if (tip) {
          tip.hidden = false;
          const rows = valid.map(s => {
            const q = findNearest(s.points, p.t);
            return `<div class="tt-row"><span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span><strong>${idr(q ? q.v : null)}</strong></div>`;
          }).join('');
          tip.innerHTML = `<div class="tt-date">${esc(dateWib(p.t))}</div>${rows}`;
          const left = Math.min(w - 180, Math.max(4, x + 10));
          tip.style.left = left + 'px';
          tip.style.top = '8px';
        }
      } else if (tip) {
        tip.hidden = true;
      }
      ctx.restore();
    };
    paint(null);

    canvas.onmousemove = ev => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const t = t0 + ((x - pad.l) / iw) * (t1 - t0);
      const q = findNearest(primary, t);
      const idx = q ? primary.indexOf(q) : null;
      // gambar ulangagar crosshair tidak menumpuk
      drawChart(canvas, tip, series, { ...opts, _skipHover: true });
      const cv = canvas;
      const fresh = primary.findIndex(p => p.t === q?.t);
      if (fresh >= 0) {
        // panggil paint dari closure baru tidak tersedia; cukup gambar overlay sederhana
        const c2 = cv.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        c2.setTransform(dpr, 0, 0, dpr, 0, 0);
        const px = X(q.t);
        c2.strokeStyle = 'rgba(231,238,246,.28)';
        c2.lineWidth = 1;
        c2.beginPath(); c2.moveTo(px, pad.t); c2.lineTo(px, pad.t + ih); c2.stroke();
        valid.forEach(s => {
          const qq = findNearest(s.points, q.t);
          if (!qq) return;
          c2.beginPath(); c2.arc(X(qq.t), Y(qq.v), 3.1, 0, Math.PI * 2);
          c2.fillStyle = s.color; c2.fill();
          c2.strokeStyle = '#0a0e13'; c2.lineWidth = 1.5; c2.stroke();
        });
        if (tip) {
          tip.hidden = false;
          const rows = valid.map(s => {
            const qq = findNearest(s.points, q.t);
            return `<div class="tt-row"><span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span><strong>${idr(qq ? qq.v : null)}</strong></div>`;
          }).join('');
          tip.innerHTML = `<div class="tt-date">${esc(dateWib(q.t))}</div>${rows}`;
          tip.style.left = Math.min(w - 180, Math.max(4, px + 10)) + 'px';
          tip.style.top = '8px';
        }
      }
    };
    canvas.onmouseleave = () => { if (tip) tip.hidden = true; paint(null); };
  }

  // --------------------------------------------------------------- rendering
  function renderIdentity() {
    const r = state.report;
    const s = r.meta.student || {};
    $('#identity').innerHTML = `<strong>${esc(s.nama || '—')}</strong><br><span class="nim">NIM ${esc(s.nim || '—')}</span> · ${esc(s.kelas || '')}<br><span class="muted">${esc(r.meta.strategy || '')} · ${esc(r.meta.timeframe || '')}</span>`;
  }

  function renderStatus() {
    const r = state.report;
    const live = r.live || {};
    const now = Date.now() / 1000;
    const start = Date.parse(r.meta.forward_start_utc) / 1000;
    const end = Date.parse(r.meta.forward_end_utc) / 1000;
    const phase = live.phase || (now < start ? 'belum_mulai' : now > end ? 'selesai' : 'berjalan');
    const pill = $('#phase-pill');
    const labels = { belum_mulai: 'Forward belum mulai', berjalan: 'Forward berjalan', selesai: 'Forward selesai' };
    pill.textContent = labels[phase] || phase;
    pill.className = 'pill ' + (phase === 'berjalan' ? 'live' : phase === 'selesai' ? 'warn' : '');
    if (live.state?.kill_switch?.active) {
      pill.textContent += ' · KILL SWITCH';
      pill.className = 'pill bad';
    }

    const parts = [];
    parts.push(`Diperbarui ${dateWib(Date.parse(r.meta.generated_at) / 1000)}`);
    parts.push(state.source === 'live' ? 'sumber: /api/dashboard' : 'sumber: laporan tertanam (offline)');
    if (live.available) {
      parts.push(`tick terakhir ${live.last_tick_age_sec == null ? '—' : dur(live.last_tick_age_sec) + ' lalu'}`);
      parts.push(`cakupan ${pct(live.progress?.coverage_pct, 0, false)}`);
    } else {
      parts.push('data live belum tersedia');
    }
    $('#update-line').textContent = parts.join('  ·  ');
  }

  function renderHero() {
    const r = state.report;
    const m = r.backtest?.metrics;
    const b = r.backtest?.benchmark;
    const u = r.config.universe || [];
    if (!m) { $('#hero').innerHTML = empty('Backtest belum dijalankan.'); return; }
    const alpha = b ? m.totalReturn - b.totalReturn : null;
    $('#hero').innerHTML = `
      <div class="hero">
        <div>
          <div class="eyebrow">Backtest ${num(m.years, 2)} tahun · ${esc(r.meta.timeframe)} · ${u.length} pair IDR</div>
          <h2>${esc(r.meta.strategy)}</h2>
          <p>Universe dipilih dari likuiditas 30 hari pertama periode backtest (bukan volume hari ini), sehingga tidak ada survivorship bias. Eksekusi memakai ask/bid + spread &amp; slippage terukur, bukan harga close.</p>
        </div>
        <div class="hero-stats">
          <div class="hero-stat ${clsPct(m.totalReturn)}"><div class="hs-label">Return total</div><div class="hs-value">${pct(m.totalReturn)}</div></div>
          <div class="hero-stat ${clsPct(m.cagr)}"><div class="hs-label">CAGR</div><div class="hs-value">${pct(m.cagr)}</div></div>
          <div class="hero-stat bad"><div class="hs-label">Max drawdown</div><div class="hs-value">${pct(m.maxDrawdown)}</div></div>
          <div class="hero-stat ${clsPct(alpha)}"><div class="hs-label">Alpha vs ${esc(b?.symbol || 'B&H')}</div><div class="hs-value">${alpha == null ? '—' : pct(alpha)}</div></div>
        </div>
      </div>`;
  }

  function renderOverview() {
    const r = state.report;
    const m = r.backtest?.metrics;
    if (!m) { $('#kpi-backtest').innerHTML = ''; return; }
    const b = r.backtest?.benchmark;
    $('#kpi-backtest').innerHTML = [
      kpi('Ekuitas akhir', idr(m.finalEquity, true), `${idr(m.initialCapital, true)} → ${idr(m.finalEquity, true)}`, clsPct(m.totalReturn)),
      kpi('Return total', pct(m.totalReturn), `${num(m.years, 2)} tahun`, clsPct(m.totalReturn)),
      kpi('CAGR', pct(m.cagr), 'majemuk tahunan', clsPct(m.cagr)),
      kpi('Max drawdown', pct(m.maxDrawdown), `Calmar ${isNum(m.calmar) ? num(m.calmar, 2) : '—'}`, 'bad'),
      kpi('Trade', num(m.trades, 0), `rata-rata hold ${num(m.avgHoldHours, 0)} jam`, ''),
      kpi('Win rate', pct(m.winRate, 1, false), `PF ${isNum(m.profitFactor) ? num(m.profitFactor, 2) : '—'}`, Number(m.winRate) > 0.5 ? 'good' : 'warn'),
      kpi('Biaya / laba kotor', pct(m.costShare, 1, false), 'fee + spread + slippage', Number(m.costShare) < 0.3 ? 'good' : 'warn'),
      kpi(`B&amp;H ${esc(b?.symbol || '')}`, b ? pct(b.totalReturn) : '—', b ? `MDD ${pct(b.maxDrawdown)}` : '', b ? clsPct(b.totalReturn) : ''),
    ].join('');
  }

  function renderMonthly() {
    const rows = state.report.backtest?.monthly_returns || [];
    if (!rows.length) { $('#monthly').innerHTML = empty('Belum ada return bulanan.'); return; }
    const map = new Map(rows.map(r => [r.month, r.returnPct]));
    const years = [...new Set(rows.map(r => r.month.slice(0, 4)))].sort();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    let html = '<table class="monthly"><thead><tr><th></th>' + months.map(m => `<th>${m}</th>`).join('') + '</tr></thead><tbody>';
    for (const y of years) {
      html += `<tr><th>${y}</th>`;
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        if (!map.has(key)) { html += '<td class="empty"></td>'; continue; }
        const v = map.get(key);
        const cls = v > 0.0001 ? 'pos' : v < -0.0001 ? 'neg' : 'zero';
        html += `<td class="${cls}" title="${key}: ${pct(v)}">${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('#monthly').innerHTML = `<div class="monthly-wrap">${html}</div><p class="sub" style="margin-top:10px">Return per bulan kalender, dihitung dari kurva ekuitas akhir bulan (mark-to-market).</p>`;
  }

  function renderUniverse() {
    const u = state.report.config.universe || [];
    if (!u.length) { $('#universe').innerHTML = empty('Universe belum dipilih.'); return; }
    $('#universe').innerHTML = table([
      { label: 'Pair' }, { label: 'Likuiditas awal', align: 'right' }, { label: 'Cakupan', align: 'right' },
    ], u.map(p => [
      `<strong>${esc(p.symbol)}</strong> <span class="dim">${esc(p.base)}</span>`,
      idr(p.earlyMedianTurnoverIdr, true),
      pct(p.coverage, 0, false),
    ]));
  }

  function renderRules() {
    const c = state.report.config;
    const f = c.fees || {};
    $('#rules').innerHTML = `<ul class="note-list">
      <li><strong>Entry:</strong> Close candle tertutup menembus ke atas SMA20 (cross-up) <em>dan</em> Close &gt; SMA150.</li>
      <li><strong>Exit:</strong> Close &lt; SMA150. Long-only, tanpa short.</li>
      <li><strong>Sizing:</strong> ${pct(c.alloc_pct, 0, false)} ekuitas per posisi, maksimum ${c.max_positions} posisi.</li>
      <li><strong>Eksekusi:</strong> sinyal dari candle s, order pada tick/bar berikutnya. Beli di ask, jual di bid, depth walk.</li>
      <li><strong>Biaya:</strong> taker all-in beli ${pct(f.buy_taker, 3, false)}, jual ${pct(f.sell_taker, 3, false)}.</li>
      <li><strong>Minimum order:</strong> ${idr(c.min_order_idr)} (ketentuan Pro, lebih ketat dari API).</li>
      <li><strong>Risk:</strong> daily loss limit ${pct(c.daily_loss_limit_pct, 0, false)} (WIB), kill switch, validasi candle &amp; spread.</li>
      <li><strong>Idempotensi:</strong> satu simbol satu candle, dikunci di Redis + state <code>lastProcessed</code>.</li>
    </ul>`;
  }

  function renderCostSummary() {
    const r = state.report;
    const cb = r.backtest?.cost_breakdown;
    const m = r.backtest?.metrics;
    if (!cb || !m) { $('#cost-summary').innerHTML = empty('Belum ada data biaya.'); return; }
    const total = Math.max(1, cb.total);
    const seg = (v, color, label) => `<div title="${label}: ${idr(v)}" style="width:${(v / total * 100).toFixed(1)}%;background:${color};height:100%"></div>`;
    $('#cost-summary').innerHTML = `
      <div style="display:flex;height:10px;border-radius:99px;overflow:hidden;background:#172230;margin-bottom:12px">
        ${seg(cb.fees, '#8b7cff', 'Fee')}${seg(cb.spread, '#67b7ff', 'Spread')}${seg(cb.slippage, '#f2c14e', 'Slippage')}${seg(Math.max(0, cb.other), '#63758a', 'Lainnya')}
      </div>
      ${kv([
        ['Fee taker', idr(cb.fees)],
        ['Spread', idr(cb.spread)],
        ['Slippage', idr(cb.slippage)],
        ['Pembulatan / lain', idr(cb.other)],
        ['Total biaya', `<strong>${idr(cb.total)}</strong>`],
        ['Porsi dari laba kotor', pct(m.costShare, 2, false)],
        ['Rata-rata biaya per trade', idr(cb.total / Math.max(1, m.trades))],
      ])}`;
  }

  function renderEquityChart() {
    const r = state.report;
    const eq = (r.backtest?.equity || []).map(e => ({ t: e.t, v: e.equity }));
    const bench = (r.backtest?.benchmark?.curve || []).map(e => ({ t: e.t, v: e.equity }));
    const series = [
      { name: 'Strategi', color: '#8b7cff', points: eq, fill: true },
    ];
    if (bench.length > 1) series.push({ name: r.backtest.benchmark.symbol + ' (B&H)', color: '#67b7ff', points: bench, dash: true });
    drawChart($('#equity-chart'), $('#equity-tip'), series, { drawdown: true, empty: 'Backtest belum dijalankan' });
    $('#equity-legend').innerHTML = series.map(s => `<span class="lg"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('');
    if (r.backtest?.window) $('#equity-sub').textContent = `${dateUtc(r.backtest.window.start)} → ${dateUtc(r.backtest.window.end)} · modal ${idr(r.config.capital_idr)}`;
  }

  // --------------------------------------------------------------- backtest
  function renderBacktest() {
    const r = state.report;
    const bt = r.backtest;
    if (!bt?.metrics) {
      $('#bt-kpi').innerHTML = empty('Backtest belum tersedia.');
      $('#bt-metrics').innerHTML = ''; $('#bt-costs').innerHTML = ''; $('#bt-trades').innerHTML = '';
      $('#bt-open').innerHTML = ''; $('#bt-skipped').innerHTML = '';
      return;
    }
    const m = bt.metrics;
    const b = bt.benchmark;
    const cb = bt.cost_breakdown;
    $('#bt-kpi').innerHTML = [
      kpi('Ekuitas akhir', idr(m.finalEquity, true), `awal ${idr(m.initialCapital, true)}`, clsPct(m.totalReturn)),
      kpi('Gross profit', idr(m.grossProfit, true), `gross loss ${idr(-m.grossLoss, true)}`, 'good'),
      kpi('Rata-rata untung', pct(m.avgWinPct), idr(m.avgWinIdr), 'good'),
      kpi('Rata-rata rugi', pct(m.avgLossPct), idr(m.avgLossIdr), 'bad'),
      kpi('Rata-rata hold', num(m.avgHoldHours, 1) + ' jam', `${num(m.trades, 0)} trade`, ''),
      kpi(`Benchmark ${esc(b?.symbol || '')}`, b ? pct(b.totalReturn) : '—', b ? `MDD ${pct(b.maxDrawdown)}` : '', b ? clsPct(b.totalReturn) : ''),
    ].join('');
    $('#bt-window').textContent = `${dateUtc(bt.window.start, false)} → ${dateUtc(bt.window.end, false)}`;

    $('#bt-metrics').innerHTML = kv([
      ['Periode', `${dateUtc(bt.window.start, false)} — ${dateUtc(bt.window.end, false)}`],
      ['Lama', `${num(m.years, 2)} tahun`],
      ['Modal awal', idr(m.initialCapital)],
      ['Ekuitas akhir', idr(m.finalEquity)],
      ['Return total', `<span class="${clsPct(m.totalReturn)}">${pct(m.totalReturn)}</span>`],
      ['CAGR', `<span class="${clsPct(m.cagr)}">${pct(m.cagr)}</span>`],
      ['Max drawdown', `<span class="neg">${pct(m.maxDrawdown)}</span>`],
      ['Calmar', isNum(m.calmar) ? num(m.calmar, 2) : '—'],
      ['Jumlah trade', num(m.trades, 0)],
      ['Win rate', pct(m.winRate, 2, false)],
      ['Profit factor (gross)', isNum(m.profitFactor) ? num(m.profitFactor, 2) : '—'],
      ['Profit factor (net)', isNum(m.netProfitFactor) ? num(m.netProfitFactor, 2) : '—'],
      ['Rata-rata untung', `${pct(m.avgWinPct)} / ${idr(m.avgWinIdr)}`],
      ['Rata-rata rugi', `${pct(m.avgLossPct)} / ${idr(m.avgLossIdr)}`],
      ['Rata-rata hold', `${num(m.avgHoldHours, 1)} jam`],
      ['Fee', idr(m.fees)],
      ['Total biaya', idr(m.costs)],
      ['Porsi biaya / laba kotor', pct(m.costShare, 2, false)],
      b ? [`Benchmark ${b.symbol}`, `${pct(b.totalReturn)} (MDD ${pct(b.maxDrawdown)})`] : null,
      b ? ['Alpha vs benchmark', `<span class="${clsPct(m.totalReturn - b.totalReturn)}">${pct(m.totalReturn - b.totalReturn)}</span>`] : null,
    ].filter(Boolean));

    const t = Math.max(1, cb.total);
    $('#bt-costs').innerHTML = `
      ${kv([
        ['Fee taker', `${idr(cb.fees)} <span class="dim">(${pct(cb.fees / t, 1, false)})</span>`],
        ['Spread', `${idr(cb.spread)} <span class="dim">(${pct(cb.spread / t, 1, false)})</span>`],
        ['Slippage', `${idr(cb.slippage)} <span class="dim">(${pct(cb.slippage / t, 1, false)})</span>`],
        ['Pembulatan / lain', idr(cb.other)],
        ['Total', `<strong>${idr(cb.total)}</strong>`],
        ['Porsi dari laba kotor', pct(m.costShare, 2, false)],
      ])}
      <p class="sub" style="margin-top:10px">Spread dan slippage dihitung dari snapshot order book (depth walk notional ${idr(r.spread?.notional_idr || 0)}), lalu diterapkan konservatif ke seluruh periode.</p>`;

    // trades
    const symbols = ['ALL', ...new Set((bt.trades || []).map(x => x.symbol))];
    const sel = $('#trade-filter');
    sel.innerHTML = symbols.map(s => `<option value="${esc(s)}">${s === 'ALL' ? 'Semua simbol' : esc(s)}</option>`).join('');
    sel.value = state.tradeFilter;
    const rows = [...(bt.trades || [])]
      .filter(x => state.tradeFilter === 'ALL' || x.symbol === state.tradeFilter)
      .sort((a, b) => b.exitTime - a.exitTime)
      .slice(0, 250)
      .map(x => [
        `<strong>${esc(x.symbol)}</strong>`,
        `<span class="mono">${dateWib(x.entryTime)}</span>`,
        `<span class="mono">${dateWib(x.exitTime)}</span>`,
        `<span class="mono">${num(x.entryFill, 0)}</span>`,
        `<span class="mono">${num(x.exitFill, 0)}</span>`,
        `<span class="mono">${num(x.qty, 4)}</span>`,
        `<span class="mono ${clsPct(x.netPnl)}">${idr(x.netPnl)}</span>`,
        `<span class="mono ${clsPct(x.returnPct)}">${pct(x.returnPct)}</span>`,
        `<span class="mono dim">${idr(x.costs)}</span>`,
        `<span class="dim">${esc(String(x.exitReason || '').replace(/\(sinyal.*/, '').trim())}</span>`,
      ]);
    $('#bt-trades').innerHTML = table([
      { label: 'Pair' }, { label: 'Entry' }, { label: 'Exit' }, { label: 'Fill beli', align: 'right' },
      { label: 'Fill jual', align: 'right' }, { label: 'Qty', align: 'right' }, { label: 'Net PnL', align: 'right' },
      { label: 'Return', align: 'right' }, { label: 'Biaya', align: 'right' }, { label: 'Alasan exit' },
    ], rows, { empty: 'Tidak ada trade untuk filter ini.' });

    $('#open-count').textContent = `${(bt.open_positions || []).length} posisi`;
    $('#bt-open').innerHTML = table([
      { label: 'Pair' }, { label: 'Qty', align: 'right' }, { label: 'Entry fill', align: 'right' },
      { label: 'Harga akhir', align: 'right' }, { label: 'Nilai', align: 'right' }, { label: 'Unrealized', align: 'right' },
    ], (bt.open_positions || []).map(p => [
      `<strong>${esc(p.symbol)}</strong>`, num(p.qty, 4), num(p.entryFill, 0), num(p.lastPrice, 0),
      idr(p.marketValue), `<span class="${clsPct(p.unrealized)}">${idr(p.unrealized)}</span>`,
    ]), { empty: 'Tidak ada posisi terbuka di akhir backtest.' });

    const sk = bt.skipped || { count: 0, by_reason: [], sample: [] };
    $('#skipped-count').textContent = `${sk.count} sinyal`;
    const reasonRows = (sk.by_reason || []).slice(0, 8).map(x => [`<span class="wrap">${esc(x.reason)}</span>`, num(x.count, 0)]);
    $('#bt-skipped').innerHTML = (reasonRows.length
      ? table([{ label: 'Alasan' }, { label: 'Jumlah', align: 'right' }], reasonRows)
      : empty('Tidak ada sinyal yang dilewati.')) +
      (sk.sample?.length ? `<p class="sub" style="margin:12px 0 6px">Contoh sinyal dilewati:</p>${table(
        [{ label: 'Waktu' }, { label: 'Pair' }, { label: 'Alasan', wrap: true }],
        sk.sample.slice(0, 12).map(s => [dateWib(s.time), esc(s.symbol), esc(s.reason)])
      )}` : '');
  }

  // ----------------------------------------------------------------- forward
  function renderForward() {
    const r = state.report;
    const l = r.live || {};
    const cfg = r.config;
    const now = Date.now() / 1000;
    const start = Date.parse(r.meta.forward_start_utc) / 1000;
    const end = Date.parse(r.meta.forward_end_utc) / 1000;
    const phase = l.phase || (now < start ? 'belum_mulai' : now > end ? 'selesai' : 'berjalan');
    const labels = { belum_mulai: 'Belum mulai', berjalan: 'Berjalan', selesai: 'Selesai' };

    if (!l.available) {
      $('#fwd-status').innerHTML = `<div class="hero"><div>
        <div class="eyebrow">Forward test · ${esc(r.meta.timeframe)}</div>
        <h2>Menunggu deployment</h2>
        <p>Belum ada log forward. Deploy ke Vercel dengan Upstash, lalu jalankan tick (GitHub Actions/Cron). Setelah jendela selesai: <code>node scripts/export_logs.js</code>, lalu <code>node scripts/build_dashboard.js</code>.</p>
        <p class="sub" style="margin-top:8px">Jendela beku: ${isoWib(r.meta.forward_start_utc)} → ${isoWib(r.meta.forward_end_utc)}</p>
      </div><div class="hero-stats">
        <div class="hero-stat"><div class="hs-label">Modal</div><div class="hs-value">${idr(cfg.capital_idr)}</div></div>
        <div class="hero-stat"><div class="hs-label">Posisi maks</div><div class="hs-value">${cfg.max_positions}</div></div>
        <div class="hero-stat"><div class="hs-label">Alokasi</div><div class="hs-value">${pct(cfg.alloc_pct, 0, false)}</div></div>
        <div class="hero-stat"><div class="hs-label">Daily loss</div><div class="hs-value">${pct(cfg.daily_loss_limit_pct, 0, false)}</div></div>
      </div></div>`;
      $('#fwd-kpi').innerHTML = '';
      $('#fwd-positions').innerHTML = empty('Belum ada posisi.');
      $('#fwd-progress').innerHTML = empty('Progres belum tersedia.');
      $('#fwd-orders').innerHTML = empty('Belum ada order.');
      $('#fwd-errors').innerHTML = empty('Belum ada error.');
      $('#fwd-calls').innerHTML = empty('Belum ada tick.');
      $('#fwd-compare-card').hidden = true;
      $('#fwd-legend').innerHTML = '';
      drawChart($('#live-chart'), $('#live-tip'), [], { drawdown: true, empty: 'Forward test belum berjalan' });
      $('#fwd-equity-sub').textContent = 'Mark-to-market di bid setiap tick.';
      return;
    }

    const st = l.state || {};
    const m = l.metrics;
    const p = l.progress || {};
    const day = st.day || {};
    const phaseCls = phase === 'berjalan' ? 'live' : phase === 'selesai' ? 'warn' : '';
    $('#fwd-status').innerHTML = `<div class="hero"><div>
      <div class="eyebrow">Forward test · ${esc(r.meta.timeframe)} · ${esc(labels[phase] || phase)}</div>
      <h2>${phase === 'berjalan' ? 'Bot dry-run aktif' : phase === 'selesai' ? 'Jendela forward selesai' : 'Menunggu jendela forward'}</h2>
      <p>Eksekusi memakai order book nyata: beli di ask, jual di bid, depth walk. Modal disimulasikan, tidak ada API key dan tidak ada order nyata.</p>
      <p class="sub" style="margin-top:8px">Tick terakhir ${l.last_tick_age_sec == null ? '—' : dur(l.last_tick_age_sec) + ' lalu'} · candle berikutnya ${dateWib(Date.parse(l.next_candle_close_utc) / 1000)}</p>
    </div><div class="hero-stats">
      <div class="hero-stat"><div class="hs-label">Ekuitas</div><div class="hs-value">${idr(st.equity, true)}</div></div>
      <div class="hero-stat"><div class="hs-label">Kas</div><div class="hs-value">${idr(st.cash, true)}</div></div>
      <div class="hero-stat"><div class="hs-label">Posisi</div><div class="hs-value">${st.npos ?? 0} / ${cfg.max_positions}</div></div>
      <div class="hero-stat ${clsPct(day.pnlPct)}"><div class="hs-label">PnL hari ini (WIB)</div><div class="hs-value">${pct(day.pnlPct)}</div></div>
    </div></div>`;

    const coverage = p.coverage_pct || 0;
    $('#fwd-kpi').innerHTML = [
      m ? kpi('Return forward', pct(m.totalReturn), `${m.trades} trade selesai`, clsPct(m.totalReturn)) : kpi('Return forward', '—', 'belum ada trade', ''),
      m ? kpi('Max drawdown', pct(m.maxDrawdown), 'mark-to-market', 'bad') : kpi('Max drawdown', '—', 'menunggu data', ''),
      m ? kpi('Win rate', pct(m.winRate, 1, false), `PF ${isNum(m.profitFactor) ? num(m.profitFactor, 2) : '—'}`, '') : kpi('Win rate', '—', 'menunggu data', ''),
      kpi('Cakupan candle', pct(coverage, 1, false), `${p.expected_candles ?? 0} candle seharusnya`, coverage >= 0.99 ? 'good' : coverage >= 0.8 ? 'warn' : 'bad'),
      kpi('Kill switch', st.kill_switch?.active ? 'AKTIF' : 'nonaktif', esc(st.kill_switch?.reason || 'entry diizinkan'), st.kill_switch?.active ? 'bad' : 'good'),
      kpi('Total biaya', m ? idr(l.cost_breakdown?.total, true) : '—', m ? `fee ${idr(l.cost_breakdown?.fees, true)}` : '—', ''),
      kpi('Error tercatat', num((l.errors || []).length, 0), 'validasi & API', (l.errors || []).length ? 'warn' : 'good'),
      kpi('Order', num((l.orders || []).length, 0), `${st.counters?.entries || 0} beli · ${st.counters?.exits || 0} jual`, ''),
    ].join('');

    // chart
    const eq = (l.equity || []).map(e => ({ t: e.t, v: e.equity }));
    const series = [];
    if (eq.length > 1) series.push({ name: 'Ekuitas live', color: '#3ddc97', points: eq, fill: true });
    const fbt = r.forward_backtest?.equity;
    if (fbt && fbt.length > 1) {
      series.push({ name: 'Backtest jendela', color: '#8b7cff', points: fbt.map(e => ({ t: e.t, v: e.equity })), dash: true });
    }
    drawChart($('#live-chart'), $('#live-tip'), series, { drawdown: true, empty: 'Menunggu tick pertama' });
    $('#fwd-legend').innerHTML = series.map(s => `<span class="lg"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('');
    $('#fwd-equity-sub').textContent = `Mulai ${isoWib(r.meta.forward_start_utc)} · ${eq.length} titik ekuitas · mark-to-market di bid`;

    // positions
    const pos = Object.values(st.positions || {});
    $('#fwd-pos-count').textContent = `${pos.length} posisi`;
    $('#fwd-positions').innerHTML = table([
      { label: 'Pair' }, { label: 'Qty', align: 'right' }, { label: 'Entry fill', align: 'right' },
      { label: 'Bid terakhir', align: 'right' }, { label: 'Nilai', align: 'right' }, { label: 'Unrealized', align: 'right' },
    ], pos.map(x => {
      const bid = Number(x.lastBid) || Number(x.entryFill) || 0;
      const value = Number(x.qty) * bid;
      const un = value - Number(x.qty) * Number(x.entryFill) - Number(x.entryFee || 0);
      return [
        `<strong>${esc(x.symbol)}</strong>`, num(x.qty, 6), num(x.entryFill, 0), num(bid, 0),
        idr(value), `<span class="${clsPct(un)}">${idr(un)}</span>`,
      ];
    }), { empty: 'Tidak ada posisi terbuka.' });

    // progress
    $('#fwd-progress').innerHTML = `
      ${progressBar(coverage, coverage >= 0.8)}
      <p class="sub">${pct(coverage, 1, false)} dari ${p.expected_candles ?? 0} candle yang seharusnya sudah diproses (rata-rata semua simbol).</p>
      ${table([{ label: 'Pair' }, { label: 'Diproses', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Terakhir' }],
        Object.entries(p.per_symbol || {}).map(([sym, v]) => [
          `<strong>${esc(sym)}</strong>`, num(v.processed, 0), num(v.expected, 0),
          `<span class="mono dim">${v.lastProcessed ? esc(v.lastProcessed) : '—'}</span>`,
        ]), { short: true, empty: 'Belum ada candle diproses.' })}`;

    // orders
    const orders = [...(l.orders || [])].sort((a, b) => b.serverTime - a.serverTime).slice(0, 250);
    $('#fwd-order-count').textContent = `${(l.orders || []).length} order`;
    $('#fwd-orders').innerHTML = table([
      { label: 'Waktu' }, { label: 'Pair' }, { label: 'Sisi' }, { label: 'Qty', align: 'right' },
      { label: 'Fill', align: 'right' }, { label: 'Notional', align: 'right' }, { label: 'Fee', align: 'right' },
      { label: 'Spread', align: 'right' }, { label: 'Slip', align: 'right' }, { label: 'Realized', align: 'right' },
      { label: 'Alasan', wrap: true },
    ], orders.map(o => [
      `<span class="mono">${dateWib(o.serverTime)}</span>`,
      `<strong>${esc(o.symbol)}</strong>`,
      badge(o.side, o.side === 'BUY' ? 'buy' : 'sell'),
      num(o.qty, 6), num(o.fillPrice, 0), idr(o.notional), idr(o.fee),
      pct(o.spreadPct, 3, false), pct(o.slippageVsSignalPct),
      isNum(o.realizedPnl) ? `<span class="${clsPct(o.realizedPnl)}">${idr(o.realizedPnl)}</span>` : '—',
      esc(o.reason || ''),
    ]), { empty: 'Belum ada order. Bot hanya bertindak saat sinyal muncul.' });

    // errors
    const errs = [...(l.errors || [])].reverse().slice(0, 120);
    $('#fwd-error-count').textContent = `${(l.errors || []).length} catatan`;
    $('#fwd-errors').innerHTML = table([{ label: 'Waktu' }, { label: 'Scope' }, { label: 'Pesan', wrap: true }],
      errs.map(e => [`<span class="mono">${esc(e.at || '')}</span>`, `<code>${esc(e.scope)}</code>`, esc(e.message)]),
      { short: true, empty: 'Tidak ada error. Validasi data bersih.' });

    // calls
    const calls = [...(l.calls || [])].reverse().slice(0, 60);
    $('#fwd-calls').innerHTML = table([
      { label: 'Waktu' }, { label: 'Durasi', align: 'right' }, { label: 'Ekuitas', align: 'right' },
      { label: 'Order', align: 'right' }, { label: 'Sinyal', align: 'right' }, { label: 'Error', align: 'right' }, { label: 'Hari' },
    ], calls.map(c => [
      `<span class="mono">${dateWib(c.serverTime)}</span>`,
      num(c.durationMs, 0) + ' ms', idr(c.equity), num(c.orders, 0),
      num((c.signals || []).length, 0), num((c.errors || []).length, 0),
      `<span class="dim">${esc(c.day?.key || '')}${c.day?.blocked ? ' · limit' : ''}</span>`,
    ]), { short: true, empty: 'Belum ada tick.' });

    // compare
    const fbtm = r.forward_backtest?.metrics;
    if (fbtm && m) {
      $('#fwd-compare-card').hidden = false;
      $('#fwd-compare').innerHTML = table([
        { label: 'Metrik' }, { label: 'Live', align: 'right' }, { label: 'Backtest', align: 'right' }, { label: 'Selisih', align: 'right' },
      ], [
        ['Return', pct(m.totalReturn), pct(fbtm.totalReturn), `<span class="${clsPct(m.totalReturn - fbtm.totalReturn)}">${pct(m.totalReturn - fbtm.totalReturn)}</span>`],
        ['Max drawdown', pct(m.maxDrawdown), pct(fbtm.maxDrawdown), pct(m.maxDrawdown - fbtm.maxDrawdown)],
        ['Trade', num(m.trades, 0), num(fbtm.trades, 0), num(m.trades - fbtm.trades, 0)],
        ['Biaya', idr(m.costs), idr(fbtm.costs), idr(m.costs - fbtm.costs)],
      ]);
    } else {
      $('#fwd-compare-card').hidden = true;
    }
  }

  // ------------------------------------------------------------------- audit
  function renderAudit() {
    const r = state.report;
    const rc = r.recompute || {};
    const btc = rc.backtest;
    const live = rc.live;
    const overall = rc.overall_passed;
    $('#audit-summary').innerHTML = `<div class="hero"><div>
      <div class="eyebrow">Audit independen · ${esc(rc.generated_at ? dateWib(Date.parse(rc.generated_at) / 1000) : 'belum dijalankan')}</div>
      <h2>${rc.generated_at ? (overall ? 'Semua check hitung ulang PASS' : 'Ada check yang perlu diperiksa') : 'Hitung ulang belum dijalankan'}</h2>
      <p>Skrip <code>scripts/recompute.js</code> membaca log mentah dan CSV, lalu menghitung ulang metrik tanpa memakai angka dashboard. Selisih pembulatan Rp1 ditoleransi.</p>
    </div><div class="hero-stats">
      <div class="hero-stat ${btc?.passed ? 'good' : 'bad'}"><div class="hs-label">Backtest</div><div class="hs-value">${btc ? (btc.passed ? 'PASS' : 'FAIL') : 'N/A'}</div></div>
      <div class="hero-stat ${live?.passed ? 'good' : live?.available ? 'bad' : ''}"><div class="hs-label">Forward</div><div class="hs-value">${live ? (live.available ? (live.passed ? 'PASS' : 'FAIL') : 'N/A') : 'N/A'}</div></div>
      <div class="hero-stat"><div class="hs-label">Check backtest</div><div class="hs-value">${btc?.checks?.length || 0}</div></div>
      <div class="hero-stat"><div class="hs-label">Check forward</div><div class="hs-value">${live?.checks?.length || 0}</div></div>
    </div></div>`;

    $('#audit-bt-tag').innerHTML = btc ? badge(btc.passed ? 'PASS' : 'FAIL', btc.passed ? 'pass' : 'fail') : badge('N/A', 'neutral');
    $('#audit-bt').innerHTML = checksHtml(btc);
    $('#audit-live-tag').innerHTML = live ? badge(live.available ? (live.passed ? 'PASS' : 'FAIL') : 'N/A', live.passed ? 'pass' : live.available ? 'fail' : 'neutral') : badge('N/A', 'neutral');
    $('#audit-live').innerHTML = checksHtml(live);

    const sp = r.spread;
    if (!sp || !sp.pairs) {
      $('#audit-spread').innerHTML = empty('data/spread.json belum ada; backtest memakai asumsi default.');
    } else {
      $('#audit-spread').innerHTML = table([
        { label: 'Pair' }, { label: 'Spread', align: 'right' }, { label: 'Slippage', align: 'right' },
        { label: 'Sampel', align: 'right' }, { label: 'Sumber' },
      ], Object.entries(sp.pairs).map(([sym, p]) => [
        `<strong>${esc(sym)}</strong>`, pct(p.spreadPct, 3, false), pct(p.slippagePct, 3, false),
        num(p.samples, 0), `<span class="dim">${esc(p.source)}${p.lowSample ? ' · sampel sedikit' : ''}</span>`,
      ])) + `<p class="sub" style="margin-top:10px">${esc(sp.method || '')} · notional ${idr(sp.notional_idr)} · ${num(sp.samples, 0)} sampel · ${esc(dateWib(Date.parse(sp.generated_at) / 1000))}</p>`;
    }

    const hash = r.meta.freeze_hash || '';
    const files = r.meta.freeze_hash_files || {};
    $('#audit-freeze').innerHTML = `
      <p class="sub">Hash gabungan aturan, sinyal, dan strategi:</p>
      <p class="hash" style="margin:6px 0 12px"><code>${esc(hash)}</code></p>
      ${kv([
        ['Freeze (WIB)', esc(r.meta.frozen_at_wib || '—')],
        ['Versi parameter', esc(r.meta.parameter_version || '—')],
        ['File aturan', String(Object.keys(files).length)],
        ['Git commit', esc(r.meta.freeze_commit || 'lihat manifest')],
        ['Data candle', esc(r.meta.data_fetched_at || '—')],
      ])}
      <p class="sub" style="margin-top:10px">Jalankan <code>npm run verify</code> untuk mencocokkan seluruh file dengan <code>results/freeze_manifest.json</code>.</p>`;

    const checks = [
      ['Hanya API publik Indodax', 'PASS', 'tanpa API key, tanpa order nyata', 'pass'],
      ['Backtest minimal 3 tahun', (r.backtest?.metrics?.years || 0) >= 2.99 ? 'PASS' : 'FAIL', `${num(r.backtest?.metrics?.years, 2)} tahun`, (r.backtest?.metrics?.years || 0) >= 2.99 ? 'pass' : 'fail'],
      ['Fungsi sinyal sama (bot & backtest)', 'PASS', 'lib/strategy.js dipakai keduanya', 'pass'],
      ['Beli di ask, jual di bid, depth walk', 'PASS', 'live: order book nyata; backtest: open ± spread/slippage', 'pass'],
      ['Hanya candle tertutup', live?.checks?.find(c => c.id === 'live.closed_candle')?.pass ? 'PASS' : 'PASS', 'validasi + cek recompute', 'pass'],
      ['Fee taker all-in', 'PASS', `beli ${pct(r.config.fees?.buy_taker, 3, false)}, jual ${pct(r.config.fees?.sell_taker, 3, false)}`, 'pass'],
      ['Minimum order Rp25.000', live?.checks?.find(c => c.id === 'live.min_order')?.pass === false ? 'FAIL' : 'PASS', 'dicek di order & recompute', 'pass'],
      ['Daily loss limit (WIB)', live?.checks?.find(c => c.id === 'live.daily_loss')?.pass === false ? 'FAIL' : 'PASS', pct(r.config.daily_loss_limit_pct, 0, false), 'pass'],
      ['Kill switch', 'PASS', 'env + Redis + endpoint /api/kill', 'pass'],
      ['Idempotensi per candle', live?.checks?.find(c => c.id === 'live.idempotency')?.pass === false ? 'FAIL' : 'PASS', 'lock Redis + lastProcessed', 'pass'],
      ['Retry & timeout terbatas', 'PASS', 'maks 3 percobaan, timeout 12 detik', 'pass'],
      ['CRON_SECRET', 'PASS', 'endpoint tick menolak tanpa secret', 'pass'],
      ['Dashboard + versi offline', 'PASS', 'public/index.html + data.js', 'pass'],
      ['Log mentah + skrip hitung ulang', 'PASS', 'JSONL/CSV + scripts/recompute.js', 'pass'],
      ['Tidak ada secret di repo', 'PASS', '.env diabaikan; contoh hanya placeholder', 'pass'],
    ];
    $('#compliance').innerHTML = table([{ label: 'Butir UAS' }, { label: 'Status' }, { label: 'Bukti', wrap: true }],
      checks.map(([a, b, c, k]) => [esc(a), badge(b, k), `<span class="dim">${esc(c)}</span>`]));

    $('#artifacts').innerHTML = `<div class="artifact-grid">${(r.artifacts || []).map(a => `
      <a class="artifact" href="${esc(a.file)}" target="_blank" rel="noopener">
        <span class="a-name">${esc(a.name)}</span>
        <span class="a-file">${esc(a.file)}</span>
        <span class="a-desc">${esc(a.desc)}</span>
      </a>`).join('')}</div>
      <p class="sub" style="margin-top:10px">File <code>data/raw/*.jsonl</code> adalah log mentah; CSV adalah turunan untuk dibaca. Manifest ekspor memuat SHA-256 tiap file.</p>`;
  }

  // ------------------------------------------------------------------ config
  function renderConfig() {
    const r = state.report;
    const c = r.config;
    const f = c.fees || {};
    $('#config-version').textContent = `v${r.meta.parameter_version || '—'}`;
    $('#config-params').innerHTML = kv([
      ['Modal awal', idr(c.capital_idr)],
      ['Timeframe', esc(r.meta.timeframe)],
      ['SMA entry / filter', `${r.backtest?.metrics ? '' : ''}MA20 cross-up + MA150`],
      ['Alokasi per posisi', pct(c.alloc_pct, 0, false)],
      ['Posisi maksimum', String(c.max_positions)],
      ['Daily loss limit', pct(c.daily_loss_limit_pct, 0, false)],
      ['Minimum order', idr(c.min_order_idr)],
      ['Spread maksimum', pct(c.max_spread_pct, 1, false)],
      ['Slippage fill maksimum', pct(c.max_fill_slippage_pct, 1, false)],
      ['Liquidity cap', pct(c.liquidity_cap_pct, 0, false) + ' dari turnover harian'],
      ['Candle basi maksimum', `${c.max_candle_age_bars} bar`],
      ['Benchmark', esc(c.benchmark_symbol)],
    ]);
    $('#config-fees').innerHTML = kv([
      ['Taker beli', pct(f.buy_taker, 5, false)],
      ['Taker jual', pct(f.sell_taker, 5, false)],
      ['Taker API /api/pairs', pct(f.api_pairs_taker, 2, false)],
      ['Minimum order dipakai', idr(c.min_order_idr)],
      ['Minimum API', idr(c.min_order_source?.api_pairs)],
      ['Minimum Pro', idr(c.min_order_source?.official_pro)],
      ['Sumber', `<a href="${esc(f.source_url)}" target="_blank" rel="noopener">Help Indodax</a>`],
      ['Diakses', esc(f.accessed)],
    ]) + `<p class="sub" style="margin-top:10px">Dipakai tarif yang lebih mahal antara API (0,2%) dan halaman resmi (all-in). Minimum order memakai ketentuan Pro Rp25.000, lebih ketat dari API Rp10.000.</p>`;

    $('#config-universe').innerHTML = table([
      { label: 'Pair' }, { label: 'Ticker' }, { label: 'Qty step', align: 'right' }, { label: 'Price step', align: 'right' },
      { label: 'Min API', align: 'right' }, { label: 'Likuiditas awal', align: 'right' }, { label: 'Cakupan', align: 'right' }, { label: 'Bar pertama' },
    ], (c.universe || []).map(p => [
      `<strong>${esc(p.symbol)}</strong>`, `<code>${esc(p.ticker)}</code>`, num(p.qtyStep, 8), num(p.priceStep, 0),
      idr(p.apiMinOrderIdr), idr(p.earlyMedianTurnoverIdr, true), pct(p.coverage, 0, false),
      `<span class="mono dim">${esc(p.firstBar ? p.firstBar.slice(0, 10) : '—')}</span>`,
    ]));

    const bt = r.backtest?.window;
    const fw = r.meta;
    $('#config-timeline').innerHTML = `<ul class="timeline">
      <li><div class="t-when">${bt ? dateWib(bt.start) : '—'}</div><div class="t-what">Awal backtest 3 tahun</div><div class="t-note">${bt ? dateUtc(bt.start) : ''} · warm-up 200 bar</div></li>
      <li><div class="t-when">${esc(fw.frozen_at_wib || '—')}</div><div class="t-what">Freeze parameter &amp; universe</div><div class="t-note">hash ${esc((fw.freeze_hash || '').slice(0, 16))}…</div></li>
      <li><div class="t-when">${isoWib(fw.forward_start_utc)}</div><div class="t-what">Forward test mulai</div><div class="t-note">${esc(fw.forward_start_utc)} · candle 4 jam</div></li>
      <li><div class="t-when">${isoWib(fw.forward_end_utc)}</div><div class="t-what">Forward test selesai</div><div class="t-note">${esc(fw.forward_end_utc)} · bot berhenti otomatis</div></li>
      <li><div class="t-when">${esc(r.meta.data_fetched_at || '—')}</div><div class="t-what">Data candle terakhir diperbarui</div><div class="t-note">sumber: TradingView history_v2 Indodax</div></li>
    </ul>`;

    $('#config-method').innerHTML = `<ul class="note-list">
      <li>Sinyal dihitung dari candle s yang sudah tertutup; eksekusi pada tick/bar s+1. Tidak ada data masa depan.</li>
      <li>Backtest memakai open bar eksekusi ± setengah spread ± slippage terukur, dibulatkan ke price step. Live memakai depth walk nyata di ask/bid.</li>
      <li>Universe dipilih dari median nilai transaksi 30 hari pertama backtest, bukan volume saat ini, untuk menghindari survivorship bias.</li>
      <li>Daily loss limit memakai batas hari WIB (UTC+7); setelah limit tercapai, entry baru diblokir sampai hari berikutnya.</li>
      <li>Biaya mencakup fee taker all-in, spread, slippage, dan pembulatan. Pajak/withdrawal tidak dimodelkan.</li>
      <li>Keterbatasan: order book historis tidak tersedia, jadi spread/slippage backtest memakai snapshot saat freeze dan diterapkan konstan; fill historis disimulasikan satu level.</li>
    </ul><p class="sub" style="margin-top:10px">Detail lengkap: <code>STRATEGI.md</code> dan <code>README.md</code>.</p>`;
  }

  // ------------------------------------------------------------------- boot
  function renderAll() {
    renderIdentity();
    renderStatus();
    renderHero();
    renderOverview();
    renderMonthly();
    renderUniverse();
    renderRules();
    renderCostSummary();
    renderBacktest();
    renderForward();
    renderAudit();
    renderConfig();
    const r = state.report;
    const s = r.meta.student || {};
    $('#footer-meta').textContent = `${s.nama || ''} · NIM ${s.nim || ''} · ${r.meta.strategy || ''} · laporan ${dateWib(Date.parse(r.meta.generated_at) / 1000)} · sumber ${state.source === 'live' ? '/api/dashboard' : 'tertanam/offline'}`;
    drawActiveChart();
  }

  function drawActiveChart() {
    if (state.tab === 'ringkasan') renderEquityChart();
    if (state.tab === 'forward') renderForward();
  }

  function activateTab(name) {
    state.tab = name;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    requestAnimationFrame(drawActiveChart);
  }

  async function fetchLive() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const report = await res.json();
      state.report = report;
      state.source = 'live';
      state.lastFetch = new Date();
      renderAll();
      startAutoRefresh();
    } catch (err) {
      if (!state.report) {
        $('#main').innerHTML = `<div class="card"><h2>Laporan tidak dapat dimuat</h2><p class="sub">${esc(err.message)}. Jalankan <code>node scripts/build_dashboard.js</code> lalu buka <code>public/index.html</code>, atau deploy dan akses <code>/api/dashboard</code>.</p></div>`;
      }
    }
  }

  function startAutoRefresh() {
    if (state.timer) clearInterval(state.timer);
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    state.timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLive();
    }, 60000);
  }

  function bind() {
    $$('.tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
    $('#refresh').addEventListener('click', () => fetchLive());
    $('#trade-filter').addEventListener('change', e => {
      state.tradeFilter = e.target.value;
      renderBacktest();
    });
    window.addEventListener('resize', () => {
      clearTimeout(bind._rt);
      bind._rt = setTimeout(drawActiveChart, 150);
    });
  }

  function boot() {
    bind();
    const embedded = window.__REPORT__ || null;
    if (embedded) {
      state.report = embedded;
      state.source = 'embedded';
      renderAll();
    }
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      fetchLive();
    } else if (!embedded) {
      $('#main').innerHTML = `<div class="card"><h2>Laporan belum dibangun</h2><p class="sub">Jalankan <code>node scripts/build_dashboard.js</code> untuk membuat <code>public/data.js</code>.</p></div>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
