// Stretched échelle diagrams: interface. Computation lives in echelle-core.js.
import * as C from './echelle-core.js';

const $ = (sel, el = document) => el.querySelector(sel);
const EXAMPLES = {
  KIC10272858: 'examples/KIC10272858.json', KIC10972873: 'examples/KIC10972873.json',
  KIC7593843: 'examples/KIC7593843.json',
};
const DEFAULTS = { eps_p: 1.0, d01: 0, dpi1: 100, q: 0.15, eps_g: 0.3, q_k: 0, alpha_p: 0 };
const dnuScaling = numax => 0.263 * numax ** 0.772;
// window half-width in Dnu: ~0.4 numax/Dnu, so clump stars (numax ~ 8 Dnu) don't fold down to
// very low frequencies, where long periods would pile hundreds of rows into the period echelle
const autoHalf = (numax, dnu) => Math.min(7, Math.max(2, Math.round(0.4 * numax / dnu)));

// ---------- state ----------
const S = {
  spec: null,                 // { label, kind, source, nu, raw, smooth, dnuBin }
  modes: [], modesLabel: '', modesSource: '',
  example: null,
  numax: 300, dnuRef: 20,
  p: { dnu: 20, ...DEFAULTS },
  v: { half: 7, smooth: 0.005, clip: 99, rep: true, guides: true, image: true, marks: true },
  version: 0,                 // bumps whenever the data or smoothing change
  notice: '',
};
const P = () => ({ ...S.p, numax: S.numax });

// ---------- controls ----------
const CONTROLS = [
  { key: 'numax', label: 'ν_max', unit: 'μHz', group: 'p', digits: 2, range: () => [0.5 * S.numaxRef, 1.5 * S.numaxRef], step: () => S.numaxRef / 5000 },
  { key: 'dnu', label: 'Δν', unit: 'μHz', group: 'p', digits: 4, range: () => [0.8 * S.dnuRef, 1.2 * S.dnuRef], step: () => S.dnuRef / 20000 },
  { key: 'eps_p', label: 'ε_p', group: 'p', digits: 4, range: () => [0, 2], step: () => 0.001 },
  { key: 'd01', label: 'd_01', group: 'p', digits: 4, range: () => [-0.25, 0.25], step: () => 0.001 },
  { key: 'dpi1', label: 'ΔΠ_1', unit: 's', group: 'g', digits: 2, range: () => [30, 450], step: () => 0.01 },
  { key: 'q', label: 'q', group: 'g', digits: 4, range: () => [0, 1], step: () => 0.001 },
  { key: 'eps_g', label: 'ε_g', group: 'g', digits: 4, range: () => [0, 1], step: () => 0.001 },
  { key: 'half', label: 'Window', unit: '±Δν', group: 'view', digits: 0, range: () => [2, 25], step: () => 1 },
  { key: 'smooth', label: 'Smooth', unit: '×Δν', group: 'view', digits: 4, range: () => [0, 0.02], step: () => 0.0005 },
  { key: 'clip', label: 'Contrast', unit: 'pct', group: 'view', digits: 1, range: () => [90, 99.9], step: () => 0.1 },
  { key: 'q_k', label: 'q_k', unit: '/μHz', group: 'adv', digits: 5, range: () => [-0.01, 0.01], step: () => 1e-5 },
  { key: 'alpha_p', label: 'α_p', group: 'adv', digits: 4, range: () => [-0.02, 0.04], step: () => 1e-4 },
];
const VIEW_KEYS = new Set(['half', 'smooth', 'clip']);
const get = k => (k === 'numax' ? S.numax : VIEW_KEYS.has(k) ? S.v[k] : S.p[k]);
function set(k, v) {
  if (k === 'numax') S.numax = v;
  else if (VIEW_KEYS.has(k)) S.v[k] = v;
  else S.p[k] = v;
}

function rich(str) {                       // "ΔΠ_1" -> ΔΠ<sub>1</sub>, built as safe DOM nodes
  const f = document.createDocumentFragment(), re = /_([A-Za-z0-9]+)/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) f.append(str.slice(last, m.index));
    const s = document.createElement('sub'); s.textContent = m[1]; f.append(s); last = re.lastIndex;
  }
  if (last < str.length) f.append(str.slice(last));
  return f;
}

const ctl = {};
function buildControls() {
  for (const c of CONTROLS) {
    const row = document.createElement('div'); row.className = 'prm';
    const id = `s-${c.key}`;
    const lab = document.createElement('label'); lab.htmlFor = id; lab.append(rich(c.label));
    if (c.unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = ' ' + c.unit; lab.append(u); }
    const range = document.createElement('input'); range.type = 'range'; range.id = id;
    const num = document.createElement('input'); num.type = 'number'; num.step = 'any';
    num.setAttribute('aria-label', `${c.label.replace('_', '')} value`);
    row.append(lab, range, num);
    const host = c.group === 'adv' ? $('details.ech-adv') : $(`.ech-group[data-group="${c.group}"]`);
    if (c.group === 'view') host.insertBefore(row, $('.ech-toggles', host)); else host.append(row);
    ctl[c.key] = { c, range, num };

    range.addEventListener('input', () => {
      set(c.key, +range.value);
      num.value = (+range.value).toFixed(c.digits);
      afterChange(c.key);
    });
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v)) { num.value = get(c.key).toFixed(c.digits); return; }
      set(c.key, v);
      if (c.key === 'dnu') { S.dnuRef = v; resmooth(); }
      if (c.key === 'numax') S.numaxRef = v;
      syncControls();
      afterChange(c.key);
    });
  }
  const toggles = { 't-rep': 'rep', 't-guides': 'guides', 't-image': 'image', 't-marks': 'marks' };
  for (const [id, key] of Object.entries(toggles)) {
    $('#' + id).addEventListener('change', e => { S.v[key] = e.target.checked; schedule(); scheduleHash(); });
  }
}
function syncControls() {
  for (const { c, range, num } of Object.values(ctl)) {
    let [lo, hi] = c.range();
    const v = get(c.key);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    range.min = lo; range.max = hi; range.step = c.step();
    range.value = v;
    num.value = v.toFixed(c.digits);
  }
  for (const [id, key] of Object.entries({ 't-rep': 'rep', 't-guides': 'guides', 't-image': 'image', 't-marks': 'marks' })) $('#' + id).checked = S.v[key];
}
function afterChange(key) {
  if (key === 'half') S.halfAuto = false;
  if (S.halfAuto && (key === 'numax' || key === 'dnu')) { S.v.half = autoHalf(S.numax, S.p.dnu); syncControls(); }
  if (key === 'smooth') resmooth();
  schedule();
  scheduleHash();
}

// ---------- data ----------
function resmooth() {
  if (!S.spec) return;
  S.spec.smooth = S.v.smooth > 0 ? C.smoothBoxcar(S.spec.raw, S.v.smooth * S.dnuRef / S.spec.dnuBin) : S.spec.raw;
  S.version++;
}
function resetParams(numax, dnu) {
  S.numax = S.numaxRef = numax;
  S.p = { dnu, ...DEFAULTS };
  S.dnuRef = dnu;
  S.v.half = autoHalf(numax, dnu);
  S.halfAuto = true;          // follow numax/dnu until the window is set by hand
}

async function loadExample(id, hashParams) {
  setStatus([['Loading the example…']]);
  let d;
  try {
    const res = await fetch(EXAMPLES[id]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    d = await res.json();
  } catch (err) {
    setStatus([[`Could not load the example (${err.message}).`, 'error']]); return;
  }
  const nu = new Float64Array(d.n);
  for (let i = 0; i < d.n; i++) nu[i] = d.f0 + d.df * i;
  S.spec = { label: d.name, kind: d.kind, source: 'example', nu, raw: Float64Array.from(d.snr100, v => v / 100), dnuBin: d.df };
  S.modes = d.modes.map(([fc, l]) => ({ fc, l }));
  S.modesLabel = d.name; S.modesSource = 'example';
  S.example = id;
  resetParams(d.numax, d.params.dnu);
  Object.assign(S.p, { eps_p: d.params.eps_p, dpi1: d.params.dpi1, q: d.params.q, d01: d.params.d01 });
  for (const k of ['eps_g', 'q_k', 'alpha_p']) if (Number.isFinite(d.params[k])) S.p[k] = d.params[k];
  S.v.smooth = d.params.smooth;
  S.v.half = d.view?.half ?? 7;
  S.halfAuto = false;
  if (hashParams) applyHash(hashParams);
  S.notice = '';
  $('#ex-select').value = id;
  resmooth(); syncControls(); updateStatus(); schedule(); scheduleHash();
}

function useSpectrum(label, parsed) {
  const wasExample = S.spec?.source === 'example' || S.modesSource === 'example';
  if (wasExample) { S.modes = []; S.modesLabel = ''; S.modesSource = ''; }
  const { nu, power } = parsed;
  const d = new Float64Array(nu.length - 1);
  for (let i = 0; i < d.length; i++) d[i] = nu[i + 1] - nu[i];
  S.spec = { label, kind: '', source: 'user', nu, raw: power, dnuBin: C.median(d), columns: parsed.columns };
  S.example = null;
  if (wasExample || !S.modes.length) {
    const numax = S.modes.length ? C.median(S.modes.map(m => m.fc)) : 0.5 * (nu[0] + nu[nu.length - 1]);
    resetParams(numax, dnuScaling(numax));
    S.notice = 'Set ν_max and Δν for your star: the starting values are guesses (ν_max from the middle of the file, Δν from the scaling relation).';
  } else S.notice = '';
  afterUserData();
}
function useModes(label, parsed) {
  const wasExample = S.example !== null;
  S.modes = parsed.modes; S.modesLabel = label; S.modesSource = 'user';
  if (wasExample) {                        // the example spectrum belongs to another star
    S.spec = null; S.example = null;
    const numax = C.median(S.modes.map(m => m.fc));
    resetParams(numax, dnuScaling(numax));
    S.notice = 'Set ν_max and Δν for your star: the starting values are guesses from the mode list and the scaling relation.';
  } else S.notice = '';
  if (!parsed.hasDegree) S.notice = (S.notice + ' No degree column was found, so every mode is drawn as ℓ = 1.').trim();
  afterUserData();
}
function afterUserData() {
  $('#ex-select').value = '__user';
  history.replaceState(null, '', location.pathname);
  resmooth(); syncControls(); updateStatus(); schedule();
}

async function readFile(input, handler, parser) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 200e6) { setStatus([['That file is larger than 200 MB; trim it to the oscillation range first.', 'error']]); return; }
  setStatus([[`Reading ${file.name}…`]]);
  try { handler(file.name, parser(await file.text())); }
  catch (err) { setStatus([[`Could not read ${file.name}: ${err.message}.`, 'error']]); }
}

// ---------- status line ----------
function setStatus(parts) {
  const el = $('#ech-status');
  el.replaceChildren();
  for (const [text, kind] of parts) {
    if (kind === 'strong') { const b = document.createElement('strong'); b.textContent = text; el.append(b); }
    else if (kind === 'error') { const s = document.createElement('span'); s.className = 'ech-error'; s.textContent = text; el.append(s); }
    else if (kind === 'clear-spec' || kind === 'clear-modes') {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ech-link'; b.textContent = text;
      b.addEventListener('click', () => {
        if (kind === 'clear-spec') S.spec = null; else { S.modes = []; S.modesLabel = ''; S.modesSource = ''; }
        S.version++; updateStatus(); schedule();
      });
      el.append(b);
    } else if (kind === 'code') { const c = document.createElement('code'); c.textContent = text; el.append(c); }
    else el.append(text);
  }
}
function updateStatus() {
  const parts = [];
  const fmt = v => v.toLocaleString('en', { maximumFractionDigits: 1 });
  if (S.spec) {
    const n = S.spec.nu.length;
    parts.push(['Spectrum: '], [S.spec.label, 'strong'],
      [S.spec.source === 'example' ? ` (${S.spec.kind}, Kepler S/B)` : ` (${S.spec.columns.join(' vs ')})`],
      [`, ${n.toLocaleString('en')} points, ${fmt(S.spec.nu[0])}–${fmt(S.spec.nu[n - 1])} μHz`]);
    if (S.spec.source === 'user') parts.push([' · '], ['remove', 'clear-spec']);
    parts.push(['. ']);
  } else parts.push(['No power spectrum. ']);
  if (S.modes.length) {
    const counts = [0, 1, 2, 3].map(l => S.modes.filter(m => m.l === l).length);
    parts.push(['Modes: '], [String(S.modes.length), 'strong'],
      [` (${counts.map((c, l) => (c ? `ℓ=${l}: ${c}` : '')).filter(Boolean).join(', ')})`]);
    if (S.modesSource === 'user') parts.push([` from ${S.modesLabel} · `], ['remove', 'clear-modes']);
    parts.push(['.']);
  } else parts.push(['No mode list.']);
  if (S.notice) parts.push([' ' + S.notice]);
  if (!S.spec && !S.modes.length) parts.push([' Load a power spectrum or a list of mode frequencies, or pick an example.']);
  setStatus(parts);
}

// ---------- theme ----------
let T = {}, themeId = 0;
function toRGB(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color; c.fillRect(0, 0, 1, 1);
  return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
}
function readTheme() {
  const cs = getComputedStyle($('.ech')), v = n => cs.getPropertyValue(n).trim();
  T = {
    l: [v('--l0'), v('--l1'), v('--l2'), v('--fg')],
    card: v('--card'), fg: v('--fg'), muted: v('--muted'), grid: v('--border'), axis: v('--rule'),
    font: getComputedStyle(document.body).fontFamily,
  };
  T.cardRGB = toRGB(T.card); T.inkRGB = toRGB(T.fg);
  themeId++;
}

// ---------- panels ----------
class Panel {
  constructor(canvas, m) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.m = m || { l: 54, r: 10, t: 8, b: 40 };
    this.hover = null; this.marks = [];
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
  setScales(x0, x1, y0, y1) {
    const { l, r, t, b } = this.m;
    Object.assign(this, { x0, x1, y0, y1 });
    this.px = v => l + (v - x0) / (x1 - x0) * (this.w - l - r);
    this.py = v => this.h - b - (v - y0) / (y1 - y0) * (this.h - t - b);
    this.ix = p => x0 + (p - l) / (this.w - l - r) * (x1 - x0);
    this.iy = p => y0 + (this.h - b - p) / (this.h - t - b) * (y1 - y0);
  }
  inPlot(x, y) { const { l, r, t, b } = this.m; return x >= l && x <= this.w - r && y >= t && y <= this.h - b; }
  clip(fn) {
    const { l, r, t, b } = this.m, g = this.ctx;
    g.save(); g.beginPath(); g.rect(l, t, this.w - l - r, this.h - t - b); g.clip(); fn(g); g.restore();
  }
  axes(xt, yt, xlabel, ylabel, { gridX = true, gridY = false } = {}) {
    const g = this.ctx, { l, r, t, b } = this.m, W = this.w, H = this.h;
    g.lineWidth = 1; g.strokeStyle = T.grid; g.beginPath();
    if (gridX) for (const v of xt) { const x = Math.round(this.px(v.v)) + 0.5; g.moveTo(x, t); g.lineTo(x, H - b); }
    if (gridY) for (const v of yt) { const y = Math.round(this.py(v.v)) + 0.5; g.moveTo(l, y); g.lineTo(W - r, y); }
    g.stroke();
    g.strokeStyle = T.axis; g.beginPath(); g.moveTo(l, H - b + 0.5); g.lineTo(W - r, H - b + 0.5); g.moveTo(l - 0.5, t); g.lineTo(l - 0.5, H - b); g.stroke();
    g.fillStyle = T.muted; g.font = `12px ${T.font}`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const v of xt) g.fillText(v.s, this.px(v.v), H - b + 5);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of yt) g.fillText(v.s, l - 6, this.py(v.v));
    g.textBaseline = 'alphabetic'; richText(g, xlabel, l + (W - l - r) / 2, H - 6, 12.5, 'center');
    g.save(); g.translate(13, t + (H - t - b) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle';
    richText(g, ylabel, 0, 0, 12.5, 'center'); g.restore();
  }
  message(text) {
    const g = this.ctx; g.fillStyle = T.muted; g.font = `14px ${T.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, this.w / 2, this.h / 2);
  }
}
function richText(g, str, x, y, size, align) {
  const parts = [], re = /_([A-Za-z0-9]+)/g; let last = 0, m;
  while ((m = re.exec(str))) { if (m.index > last) parts.push([str.slice(last, m.index), 0]); parts.push([m[1], 1]); last = re.lastIndex; }
  if (last < str.length) parts.push([str.slice(last), 0]);
  const big = `${size}px ${T.font}`, small = `${Math.round(size * 0.74)}px ${T.font}`;
  let w = 0; for (const [s, sub] of parts) { g.font = sub ? small : big; w += g.measureText(s).width; }
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.textAlign = 'left';
  for (const [s, sub] of parts) { g.font = sub ? small : big; g.fillText(s, cx, sub ? y + size * 0.28 : y); cx += g.measureText(s).width; }
}
function niceTicks(lo, hi, target) {
  const raw = (hi - lo) / target, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9 * st; v += st) out.push(+v.toFixed(10));
  return out;
}
const fmtNum = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1).replace(/\.0$/, '') : String(+v.toFixed(2)));

function marker(g, l, x, y, color) {
  const r = 5.5;
  g.beginPath();
  if (l === 0) g.arc(x, y, r, 0, 2 * Math.PI);
  else if (l === 1) { g.moveTo(x, y - r * 1.1); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
  else if (l === 2) g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else { g.moveTo(x, y - r * 1.1); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.1); g.lineTo(x - r, y); g.closePath(); }
  g.lineJoin = 'round';
  g.lineWidth = 4; g.strokeStyle = T.card; g.stroke();      // surface halo keeps marks legible on the image
  g.lineWidth = 2; g.strokeStyle = color; g.stroke();
}

// ---------- computation with caching ----------
const cache = { win: { key: null }, freq: {}, period: {}, stretchf: {} };
function windowData() {
  const p = S.p, fmin = S.numax - S.v.half * p.dnu, fmax = S.numax + (S.v.half + 1) * p.dnu;
  const key = [S.version, fmin, fmax, S.spec ? 1 : 0, S.modes.length].join('|');
  if (cache.win.key === key) return cache.win;
  let nu, ps, synthetic = false;
  if (S.spec) {
    const a0 = C.searchsorted(S.spec.nu, fmin);
    const a = a0 < S.spec.nu.length && S.spec.nu[a0] === fmin ? a0 + 1 : a0;
    const b = C.searchsorted(S.spec.nu, fmax);
    nu = S.spec.nu.subarray(a, b); ps = S.spec.smooth.subarray(a, b);
  } else if (S.modes.length) {             // no spectrum: fold an empty grid so rows are defined the same way
    const step = p.dnu / 2000, lo = Math.max(fmin, 1e-3), n = Math.max(0, Math.floor((fmax - lo) / step));
    nu = new Float64Array(n); for (let i = 0; i < n; i++) nu[i] = lo + (i + 0.5) * step;
    ps = new Float64Array(n); synthetic = true;
  } else { nu = new Float64Array(0); ps = nu; }
  cache.win = { key, nu, ps, synthetic, fmin, fmax };
  return cache.win;
}
function getFold(name, W) {
  const p = S.p, rep = S.v.rep, pr = P();
  const spec = {
    freq: [[p.dnu], () => C.fold(W.nu, W.ps, W.nu, p.dnu, 'freq', rep)],
    period: [[p.dnu, p.eps_p, p.d01, p.dpi1, p.q, p.q_k, p.alpha_p, S.numax], () => C.fold(W.nu, W.ps, C.makeTau(W.nu, pr), p.dpi1, 'period', rep)],
    stretchf: [[p.dnu, p.dpi1, p.q, p.q_k, p.eps_g, S.numax], () => C.fold(W.nu, W.ps, C.makeF(W.nu, pr), p.dnu, 'freq', rep)],
  }[name];
  const key = [W.key, rep, ...spec[0]].join('|'), c = cache[name];
  if (c.key !== key) { c.key = key; c.F = spec[1](); c.img = null; }
  if (c.F && !W.synthetic && (!c.img || c.imgKey !== `${S.v.clip}|${themeId}`)) {
    c.img = buildImage(c.F, S.v.clip); c.imgKey = `${S.v.clip}|${themeId}`;
  }
  return c;
}
function buildImage(F, clip) {
  const vmax = C.percentile(F.z, clip) || 1;              // vmin = 0, as clickelle
  const pool = Math.max(1, Math.ceil(F.nCols / 2048));     // max-pool very wide folds for display
  const w = Math.ceil(F.nCols / pool), h = F.nStack;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), im = g.createImageData(w, h), D = im.data;
  const [br, bg, bb] = T.cardRGB, [fr, fg, fb] = T.inkRGB;
  for (let r = 0; r < h; r++) {
    const row = F.nStack - 1 - r, off = row * F.nCols;
    for (let c = 0; c < w; c++) {
      let m = 0;
      for (let k = c * pool, e = Math.min((c + 1) * pool, F.nCols); k < e; k++) if (F.z[off + k] > m) m = F.z[off + k];
      const t = Math.min(1, m / vmax), o = 4 * (r * w + c);
      D[o] = br + (fr - br) * t; D[o + 1] = bg + (fg - bg) * t; D[o + 2] = bb + (fb - bb) * t; D[o + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return cv;
}
function modeX(name, fc) {
  if (name === 'freq') return fc;
  return name === 'period' ? C.makeTau(Float64Array.of(fc), P())[0] : C.makeF(Float64Array.of(fc), P())[0];
}

// ---------- drawing ----------
const panels = {};
const LABELS = {
  freq: ['ν mod Δν [μHz]', 'dnu'], period: ['τ mod ΔΠ_1 [s]', 'dpi1'], stretchf: ['f mod Δν [μHz]', 'dnu'],
};
function guideX(name) {
  const p = S.p;
  if (name === 'freq') return [C.pmod(p.eps_p, 1) * p.dnu, 0];
  if (name === 'period') return [C.pmod(p.eps_g, 1) * p.dpi1, 1];
  return [C.pmod(p.eps_p + 0.5 + p.d01, 1) * p.dnu, 1];
}
function drawEchelle(name) {
  const Pn = panels[name], W = windowData();
  Pn.resize(); Pn.marks = [];
  const c = getFold(name, W), F = c.F;
  if (!F) { Pn.message(W.nu.length ? 'Too few points in this window' : S.spec || S.modes.length ? 'No data in this window' : 'Load data or pick an example'); return; }
  const period = F.P, xAxis = (F.replicated ? 2 : 1) * period;
  Pn.setScales(0, xAxis, 0, F.nStack);
  const step = Math.max(1, Math.ceil(F.nStack / 9));
  const yt = [];
  for (let r = 0; r < F.nStack; r += step) yt.push({ v: r + 0.5, s: fmtNum(F.rowNu[r]) });
  Pn.axes(niceTicks(0, xAxis, 5).map(v => ({ v, s: fmtNum(v) })), yt, LABELS[name][0], 'Frequency [μHz]');
  Pn.clip(g => {
    if (c.img && S.v.image) {
      g.imageSmoothingEnabled = false;
      g.drawImage(c.img, Pn.px(0), Pn.py(F.nStack), Pn.px(F.xMax) - Pn.px(0), Pn.py(0) - Pn.py(F.nStack));
    }
    if (F.replicated) {
      const X = Math.round(Pn.px(period)) + 0.5;
      g.strokeStyle = T.axis; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Pn.m.t); g.lineTo(X, Pn.h - Pn.m.b); g.stroke();
    }
    if (S.v.guides) {
      const [x, l] = guideX(name);
      g.save(); g.setLineDash([5, 4]); g.lineWidth = 1.6; g.strokeStyle = T.l[l];
      for (const xx of F.replicated ? [x, x + period] : [x]) { const X = Pn.px(xx); g.beginPath(); g.moveTo(X, Pn.m.t); g.lineTo(X, Pn.h - Pn.m.b); g.stroke(); }
      g.restore();
    }
    if (S.v.marks) for (const m of S.modes) {
      for (const pl of C.placeMode(F, m.fc, modeX(name, m.fc))) {
        const X = Pn.px(pl.x), Y = Pn.py(pl.row + 0.5);
        marker(g, m.l, X, Y, T.l[m.l]);
        Pn.marks.push({ X, Y, m });
      }
    }
    if (Pn.hover) {
      g.save(); g.strokeStyle = T.fg; g.globalAlpha = 0.45; g.lineWidth = 1; g.beginPath();
      g.moveTo(Pn.hover.X + 0.5, Pn.m.t); g.lineTo(Pn.hover.X + 0.5, Pn.h - Pn.m.b);
      g.moveTo(Pn.m.l, Pn.hover.Y + 0.5); g.lineTo(Pn.w - Pn.m.r, Pn.hover.Y + 0.5); g.stroke(); g.restore();
      if (Pn.hover.mark) { g.beginPath(); g.arc(Pn.hover.mark.X, Pn.hover.mark.Y, 9, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = T.fg; g.stroke(); }
    }
  });
  const lbl = name === 'period' ? `ΔΠ1 = ${S.p.dpi1.toFixed(2)} s, q = ${S.p.q.toFixed(3)}` : `Δν = ${S.p.dnu.toFixed(3)} μHz`;
  Pn.c.setAttribute('aria-label', `${Pn.c.dataset.title}: ${F.nStack} rows, ${lbl}`);
}

function drawSpectrum() {
  const Pn = panels.spec, W = windowData();
  Pn.resize();
  if (!W.nu.length) { Pn.message(S.spec ? 'No data in this window' : 'No power spectrum loaded'); return; }
  const x0 = W.nu[0], x1 = W.nu[W.nu.length - 1];
  let ymax = 0;
  if (!W.synthetic) for (const v of W.ps) if (v > ymax) ymax = v;
  ymax = ymax > 0 ? ymax * 1.06 : 1;
  Pn.setScales(x0, x1, 0, ymax);
  const xt = niceTicks(x0, x1, 8).map(v => ({ v, s: fmtNum(v) }));
  const yt = W.synthetic ? [] : niceTicks(0, ymax, 3).map(v => ({ v, s: fmtNum(v) }));
  Pn.axes(xt, yt, 'Frequency [μHz]', W.synthetic ? '' : 'Power');
  Pn.clip(g => {
    if (S.v.marks) for (const m of S.modes) {
      if (m.fc < x0 || m.fc > x1) continue;
      const X = Math.round(Pn.px(m.fc)) + 0.5;
      g.strokeStyle = T.l[m.l]; g.globalAlpha = 0.75; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(X, Pn.m.t); g.lineTo(X, Pn.h - Pn.m.b); g.stroke(); g.globalAlpha = 1;
    }
    const X = Pn.px(S.numax);
    g.save(); g.setLineDash([5, 4]); g.strokeStyle = T.muted; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X, Pn.m.t); g.lineTo(X, Pn.h - Pn.m.b); g.stroke(); g.restore();
    if (!W.synthetic) {                      // min/max envelope per pixel column
      g.strokeStyle = T.fg; g.lineWidth = 1; g.beginPath();
      const cols = Math.ceil(Pn.w), per = W.nu.length / Math.max(1, Pn.px(x1) - Pn.px(x0));
      if (per <= 2) {
        for (let i = 0; i < W.nu.length; i++) { const px = Pn.px(W.nu[i]), py = Pn.py(W.ps[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); }
      } else {
        let i = 0;
        for (let c = Math.floor(Pn.px(x0)); c <= cols && i < W.nu.length; c++) {
          let lo = Infinity, hi = -Infinity;
          while (i < W.nu.length && Pn.px(W.nu[i]) < c + 1) { const v = W.ps[i]; if (v < lo) lo = v; if (v > hi) hi = v; i++; }
          if (hi === -Infinity) continue;
          g.moveTo(c + 0.5, Pn.py(lo)); g.lineTo(c + 0.5, Pn.py(hi) - 0.01);
        }
      }
      g.stroke();
    } else Pn.message('No power spectrum loaded: only the mode frequencies are shown');
    if (Pn.hover) {
      g.save(); g.strokeStyle = T.fg; g.globalAlpha = 0.45; g.beginPath(); g.moveTo(Pn.hover.X + 0.5, Pn.m.t); g.lineTo(Pn.hover.X + 0.5, Pn.h - Pn.m.b); g.stroke(); g.restore();
    }
  });
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  for (const name of ['freq', 'period', 'stretchf']) drawEchelle(name);
  drawSpectrum();
  if ($('#ech-table').open) fillTable();
}

// ---------- hover ----------
const tip = $('#ech-tip');
function showTip(e, rows) {
  tip.replaceChildren();
  for (const [value, label] of rows) {
    const row = document.createElement('div');
    const b = document.createElement('strong'); b.append(rich(value)); row.append(b);
    if (label) { const s = document.createElement('span'); s.append(' ', rich(label)); row.append(s); }
    tip.append(row);
  }
  tip.hidden = false;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
const hideTip = () => { tip.hidden = true; };
function wireEchelleHover(name) {
  const Pn = panels[name];
  Pn.c.addEventListener('pointermove', e => {
    const r = Pn.c.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
    const F = cache[name].F;
    if (!F || !Pn.inPlot(X, Y)) { if (Pn.hover) { Pn.hover = null; drawEchelle(name); } hideTip(); return; }
    let mark = null, bd = 14 * 14;
    for (const k of Pn.marks) { const d = (k.X - X) ** 2 + (k.Y - Y) ** 2; if (d < bd) { bd = d; mark = k; } }
    Pn.hover = { X: Math.round(X), Y: Math.round(Y), mark };
    drawEchelle(name);
    const nu = C.decode(F, Pn.ix(X), Pn.iy(Y));
    const rows = [];
    if (mark) rows.push([`${mark.m.fc.toFixed(3)} μHz`, `mode, ℓ = ${mark.m.l}`]);
    if (nu != null) rows.push([`${nu.toFixed(3)} μHz`, 'frequency under the pointer']);
    const xv = Pn.ix(X);
    rows.push([`${xv.toFixed(name === 'period' ? 1 : 2)} ${name === 'period' ? 's' : 'μHz'}`, LABELS[name][0].replace(/ \[.*\]/, '')]);
    showTip(e, rows);
  });
  Pn.c.addEventListener('pointerleave', () => { Pn.hover = null; drawEchelle(name); hideTip(); });
}
function wireSpectrumHover() {
  const Pn = panels.spec;
  Pn.c.addEventListener('pointermove', e => {
    const r = Pn.c.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top, W = windowData();
    if (!W.nu.length || !Pn.inPlot(X, Y)) { if (Pn.hover) { Pn.hover = null; drawSpectrum(); } hideTip(); return; }
    Pn.hover = { X: Math.round(X) }; drawSpectrum();
    const nu = Pn.ix(X), i = Math.min(W.nu.length - 1, C.searchsorted(W.nu, nu));
    const rows = [[`${nu.toFixed(3)} μHz`, 'frequency']];
    if (!W.synthetic) rows.push([W.ps[i].toPrecision(3), 'smoothed power']);
    const near = S.modes.filter(m => Math.abs(Pn.px(m.fc) - X) < 5);
    for (const m of near.slice(0, 3)) rows.push([`${m.fc.toFixed(3)} μHz`, `mode, ℓ = ${m.l}`]);
    showTip(e, rows);
  });
  Pn.c.addEventListener('pointerleave', () => { Pn.hover = null; drawSpectrum(); hideTip(); });
}

// ---------- table ----------
function fillTable() {
  const body = $('#ech-table tbody'), p = S.p, pr = P();
  const ms = [...S.modes].sort((a, b) => a.fc - b.fc);
  const nu = Float64Array.from(ms, m => m.fc), tau = C.makeTau(nu, pr), f = C.makeF(nu, pr);
  body.replaceChildren(...ms.map((m, i) => {
    const tr = document.createElement('tr');
    for (const s of [String(m.l), m.fc.toFixed(3), C.pmod(m.fc, p.dnu).toFixed(3), C.pmod(tau[i], p.dpi1).toFixed(2), C.pmod(f[i], p.dnu).toFixed(3)]) {
      const td = document.createElement('td'); td.textContent = s; tr.append(td);
    }
    return tr;
  }));
  if (!ms.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No modes loaded.'; tr.append(td); body.append(tr); }
}

// ---------- sharing ----------
let hashTimer = 0;
const HASH_KEYS = ['numax', 'dnu', 'eps_p', 'd01', 'dpi1', 'q', 'eps_g', 'q_k', 'alpha_p', 'half', 'smooth', 'clip'];
function scheduleHash() {
  if (!S.example) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams({ ex: S.example });
    for (const k of HASH_KEYS) q.set(k, String(+get(k).toPrecision(7)));
    if (!S.v.rep) q.set('rep', '0');
    history.replaceState(null, '', `#${q}`);
  }, 300);
}
function applyHash(q) {
  for (const k of HASH_KEYS) if (q.has(k) && Number.isFinite(+q.get(k))) set(k, +q.get(k));
  if (q.get('rep') === '0') S.v.rep = false;
  S.dnuRef = S.p.dnu; S.numaxRef = S.numax;
}
function copyParams() {
  const p = S.p, r = v => +v.toPrecision(6);
  const text = `p = st.AttrDict({'ΔΠ1': ${r(p.dpi1)}, 'q': ${r(p.q)}, 'q_k': ${r(p.q_k)}, 'Δν': ${r(p.dnu)}, 'ε_p': ${r(p.eps_p)}, ` +
    `'ε_g': ${r(p.eps_g)}, 'd01': ${r(p.d01)}, 'α_p': ${r(p.alpha_p)}, 'ν_max': ${r(S.numax)}})`;
  const done = ok => { updateStatus(); const el = $('#ech-status'); el.append(' ', ok ? 'Copied as a Python AttrDict: ' : 'Copy this line: '); const c = document.createElement('code'); c.textContent = text; el.append(c); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  else done(false);
}

// ---------- init ----------
function init() {
  readTheme();
  buildControls();
  for (const [name, title] of [['freq', 'Frequency échelle'], ['period', 'Stretched period échelle'], ['stretchf', 'Stretched frequency échelle']]) {
    const cv = $(`#c-${name}`); cv.dataset.title = title;
    panels[name] = new Panel(cv); wireEchelleHover(name);
  }
  panels.spec = new Panel($('#c-spec'), { l: 54, r: 10, t: 8, b: 38 });
  wireSpectrumHover();

  $('#ex-select').addEventListener('change', e => { if (EXAMPLES[e.target.value]) loadExample(e.target.value); });
  $('#file-spec').addEventListener('change', e => readFile(e.target, useSpectrum, C.parseSpectrum));
  $('#file-modes').addEventListener('change', e => readFile(e.target, useModes, t => C.parseModes(t)));
  $('#btn-paste').addEventListener('click', () => {
    const box = $('#paste-box'); box.hidden = !box.hidden;
    $('#btn-paste').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('#paste-text').focus();
  });
  $('#btn-paste-use').addEventListener('click', () => {
    try { useModes('pasted list', C.parseModes($('#paste-text').value)); }
    catch (err) { setStatus([[`Could not read the pasted frequencies: ${err.message}.`, 'error']]); }
  });
  $('#btn-copy').addEventListener('click', copyParams);
  $('#ech-table').addEventListener('toggle', () => { if ($('#ech-table').open) fillTable(); });

  new ResizeObserver(() => schedule()).observe($('.ech-grid'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); schedule(); });

  const q = new URLSearchParams(location.hash.slice(1));
  const ex = EXAMPLES[q.get('ex')] ? q.get('ex') : 'KIC10272858';
  loadExample(ex, q.get('ex') ? q : null);
}
S.numaxRef = S.numax;
init();
