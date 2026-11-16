/* Mode coupling: pure p and g dipole modes evolving with Dnu(t) and DPi1(t), coupled into mixed modes.
   Convention as in stretching.py: theta_p = pi (nu/Dnu - eps_p), Theta_g = pi (eps_g - 1/(nu DPi1)), with eps_p the
   l = 1 p-mode offset. Pure p modes: nu = (n + eps_p) Dnu. Pure g modes: P = (m + eps_g) DPi1.
   Mixed modes: tan(theta_p) tan(Theta_g) = q. */
(() => {
  'use strict';
  const PI = Math.PI;

  // ---------- core (pure functions; exposed for testing) ----------
  const thetaP = (nu, a) => PI * (nu / a.dnu - a.ep);
  const thetaG = (nu, a) => PI * (a.eg - 1e6 / (nu * a.dpi));          // nu in uHz, DPi1 in s

  // Continuous phase Psi(nu), increasing with nu; mixed modes sit exactly at integer Psi.
  // atan(q cot Theta) jumps by +pi at every Theta = j pi; subtracting pi ceil(Theta/pi) removes the jumps.
  // The branch k and tan(Theta) come from the same reduced angle r = Theta/pi - k in (-1, 0], so they always agree;
  // computing them separately can put them on opposite sides of a multiple of pi and shift Psi by exactly 1.
  function psi(nu, a) {
    const u = a.eg - 1e6 / (nu * a.dpi), k = Math.ceil(u);
    let t = Math.tan(PI * (u - k));
    if (t === 0) t = -1e-300;                                          // Theta exactly k pi: the limit from below
    const A = Math.atan(a.q / t) - PI * k;
    return (thetaP(nu, a) - A) / PI;
  }
  // dPsi/dnu = 1/Dnu + G, with G = q nu_g'(nu) / (sin^2 Theta + q^2 cos^2 Theta) the g-mode part;
  // zeta = G / (dPsi/dnu) is the g fraction (same as make_zeta in stretching.py at a mixed mode).
  function dpsiParts(nu, a) {
    const tg = thetaG(nu, a), s = Math.sin(tg), c = Math.cos(tg);
    const G = (a.q * 1e6 / (nu * nu * a.dpi)) / (s * s + a.q * a.q * c * c);
    return { p: 1 / a.dnu, g: G };
  }

  // Newton's method on Psi(nu) - K inside a bracket (Psi is monotonic), safeguarded as in rtsafe (Numerical
  // Recipes): bisect whenever the Newton step leaves the bracket or fails to halve the previous step. Plain Newton
  // can cycle on the steep, step-like rise of Psi across a g mode and stop far from the root.
  function solveK(K, a, lo, hi, guess) {
    if (psi(lo, a) - K > 0 || psi(hi, a) - K < 0) return null;
    let x = Math.min(Math.max(guess, lo), hi), dxOld = hi - lo, dx = dxOld;
    for (let it = 0; it < 200; it++) {
      const f = psi(x, a) - K;
      if (Math.abs(f) < 1e-11) return x;
      if (f > 0) hi = x; else lo = x;
      if (hi - lo < 1e-13 * hi) return 0.5 * (lo + hi);
      const d = dpsiParts(x, a), df = d.p + d.g, xn = x - f / df;
      if (!(xn > lo && xn < hi) || Math.abs(2 * f) > Math.abs(dxOld * df)) { dxOld = dx; dx = 0.5 * (hi - lo); x = lo + dx; }
      else { dxOld = dx; dx = xn - x; x = xn; }
    }
    for (let it = 0; it < 200 && hi - lo > 1e-13 * hi; it++) {   // not reached in practice: finish by bisection
      const mid = 0.5 * (lo + hi); if (psi(mid, a) - K > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  function pureModes(a, lo, hi) {
    const p = [], g = [];
    for (let n = Math.ceil(lo / a.dnu - a.ep); n <= Math.floor(hi / a.dnu - a.ep); n++) p.push({ n, nu: (n + a.ep) * a.dnu });
    for (let m = Math.ceil(1e6 / (hi * a.dpi) - a.eg); m <= Math.floor(1e6 / (lo * a.dpi) - a.eg); m++) {
      const P = (m + a.eg) * a.dpi;
      if (P > 0) g.push({ m, nu: 1e6 / P });
    }
    return { p, g };
  }

  function mixedModes(a, lo, hi) {
    const out = [], K0 = Math.ceil(psi(lo, a)), K1 = Math.floor(psi(hi, a));
    let prev = lo;
    for (let K = K0; K <= K1; K++) {
      const d = dpsiParts(prev, a), guess = prev + Math.max(1e-6, (K - psi(prev, a)) / (d.p + d.g));
      const nu = solveK(K, a, prev, hi, guess);
      if (nu == null) continue;
      const dd = dpsiParts(nu, a);
      out.push({ K, nu, zeta: dd.g / (dd.p + dd.g) });
      prev = nu;
    }
    return out;
  }

  // s.dnu(t) and s.dpi(t) give the large separation (uHz) and period spacing (s) at time t in [0, 1]
  const at = (s, t) => ({ dnu: s.dnu(t), dpi: s.dpi(t), ep: s.ep, eg: s.eg, q: s.q });

  // Evolve over a time grid: lines keyed by mode label (n for p, m for g, K for mixed)
  function evolve(s, nt = 361) {
    const ts = Array.from({ length: nt }, (_, i) => i / (nt - 1));
    const P = new Map(), G = new Map(), M = new Map();
    const push = (map, key, t, nu, extra) => { if (!map.has(key)) map.set(key, []); map.get(key).push({ t, nu, ...extra }); };
    for (const t of ts) {
      const a = at(s, t), pm = pureModes(a, s.lo, s.hi);
      for (const x of pm.p) push(P, x.n, t, x.nu);
      for (const x of pm.g) push(G, x.m, t, x.nu);
      for (const x of mixedModes(a, s.lo, s.hi)) push(M, x.K, t, x.nu, { zeta: x.zeta });
    }
    return { P, G, M, dt: 1 / (nt - 1) };
  }

  window.CouplingCore = { thetaP, thetaG, psi, dpsiParts, mixedModes, pureModes, at, evolve };

  // ---------- interface ----------
  const $ = sel => document.querySelector(sel);

  // A fixed, illustrative track from an early subgiant (one g mode spread over many p modes) to a red giant (several
  // g modes per p mode) inside one frequency window. Dnu falls geometrically; DPi1 is set by the number of g modes per
  // Dnu at mid-window, N = Dnu / (nu^2 DPi1), which grows from N0 to N1 with ln N following
  // f(t) = t - a sin(2 pi t) / (2 pi): slow at both ends, fast through the crossover, so each stage gets time on screen.
  // Real stars reach large N mostly because nu_max falls as they expand; here DPi1 shrinks much faster than in a real
  // star so the whole story fits in one window.
  const TR = { dnu0: 22, dnu1: 18, N0: 0.15, N1: 3.5, a: 0.75, ep: 0.8, eg: 0.25, lo: 170, hi: 330 };
  const nuMid = Math.sqrt(TR.lo * TR.hi);
  const gPerDnu = a => a.dnu * 1e6 / (nuMid * nuMid * a.dpi);
  const dnuOf = t => TR.dnu0 * (TR.dnu1 / TR.dnu0) ** t;
  const NOf = t => TR.N0 * (TR.N1 / TR.N0) ** (t - TR.a * Math.sin(2 * PI * t) / (2 * PI));
  const S = { dnu: dnuOf, dpi: t => dnuOf(t) * 1e6 / (nuMid * nuMid * NOf(t)), ep: TR.ep, eg: TR.eg, lo: TR.lo, hi: TR.hi, q: 0.15, t: 0.15 };

  function rich(str) {
    const f = document.createDocumentFragment(), re = /_([A-Za-z0-9]+)/g; let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) f.append(str.slice(last, m.index));
      const s = document.createElement('sub'); s.textContent = m[1]; f.append(s); last = re.lastIndex;
    }
    if (last < str.length) f.append(str.slice(last));
    return f;
  }

  let T = {};
  const hexRGB = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  function readTheme() {
    const cs = getComputedStyle($('.cpl')), v = n => cs.getPropertyValue(n).trim();
    T = { p: v('--cp'), g: v('--cg'), fg: v('--fg'), muted: v('--muted'), grid: v('--border'),
          axis: v('--rule'), card: v('--card'), accent: v('--accent'), font: getComputedStyle(document.body).fontFamily };
    T.pRGB = hexRGB(T.p); T.gRGB = hexRGB(T.g);
  }
  // mixed-mode colour: p colour when p-like (zeta = 0), g colour when g-like (zeta = 1)
  function zetaColor(z) {
    const c = T.pRGB.map((p, i) => Math.round(p + (T.gRGB[i] - p) * z));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  class Panel {
    constructor(c, m) { this.c = c; this.g = c.getContext('2d'); this.m = m || { l: 56, r: 12, t: 10, b: 40 }; this.marks = []; this.hover = null; }
    resize() {
      const dpr = window.devicePixelRatio || 1; this.w = this.c.clientWidth; this.h = this.c.clientHeight;
      if (this.c.width !== Math.round(this.w * dpr) || this.c.height !== Math.round(this.h * dpr)) {
        this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      }
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0); this.g.clearRect(0, 0, this.w, this.h);
    }
    scales(x0, x1, y0, y1) {
      const { l, r, t, b } = this.m; Object.assign(this, { x0, x1, y0, y1 });
      this.px = v => l + (v - x0) / (x1 - x0) * (this.w - l - r);
      this.py = v => this.h - b - (v - y0) / (y1 - y0) * (this.h - t - b);
      this.ix = p => x0 + (p - l) / (this.w - l - r) * (x1 - x0);
    }
    inPlot(x, y) { const { l, r, t, b } = this.m; return x >= l && x <= this.w - r && y >= t && y <= this.h - b; }
    clip(fn) { const { l, r, t, b } = this.m, g = this.g; g.save(); g.beginPath(); g.rect(l, t, this.w - l - r, this.h - t - b); g.clip(); fn(g); g.restore(); }
    axes(xt, yt, xl, yl) {
      const g = this.g, { l, r, t, b } = this.m, W = this.w, H = this.h;
      g.lineWidth = 1; g.strokeStyle = T.grid; g.beginPath();
      for (const v of xt) { const x = Math.round(this.px(v)) + 0.5; g.moveTo(x, t); g.lineTo(x, H - b); }
      for (const v of yt) { const y = Math.round(this.py(v)) + 0.5; g.moveTo(l, y); g.lineTo(W - r, y); }
      g.stroke();
      g.strokeStyle = T.axis; g.beginPath(); g.moveTo(l, H - b + 0.5); g.lineTo(W - r, H - b + 0.5); g.moveTo(l - 0.5, t); g.lineTo(l - 0.5, H - b); g.stroke();
      g.fillStyle = T.muted; g.font = `12px ${T.font}`; g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of xt) g.fillText(fmt(v), this.px(v), H - b + 5);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of yt) g.fillText(fmt(v), l - 6, this.py(v));
      g.textBaseline = 'alphabetic'; richText(g, xl, l + (W - l - r) / 2, H - 6, 12.5, 'center');
      g.save(); g.translate(14, t + (H - t - b) / 2); g.rotate(-PI / 2); g.textBaseline = 'middle'; richText(g, yl, 0, 0, 12.5, 'center'); g.restore();
    }
    vline(x, color, dash) {
      const g = this.g, X = Math.round(this.px(x)) + 0.5;
      g.save(); if (dash) g.setLineDash([5, 4]); g.strokeStyle = color; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(X, this.m.t); g.lineTo(X, this.h - this.m.b); g.stroke(); g.restore();
    }
  }
  function richText(g, str, x, y, size, align) {
    const parts = [], re = /_([A-Za-z0-9]+)/g; let last = 0, m;
    while ((m = re.exec(str))) { if (m.index > last) parts.push([str.slice(last, m.index), 0]); parts.push([m[1], 1]); last = re.lastIndex; }
    if (last < str.length) parts.push([str.slice(last), 0]);
    const big = `${size}px ${T.font}`, small = `${Math.round(size * 0.74)}px ${T.font}`;
    let w = 0; for (const [s, sub] of parts) { g.font = sub ? small : big; w += g.measureText(s).width; }
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x; g.textAlign = 'left';
    for (const [s, sub] of parts) { g.font = sub ? small : big; g.fillText(s, cx, sub ? y + size * 0.28 : y); cx += g.measureText(s).width; }
  }
  function ticks(lo, hi, n) {
    const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    const st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9 * st; v += st) out.push(+v.toFixed(10));
    return out;
  }
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? String(+v.toFixed(1)) : String(+v.toFixed(2)));
  const pmod = (a, b) => ((a % b) + b) % b;

  // markers: pure p modes open circles, pure g modes open squares, mixed modes filled discs coloured by character
  // and sized by p character 1 - zeta
  function mark(g, kind, x, y, r, zeta) {
    g.beginPath();
    if (kind === 'g') g.rect(x - r, y - r, 2 * r, 2 * r); else g.arc(x, y, r, 0, 2 * PI);
    if (kind === 'm') { g.lineWidth = 2.5; g.strokeStyle = T.card; g.stroke(); g.fillStyle = zetaColor(zeta); g.fill(); }
    else { g.lineWidth = 3.5; g.strokeStyle = T.card; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = kind === 'p' ? T.p : T.g; g.stroke(); }
  }
  const mixedRadius = zeta => 2.5 + 4 * Math.sqrt(Math.max(0, 1 - zeta));

  let EV = null, panels = {};
  const recompute = () => { EV = CouplingCore.evolve(S); };

  const ZBINS = 16;
  function drawEvolution() {
    const P = panels.ev; P.resize(); P.marks = [];
    P.scales(0, 1, S.lo, S.hi);
    P.axes(ticks(0, 1, 5), ticks(S.lo, S.hi, 5), 'Time t', 'Frequency [μHz]');
    P.clip(g => {
      const joined = (q0, q1) => q1.t - q0.t < 1.5 * EV.dt;            // a gap means the line left the window
      g.lineJoin = 'round'; g.lineCap = 'round';
      // pure modes: thin, faint dashes underneath
      g.save(); g.globalAlpha = 0.55; g.lineWidth = 1; g.setLineDash([4, 4]);
      for (const [map, color] of [[EV.P, T.p], [EV.G, T.g]]) {
        g.strokeStyle = color; g.beginPath();
        for (const pts of map.values()) pts.forEach((q, i) => {
          const X = P.px(q.t), Y = P.py(q.nu); (i && joined(pts[i - 1], q)) ? g.lineTo(X, Y) : g.moveTo(X, Y);
        });
        g.stroke();
      }
      g.restore();
      // mixed modes: solid, each segment coloured by its g fraction (batched into bins of zeta)
      const bins = Array.from({ length: ZBINS }, () => []);
      for (const pts of EV.M.values()) for (let i = 1; i < pts.length; i++) {
        if (!joined(pts[i - 1], pts[i])) continue;
        const z = 0.5 * (pts[i - 1].zeta + pts[i].zeta);
        bins[Math.min(ZBINS - 1, Math.floor(z * ZBINS))].push(pts[i - 1], pts[i]);
      }
      g.lineWidth = 1.6;
      for (let k = ZBINS - 1; k >= 0; k--) {                          // g-like first, so p-like ridges stay on top
        const segs = bins[k]; if (!segs.length) continue;
        g.strokeStyle = zetaColor((k + 0.5) / ZBINS); g.beginPath();
        for (let j = 0; j < segs.length; j += 2) { g.moveTo(P.px(segs[j].t), P.py(segs[j].nu)); g.lineTo(P.px(segs[j + 1].t), P.py(segs[j + 1].nu)); }
        g.stroke();
      }
    });
    P.vline(S.t, T.fg, false);
    if (P.hover) { const g = P.g; g.save(); g.globalAlpha = 0.4; g.strokeStyle = T.fg; g.beginPath(); g.moveTo(P.m.l, P.hover.Y + 0.5); g.lineTo(P.w - P.m.r, P.hover.Y + 0.5); g.stroke(); g.restore(); }
  }

  function snapshot() {
    const a = CouplingCore.at(S, S.t), pm = CouplingCore.pureModes(a, S.lo, S.hi);
    return { a, p: pm.p, g: pm.g, m: CouplingCore.mixedModes(a, S.lo, S.hi) };
  }
  function drawEchelle(name, sn) {
    const P = panels[name], a = sn.a; P.resize(); P.marks = [];
    const freq = name === 'fe', period = freq ? a.dnu : a.dpi;
    const xOf = nu => (freq ? pmod(nu, a.dnu) : pmod(1e6 / nu, a.dpi));
    P.scales(0, period, S.lo, S.hi);
    P.axes(ticks(0, period, 4), ticks(S.lo, S.hi, 5), freq ? 'ν mod Δν [μHz]' : 'P mod ΔΠ_1 [s]', 'Frequency [μHz]');
    P.vline(freq ? pmod(a.ep, 1) * a.dnu : pmod(a.eg, 1) * a.dpi, freq ? T.p : T.g, true);
    P.clip(g => {
      for (const x of sn.p) { const X = P.px(xOf(x.nu)), Y = P.py(x.nu); mark(g, 'p', X, Y, 5.5); P.marks.push({ X, Y, kind: 'p', x }); }
      for (const x of sn.g) { const X = P.px(xOf(x.nu)), Y = P.py(x.nu); mark(g, 'g', X, Y, 4.5); P.marks.push({ X, Y, kind: 'g', x }); }
      for (const x of sn.m) { const X = P.px(xOf(x.nu)), Y = P.py(x.nu); mark(g, 'm', X, Y, mixedRadius(x.zeta), x.zeta); P.marks.push({ X, Y, kind: 'm', x }); }
      if (P.hover) { g.beginPath(); g.arc(P.hover.X, P.hover.Y, 9, 0, 2 * PI); g.lineWidth = 2; g.strokeStyle = T.fg; g.stroke(); }
    });
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function draw() {
    const sn = snapshot(), a = sn.a, N = gPerDnu(a);
    drawEvolution(); drawEchelle('fe', sn); drawEchelle('pe', sn);
    $('#r-t').textContent = S.t.toFixed(2);
    $('#r-dnu').textContent = `${a.dnu.toFixed(1)} μHz`;
    $('#r-dpi').textContent = `${a.dpi.toFixed(0)} s`;
    $('#r-N').textContent = `${N.toFixed(1)}, ${N < 0.8 ? 'subgiant-like' : N > 1.25 ? 'red-giant-like' : 'in between'}`;
  }

  function setT(t) { S.t = Math.min(1, Math.max(0, t)); $('#t-slider').value = S.t; schedule(); }
  let playTimer = 0;
  function setPlaying(on) {
    clearInterval(playTimer); playTimer = 0; $('#t-play').textContent = on ? 'Pause' : 'Play';
    if (!on) return;
    if (S.t >= 1) setT(0);
    playTimer = setInterval(() => { if (S.t >= 1) setPlaying(false); else setT(S.t + 0.003); }, 30);
  }

  // ---------- hover ----------
  const tip = () => $('#cpl-tip');
  function showTip(e, rows) {
    const el = tip(); el.replaceChildren();
    for (const [v, l] of rows) {
      const row = document.createElement('div'), b = document.createElement('strong'); b.append(rich(v)); row.append(b);
      if (l) { const s = document.createElement('span'); s.append(' ', rich(l)); row.append(s); }
      el.append(row);
    }
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  const hideTip = () => { tip().hidden = true; };
  function wireEchelle(name) {
    const P = panels[name];
    P.c.addEventListener('pointermove', e => {
      const r = P.c.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
      let best = null, bd = 14 * 14;
      for (const k of P.marks) { const d = (k.X - X) ** 2 + (k.Y - Y) ** 2; if (d < bd) { bd = d; best = k; } }
      P.hover = best; drawEchelle(name, snapshot());
      if (!best) { hideTip(); return; }
      const x = best.x;
      const rows = best.kind === 'p' ? [[`${x.nu.toFixed(1)} μHz`, 'pure p mode']]
        : best.kind === 'g' ? [[`${x.nu.toFixed(1)} μHz`, 'pure g mode'], [`${(1e6 / x.nu).toFixed(0)} s`, 'period']]
        : [[`${x.nu.toFixed(1)} μHz`, 'mixed mode'], [`${Math.round(100 * (1 - x.zeta))}% p`, `${Math.round(100 * x.zeta)}% g (ζ = ${x.zeta.toFixed(2)})`]];
      showTip(e, rows);
    });
    P.c.addEventListener('pointerleave', () => { P.hover = null; drawEchelle(name, snapshot()); hideTip(); });
  }
  function wireEvolution() {
    const P = panels.ev;
    const tAt = e => { const r = P.c.getBoundingClientRect(); return P.ix(e.clientX - r.left); };
    let dragging = false;
    P.c.addEventListener('pointerdown', e => { setPlaying(false); dragging = true; P.c.setPointerCapture(e.pointerId); setT(tAt(e)); });
    P.c.addEventListener('pointerup', () => { dragging = false; });
    P.c.addEventListener('pointermove', e => {
      const r = P.c.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
      if (dragging) setT(tAt(e));
      if (!P.inPlot(X, Y)) { P.hover = null; hideTip(); schedule(); return; }
      P.hover = { Y: Math.round(Y) }; schedule();
      const t = Math.min(1, Math.max(0, P.ix(X)));
      const nu = S.lo + (P.h - P.m.b - Y) / (P.h - P.m.t - P.m.b) * (S.hi - S.lo);
      showTip(e, [[`${nu.toFixed(1)} μHz`, `at t = ${t.toFixed(2)}`], ['', 'click or drag to set the time']]);
    });
    P.c.addEventListener('pointerleave', () => { P.hover = null; hideTip(); schedule(); });
  }

  function init() {
    readTheme();
    panels.ev = new Panel($('#c-ev')); panels.fe = new Panel($('#c-fe')); panels.pe = new Panel($('#c-pe'));
    wireEvolution(); wireEchelle('fe'); wireEchelle('pe');
    $('#t-slider').value = S.t;
    $('#t-slider').addEventListener('input', e => { setPlaying(false); setT(+e.target.value); });
    $('#t-play').addEventListener('click', () => setPlaying(!playTimer));
    const qs = $('#q-slider'), qv = $('#q-value');
    qs.value = S.q; qv.textContent = S.q.toFixed(2);
    qs.addEventListener('input', () => { S.q = +qs.value; qv.textContent = S.q.toFixed(2); recompute(); schedule(); });
    new ResizeObserver(() => schedule()).observe($('.cpl-grid'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); schedule(); });
    recompute(); draw();
  }
  init();
})();
