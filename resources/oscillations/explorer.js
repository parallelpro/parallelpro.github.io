/* Oscillation explorer: four linked panels driven by one slider.
   A browser port of a YREC/GYRE frequency examiner; the numbers are
   precomputed into data.json. */
(() => {
  'use strict';

  // ---------- small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const pow10 = k => (k === 0 ? '1' : k === 1 ? '10' : k === 2 ? '100' : '10' + String(k).split('').map(c => SUP[c]).join(''));
  const fmt = (v, d) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
  const fmtAge = myr => (myr == null ? '–' : myr < 1000 ? `${myr < 10 ? myr.toPrecision(2) : Math.round(myr)} Myr` : `${(myr / 1000).toFixed(2)} Gyr`);

  function richParts(str) {             // "P_rad = P_gas" -> runs, subscript where _word
    const parts = [], re = /_([A-Za-z0-9☉]+)/g; let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) parts.push({ t: str.slice(last, m.index), sub: false });
      parts.push({ t: m[1], sub: true }); last = re.lastIndex;
    }
    if (last < str.length) parts.push({ t: str.slice(last), sub: false });
    return parts;
  }
  function richText(g, str, x, y, size, align = 'left') {
    const parts = richParts(str), big = `${size}px ${T.font}`, small = `${Math.round(size * 0.74)}px ${T.font}`;
    let w = 0;
    for (const q of parts) { g.font = q.sub ? small : big; w += g.measureText(q.t).width; }
    let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.textAlign = 'left';
    for (const q of parts) { g.font = q.sub ? small : big; g.fillText(q.t, cx, q.sub ? y + size * 0.28 : y); cx += g.measureText(q.t).width; }
  }
  function richNode(str) {               // same markup, as safe DOM nodes
    const f = document.createDocumentFragment();
    for (const q of richParts(str)) {
      if (q.sub) { const e = document.createElement('sub'); e.textContent = q.t; f.append(e); }
      else f.append(document.createTextNode(q.t));
    }
    return f;
  }

  function niceStep(span, target) {
    const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function linTicks(lo, hi, target = 5) {
    const st = niceStep(hi - lo, target), out = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9 * st; v += st) out.push(+v.toFixed(10));
    return { values: out, step: st };
  }

  // ---------- data decoding ----------
  let D, S, N;
  const cache = new Map();

  function decSegs(segs, s) {
    return segs.map(flat => {
      const n = flat.length / 2, xs = new Float64Array(n), ys = new Float64Array(n);
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) { x += flat[2 * i]; y += flat[2 * i + 1]; xs[i] = x / s; ys[i] = y / s; }
      return { xs, ys };
    });
  }
  function decDelta(arr, s) {
    const out = new Float64Array(arr.length);
    let v = 0;
    for (let i = 0; i < arr.length; i++) { v += arr[i]; out[i] = v / s; }
    return out;
  }
  function profile(i) {
    if (cache.has(i)) return cache.get(i);
    const P = D.profiles;
    const p = {
      i, num: D.meta.first_profile + i, model: P.model[i], age: P.age[i], xc: P.xc[i],
      teff: P.teff[i], L: P.L[i], numax: P.numax[i], dnu: P.dnu[i], eps: P.eps[i],
      trho: decSegs(P.trho[i], S.log), brunt: decSegs(P.brunt[i], S.log), lamb: decSegs(P.lamb[i], S.log),
      modes: [
        { l: 0, nu: decDelta(P.l0[i], S.freq), d: null },
        { l: 1, nu: decDelta(P.l1[i], S.freq), d: P.d1[i].map(v => v / S.diam) },
        { l: 2, nu: decDelta(P.l2[i], S.freq), d: P.d2[i].map(v => v / S.diam) },
      ],
    };
    cache.set(i, p);
    return p;
  }
  function interpAt(segs, x) {           // value of a segmented curve at x, or null in a gap
    for (const { xs, ys } of segs) {
      if (x < xs[0] || x > xs[xs.length - 1]) continue;
      let k = 1;
      while (k < xs.length - 1 && xs[k] < x) k++;
      const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1] || 1);
      return ys[k - 1] + t * (ys[k] - ys[k - 1]);
    }
    return null;
  }

  // ---------- theme ----------
  let T = {};
  function readTheme() {
    const cs = getComputedStyle($('.osc'));
    const v = name => cs.getPropertyValue(name).trim();
    T = {
      s1: v('--s1'), s2: v('--s2'), s3: v('--s3'), hl: v('--hl'), line: v('--line'),
      card: v('--card'), fg: v('--fg'), muted: v('--muted'), grid: v('--border'), axis: v('--rule'),
      font: getComputedStyle(document.body).fontFamily,
      wash: matchMedia('(prefers-color-scheme: dark)').matches ? 0.2 : 0.12,
    };
  }

  // ---------- panel base ----------
  class Panel {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.m = { l: 54, r: 14, t: 10, b: 40 };
      this.hover = null;
    }
    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.w = this.c.clientWidth; this.h = this.c.clientHeight;
      this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    setScales(x0, x1, y0, y1) {
      const { l, r, t, b } = this.m;
      this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1;
      this.px = v => l + (v - x0) / (x1 - x0) * (this.w - l - r);
      this.py = v => this.h - b - (v - y0) / (y1 - y0) * (this.h - t - b);
      this.ix = p => x0 + (p - l) / (this.w - l - r) * (x1 - x0);
      this.iy = p => y0 + (this.h - b - p) / (this.h - t - b) * (y1 - y0);
    }
    inPlot(x, y) { const { l, r, t, b } = this.m; return x >= l && x <= this.w - r && y >= t && y <= this.h - b; }
    clear() { this.ctx.clearRect(0, 0, this.w, this.h); }
    clip(fn) {
      const { l, r, t, b } = this.m, g = this.ctx;
      g.save(); g.beginPath(); g.rect(l, t, this.w - l - r, this.h - t - b); g.clip(); fn(g); g.restore();
    }
    axes(xt, yt, xlabel, ylabel) {
      const g = this.ctx, { l, r, t, b } = this.m, W = this.w, H = this.h;
      g.lineWidth = 1; g.strokeStyle = T.grid;
      g.beginPath();
      for (const v of xt) { const x = Math.round(this.px(v.v)) + 0.5; if (x >= l && x <= W - r) { g.moveTo(x, t); g.lineTo(x, H - b); } }
      for (const v of yt) { const y = Math.round(this.py(v.v)) + 0.5; if (y >= t && y <= H - b) { g.moveTo(l, y); g.lineTo(W - r, y); } }
      g.stroke();
      g.strokeStyle = T.axis; g.beginPath(); g.moveTo(l, H - b + 0.5); g.lineTo(W - r, H - b + 0.5); g.moveTo(l - 0.5, t); g.lineTo(l - 0.5, H - b); g.stroke();
      g.fillStyle = T.muted; g.font = `12px ${T.font}`;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of xt) { const x = this.px(v.v); if (x >= l - 1 && x <= W - r + 1) g.fillText(v.s, x, H - b + 5); }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of yt) { const y = this.py(v.v); if (y >= t - 1 && y <= H - b + 1) g.fillText(v.s, l - 6, y); }
      g.fillStyle = T.muted; g.textBaseline = 'alphabetic';
      richText(g, xlabel, l + (W - l - r) / 2, H - 6, 12.5, 'center');
      g.save(); g.translate(13, t + (H - t - b) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle';
      richText(g, ylabel, 0, 0, 12.5, 'center'); g.restore();
    }
    polyline(segs, color, width = 2) {
      this.clip(g => {
        g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
        for (const { xs, ys } of segs) {
          g.beginPath();
          for (let k = 0; k < xs.length; k++) { const X = this.px(xs[k]), Y = this.py(ys[k]); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
          g.stroke();
        }
      });
    }
    hline(y, color, label) {
      const g = this.ctx, Y = this.py(y);
      if (Y < this.m.t || Y > this.h - this.m.b) return;
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = color; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(this.m.l, Y); g.lineTo(this.w - this.m.r, Y); g.stroke(); g.restore();
      if (label) {
        g.textBaseline = 'bottom';
        const x = this.w - this.m.r - 4, wpx = 34;
        g.fillStyle = T.card; g.globalAlpha = 0.85; g.fillRect(x - wpx - 3, Y - 19, wpx + 6, 16); g.globalAlpha = 1;
        g.fillStyle = T.fg; richText(g, label, x, Y - 3, 12, 'right');
      }
    }
    ring(x, y, r) {
      const g = this.ctx;
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = T.fg; g.stroke();
    }
  }
  const decadeTicks = (lo, hi) => {
    const out = [];
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) out.push({ v: k, s: pow10(k) });
    return out;
  };
  const valueTicks = (lo, hi, list, f = v => String(v)) =>
    list.map(v => ({ v: Math.log10(v), s: f(v) })).filter(t => t.v >= lo && t.v <= hi);
  const intTicks = (lo, hi, target = 6) => linTicks(lo, hi, target).values.map(v => ({ v, s: String(v).replace('-', '−') }));

  // ---------- the four panels ----------
  let cur = 0;
  let hrP, tpP, prP, ecP;

  function drawHR() {
    const P = hrP, L = D.meta.lims, g = P.ctx;
    P.resize(); P.clear();
    P.setScales(L.teff[1], L.teff[0], L.L[0], L.L[1]);           // Teff increases to the left
    const xt = valueTicks(L.teff[0], L.teff[1], [3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000]);
    const yt = valueTicks(L.L[0], L.L[1], [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100], v => String(v));
    P.axes(xt, yt, 'Effective temperature [K]', 'Luminosity [L_☉]');
    P.polyline([{ xs: track.teff, ys: track.L }], T.axis, 1.5);
    P.clip(g => {
      g.fillStyle = T.muted;
      for (let i = 0; i < N; i++) { g.beginPath(); g.arc(P.px(D.profiles.teff[i]), P.py(D.profiles.L[i]), 1.6, 0, 2 * Math.PI); g.fill(); }
      if (P.hover != null) P.ring(P.px(D.profiles.teff[P.hover]), P.py(D.profiles.L[P.hover]), 7);
      const X = P.px(D.profiles.teff[cur]), Y = P.py(D.profiles.L[cur]);
      g.beginPath(); g.arc(X, Y, 6.5, 0, 2 * Math.PI); g.fillStyle = T.hl; g.fill();
      g.lineWidth = 2; g.strokeStyle = T.card; g.stroke();
    });
  }

  function drawTP() {
    const P = tpP, L = D.meta.lims, g = P.ctx, p = profile(cur), eos = D.meta.eos;
    P.resize(); P.clear();
    P.setScales(L.logRho[0], L.logRho[1], L.logT[0], L.logT[1]);
    P.axes(intTicks(L.logRho[0], L.logRho[1]), intTicks(L.logT[0], L.logT[1], 5), 'log density [g cm⁻³]', 'log temperature [K]');
    const ref = [
      { xy: eos.radgas, label: 'P_rad = P_gas' },
      { xy: eos.degen, label: 'electron degeneracy' },
    ];
    if (eos.reldeg_logrho >= L.logRho[0] && eos.reldeg_logrho <= L.logRho[1])
      ref.push({ xy: [[eos.reldeg_logrho, eos.reldeg_logrho], [L.logT[0], L.logT[1]]], label: 'relativistic degeneracy' });
    for (const r of ref) {
      const [xs, ys] = r.xy;
      P.clip(g => {
        g.save(); g.setLineDash([5, 4]); g.strokeStyle = T.muted; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(P.px(xs[0]), P.py(ys[0])); g.lineTo(P.px(xs[1]), P.py(ys[1])); g.stroke(); g.restore();
      });
      // direct label: at 25% of the visible part of the line, rotated along it
      const vis = clipSegment(P, P.px(xs[0]), P.py(ys[0]), P.px(xs[1]), P.py(ys[1]));
      if (vis) {
        const [ax, ay, bx, by] = vis, t = 0.25, X = ax + t * (bx - ax), Y = ay + t * (by - ay);
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        g.save(); g.translate(X, Y); g.rotate(ang); g.fillStyle = T.muted; g.textBaseline = 'bottom';
        richText(g, r.label, 4, -4, 11.5); g.restore();
      }
    }
    P.polyline(p.trho, T.line, 2.2);
    if (P.hover) P.ring(P.px(P.hover.x), P.py(P.hover.y), 5);
  }

  function clipSegment(P, x0, y0, x1, y1) {        // Liang-Barsky against the plot box
    const xmin = P.m.l, xmax = P.w - P.m.r, ymin = P.m.t, ymax = P.h - P.m.b;
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
  }

  const LOGM = [-2, 0];                    // propagation diagram shows m/M from 10^-2 to 1
  // Local (Cowling, short-wavelength) dispersion relation, k_r^2 ~ (ν² − N²)(ν² − S₁²)/ν²:
  // p modes propagate where ν > N and ν > S₁; g modes where ν < N and ν < S₁ (needs N² > 0).
  function bounds(p, x) {
    const n = interpAt(p.brunt, x), s = interpAt(p.lamb, x);
    if (s == null) return null;
    return { pLow: n == null ? s : Math.max(n, s), gHigh: n == null ? null : Math.min(n, s) };
  }
  function drawCavities(P, p) {
    const nCols = Math.max(120, Math.round(P.w - P.m.l - P.m.r)), top = P.py(P.y1), bot = P.py(P.y0);
    P.clip(g => {
      g.globalAlpha = T.wash;
      for (const [key, color, edge] of [['pLow', T.s2, top], ['gHigh', T.s1, bot]]) {
        g.fillStyle = color;
        let run = [];
        const flush = () => {
          if (run.length > 1) {
            g.beginPath(); g.moveTo(run[0][0], edge);
            for (const [X, Y] of run) g.lineTo(X, Y);
            g.lineTo(run[run.length - 1][0], edge); g.closePath(); g.fill();
          }
          run = [];
        };
        for (let i = 0; i < nCols; i++) {
          const x = P.x0 + (P.x1 - P.x0) * i / (nCols - 1), b = bounds(p, x);
          if (!b || b[key] == null) { flush(); continue; }
          run.push([P.px(x), P.py(b[key])]);
        }
        flush();
      }
      g.globalAlpha = 1;
    });
    // direct labels, only where the label point really lies in that cavity
    const g = P.ctx; g.fillStyle = T.muted;
    const lab = (x, y, text, key) => {
      const b = bounds(p, x); if (!b || b[key] == null) return;
      const yv = P.iy(y);
      if (key === 'pLow' ? yv > b.pLow : yv < b.gHigh) { g.textBaseline = 'middle'; richText(g, text, P.px(x), y, 12, 'right'); }
    };
    lab(-0.15, P.m.t + 14, 'p-mode cavity', 'pLow');
    lab(-1.1, P.h - P.m.b - 14, 'g-mode cavity', 'gHigh');
  }
  function drawProp() {
    const P = prP, L = D.meta.lims, p = profile(cur), g = P.ctx;
    P.resize(); P.clear();
    P.setScales(LOGM[0], LOGM[1], L.lognu[0], L.lognu[1]);
    P.axes(decadeTicks(LOGM[0], LOGM[1]), decadeTicks(L.lognu[0], L.lognu[1]), 'Mass coordinate m / M', 'Frequency [μHz]');
    drawCavities(P, p);
    P.polyline(p.lamb, T.s2);
    P.polyline(p.brunt, T.s1);
    P.hline(Math.log10(p.numax), T.fg, 'ν_max');
    if (P.hover != null) {
      const X = Math.round(P.px(P.hover)) + 0.5;
      g.save(); g.strokeStyle = T.fg; g.globalAlpha = 0.35; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X, P.m.t); g.lineTo(X, P.h - P.m.b); g.stroke(); g.restore();
    }
  }

  function drawEchelle() {
    const P = ecP, p = profile(cur), g = P.ctx, dnu = p.dnu;
    P.resize(); P.clear();
    // Modes were computed within numax ± 3σ, σ = exp(0.9638 ln numax − 1.7145) (the envelope width of
    // get_model_Dnu; Yu+2018, Lund+2017, Li+2020). Limits from that window move smoothly with numax.
    const sig = Math.exp(0.9638 * Math.log(p.numax) - 1.7145);
    P.setScales(0, dnu, p.numax - 3.2 * sig, p.numax + 3.2 * sig);
    const xt = linTicks(0, dnu, 4).values.map(v => ({ v, s: fmtTick(v) }));
    const yt = linTicks(P.y0, P.y1, 6).values.map(v => ({ v, s: fmtTick(v) }));
    P.axes(xt, yt, 'ν mod Δν [μHz]', 'Frequency ν [μHz]');
    P.hline(p.numax, T.fg, 'ν_max');
    const K = Math.max(1.2, Math.min(2.1, 1.45 * (P.w - P.m.l - P.m.r) / 400));   // px per matplotlib point
    const color = [T.s1, T.s2, T.s3];
    P.clip(g => {
      // draw ℓ = 2, then 1, then 0; within a degree small (g-like) marks first
      for (const m of [p.modes[2], p.modes[1], p.modes[0]]) {
        const order = [...m.nu.keys()];
        if (m.d) order.sort((a, b) => m.d[a] - m.d[b]);
        for (const k of order) {
          const X = P.px(((m.nu[k] % dnu) + dnu) % dnu), Y = P.py(m.nu[k]);
          const r = (m.d ? m.d[k] : 6) * K / 2;
          marker(g, m.l, X, Y, r, color[m.l]);
        }
      }
    });
    if (P.hover) P.ring(P.px(P.hover.x), P.py(P.hover.y), Math.max(6, P.hover.r + 3));
  }
  const fmtTick = v => (Math.abs(v) >= 100 ? v.toFixed(0) : String(+v.toFixed(2)));

  function marker(g, l, x, y, r, color) {
    if (l === 0 || l === 1) {
      g.beginPath();
      if (l === 0) g.arc(x, y, r, 0, 2 * Math.PI);
      else {                                   // matplotlib '^': fills a d x d box
        g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.closePath();
      }
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = T.card; g.stroke();   // 1.5px surface ring outside
      g.fillStyle = color; g.fill();
    } else {
      const h = Math.max(r * 0.9, 1);
      g.strokeStyle = color; g.lineWidth = r > 2 ? 1.5 : 1.2;
      g.strokeRect(x - h, y - h, 2 * h, 2 * h);
    }
  }

  // ---------- hover / tooltip ----------
  const tip = () => $('#osc-tip');
  function showTip(evt, rows) {
    const el = tip();
    el.replaceChildren();
    for (const [value, label] of rows) {
      const row = document.createElement('div');
      const b = document.createElement('strong'); b.textContent = value; row.append(b);
      if (label) { const s = document.createElement('span'); s.append(' ', richNode(label)); row.append(s); }
      el.append(row);
    }
    el.hidden = false;
    const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  const hideTip = () => { tip().hidden = true; };
  const local = (P, e) => { const r = P.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function wireHover(P, find, draw, onClick) {
    P.c.addEventListener('pointermove', e => {
      const [x, y] = local(P, e);
      const hit = P.inPlot(x, y) ? find(x, y, e) : null;
      P.hover = hit ? hit.key : null;
      draw();
      hit ? showTip(e, hit.rows) : hideTip();
      P.c.style.cursor = hit && onClick ? 'pointer' : 'default';
    });
    P.c.addEventListener('pointerleave', () => { P.hover = null; draw(); hideTip(); });
    if (onClick) P.c.addEventListener('click', e => {
      const [x, y] = local(P, e);
      const hit = P.inPlot(x, y) ? find(x, y, e) : null;
      if (hit) onClick(hit);
    });
  }

  function nearestProfile(x, y) {
    let best = -1, bd = 24 * 24;
    for (let i = 0; i < N; i++) {
      const dx = hrP.px(D.profiles.teff[i]) - x, dy = hrP.py(D.profiles.L[i]) - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const p = D.profiles;
    return {
      key: best, i: best,
      rows: [[fmtAge(p.age[best]), 'age'], [`${Math.round(10 ** p.teff[best])} K`, 'Teff'],
             [`${fmt(p.numax[best], 0)} μHz`, 'ν_max'], ['', 'click to select']],
    };
  }

  // ---------- state & UI ----------
  let track;
  function select(i, { fromSlider = false } = {}) {
    cur = Math.max(0, Math.min(N - 1, i));
    const p = profile(cur);
    if (!fromSlider) $('#osc-slider').value = cur;
    $('#osc-slider').setAttribute('aria-valuetext', `Model ${p.num} of ${N}, age ${fmtAge(p.age)}`);
    $('#r-num').textContent = `${p.num} / ${D.meta.first_profile + N - 1}`;
    $('#r-age').textContent = fmtAge(p.age);
    $('#r-xc').textContent = fmt(p.xc, 3);
    $('#r-numax').textContent = `${fmt(p.numax, 0)} μHz`;
    $('#r-dnu').textContent = `${fmt(p.dnu, 2)} μHz`;
    $('#r-eps').textContent = fmt(p.eps, 2);
    hrP.c.setAttribute('aria-label', `H–R diagram with the selected model at ${Math.round(10 ** p.teff)} K and ${fmt(10 ** p.L, 2)} solar luminosities`);
    ecP.c.setAttribute('aria-label', `Échelle diagram: Δν = ${fmt(p.dnu, 2)} μHz, ν_max = ${fmt(p.numax, 0)} μHz`);
    drawAll();
    if ($('#osc-table').open) fillTable();
    scheduleHash();
  }
  function drawAll() { drawHR(); drawTP(); drawProp(); drawEchelle(); }

  let hashTimer = 0;
  function scheduleHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => history.replaceState(null, '', `#model=${profile(cur).num}`), 250);
  }

  function fillTable() {
    const p = profile(cur), body = $('#osc-table tbody');
    const rows = [];
    for (const m of p.modes) for (const v of m.nu) rows.push([m.l, v]);
    rows.sort((a, b) => a[1] - b[1]);
    body.replaceChildren(...rows.map(([l, v]) => {
      const tr = document.createElement('tr');
      for (const s of [String(l), v.toFixed(2), (((v % p.dnu) + p.dnu) % p.dnu).toFixed(2)]) {
        const td = document.createElement('td'); td.textContent = s; tr.append(td);
      }
      return tr;
    }));
    $('#osc-table-caption').textContent = `Model ${p.num}: ${rows.length} modes, Δν = ${fmt(p.dnu, 2)} μHz`;
  }

  let playTimer = 0;
  function setPlaying(on) {
    const btn = $('#osc-play');
    clearInterval(playTimer); playTimer = 0;
    btn.textContent = on ? 'Pause' : 'Play';
    btn.setAttribute('aria-pressed', String(on));
    if (!on) return;
    if (cur >= N - 1) select(0);
    playTimer = setInterval(() => { if (cur >= N - 1) setPlaying(false); else select(cur + 1); }, 40);
  }

  async function init() {
    const status = $('#osc-status');
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
    } catch (err) {
      status.textContent = `Could not load the model data (${err.message}).`;
      return;
    }
    S = D.meta.scales; N = D.profiles.model.length;
    track = { teff: decDelta(D.track.teff, S.teff), L: decDelta(D.track.L, S.log) };
    readTheme();
    hrP = new Panel($('#c-hr')); tpP = new Panel($('#c-tp')); prP = new Panel($('#c-prop')); ecP = new Panel($('#c-ech'));
    ecP.m.l = 58; prP.m.l = 50;

    const slider = $('#osc-slider');
    slider.max = N - 1;
    slider.addEventListener('input', () => { setPlaying(false); select(+slider.value, { fromSlider: true }); });
    $('#osc-prev').addEventListener('click', () => { setPlaying(false); select(cur - 1); });
    $('#osc-next').addEventListener('click', () => { setPlaying(false); select(cur + 1); });
    $('#osc-play').addEventListener('click', () => setPlaying(!playTimer));
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { setPlaying(false); select(cur + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { setPlaying(false); select(cur - 1); e.preventDefault(); }
    });
    $('#osc-table').addEventListener('toggle', () => { if ($('#osc-table').open) fillTable(); });

    wireHover(hrP, nearestProfile, drawHR, hit => { setPlaying(false); select(hit.i); });
    wireHover(tpP, (x, y) => {
      const p = profile(cur); let best = null, bd = 24 * 24;
      for (const { xs, ys } of p.trho) for (let k = 0; k < xs.length; k++) {
        const dx = tpP.px(xs[k]) - x, dy = tpP.py(ys[k]) - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: xs[k], y: ys[k] }; }
      }
      // fall back to the pointer position projected onto the curve's x
      if (!best) return null;
      return { key: best, rows: [[fmt(best.y, 2), 'log T'], [fmt(best.x, 2), 'log ρ']] };
    }, drawTP);
    wireHover(prP, x => {
      const p = profile(cur), lx = prP.ix(x);
      const n = interpAt(p.brunt, lx), s = interpAt(p.lamb, lx);
      const inside = p.lamb.length && lx >= p.lamb[0].xs[0] && lx <= p.lamb[p.lamb.length - 1].xs.at(-1);
      if (!inside) return null;
      const mf = 10 ** lx;
      return {
        key: lx,
        rows: [[n == null ? 'N² < 0' : `${fmtFreq(10 ** n)} μHz`, n == null ? '(convective)' : 'N'],
               [s == null ? '–' : `${fmtFreq(10 ** s)} μHz`, 'S₁'],
               [mf < 1e-3 ? mf.toExponential(1) : mf.toPrecision(3), 'm / M'],
               [cavityName(p, lx), 'at ν_max']],
      };
    }, drawProp);
    wireHover(ecP, (x, y) => {
      const p = profile(cur); let best = null, bd = 24 * 24;
      for (const m of p.modes) m.nu.forEach((v, k) => {
        const mx = ((v % p.dnu) + p.dnu) % p.dnu;
        const dx = ecP.px(mx) - x, dy = ecP.py(v) - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: mx, y: v, r: (m.d ? m.d[k] : 6) * 0.85, l: m.l }; }
      });
      if (!best) return null;
      return { key: best, rows: [[`${best.y.toFixed(2)} μHz`, `ℓ = ${best.l}`], [`${best.x.toFixed(2)} μHz`, 'ν mod Δν']] };
    }, drawEchelle);

    new ResizeObserver(() => drawAll()).observe($('.osc-grid'));
    // keep the sticky controls just below the site header, whose height grows when the nav wraps on phones
    const header = $('.site-header'), controls = $('.osc-controls');
    new ResizeObserver(() => { controls.style.top = `${header.getBoundingClientRect().height}px`; }).observe(header);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); drawAll(); });

    const m = location.hash.match(/model=(\d+)/);
    const start = m ? +m[1] - D.meta.first_profile : N - 1;
    status.hidden = true;
    $('.osc').classList.add('is-ready');
    select(isFinite(start) ? start : N - 1);
  }
  function cavityName(p, x) {
    const b = bounds(p, x), y = Math.log10(p.numax);
    if (!b) return '–';
    if (y > b.pLow) return 'p-mode cavity';
    if (b.gHigh != null && y < b.gHigh) return 'g-mode cavity';
    return 'evanescent';
  }
  const fmtFreq = v => (v >= 100 ? Math.round(v).toLocaleString('en') : v.toPrecision(3));

  init();
})();
