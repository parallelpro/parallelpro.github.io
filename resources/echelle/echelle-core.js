// Echelle core: a line-by-line port of the stretched-echelle code and
// clickelle's echelle.py / asymptotic.py, plus clickelle's stack-index marker
// bookkeeping. Pure functions, no DOM, so they can be tested against Python.

export const pmod = (a, b) => ((a % b) + b) % b;          // Python's float %

// ---------- asymptotic mixed-mode relations (Mosser et al. 2015 formalism) ----------
// Same defaults as stretching.interact_echelle: q and eps_p may vary with
// frequency (q_k, alpha_p about numax); d01 is constant.
export const epsP = (nu, p) => p.alpha_p * ((nu - p.numax) / p.dnu) ** 2 + p.eps_p;
export const qOf = (nu, p) => p.q_k * (nu - p.numax) + p.q;

export function makeF(nu, p) {                 // stretched frequency [uHz]
  const out = new Float64Array(nu.length);
  for (let i = 0; i < nu.length; i++) {
    const v = nu[i], thg = Math.PI * (p.eps_g - 1 / (v * 1e-6) / p.dpi1);
    out[i] = v - p.dnu / Math.PI * Math.atan(qOf(v, p) / Math.tan(thg));
  }
  return out;
}
export function makeTau(nu, p) {               // stretched period [s]
  const out = new Float64Array(nu.length);
  for (let i = 0; i < nu.length; i++) {
    const v = nu[i], thp = Math.PI * (v / p.dnu - (0.5 + epsP(v, p) + p.d01));
    out[i] = 1 / (v * 1e-6) + p.dpi1 / Math.PI * Math.atan(qOf(v, p) / Math.tan(thp));
  }
  return out;
}

// ---------- numpy helpers ----------
export function median(a) {
  const s = Float64Array.from(a).sort(), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}
export function percentile(a, q, maxSamples = 40000) {   // np.nanpercentile, linear
  const step = Math.max(1, Math.floor(a.length / maxSamples));
  const s = [];
  for (let i = 0; i < a.length; i += step) if (Number.isFinite(a[i])) s.push(a[i]);
  if (!s.length) return NaN;
  const t = Float64Array.from(s).sort(), r = (q / 100) * (t.length - 1), lo = Math.floor(r);
  return lo + 1 < t.length ? t[lo] + (r - lo) * (t[lo + 1] - t[lo]) : t[lo];
}
export function searchsorted(a, v) {           // side='left'
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
// np.convolve(power, ones(n)/n, mode='same'), as clickelle.utils.smooth
export function smoothBoxcar(power, nBins) {
  const n = Math.max(Math.floor(nBins), 1), N = power.length;
  if (n === 1) return Float64Array.from(power);
  const c = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) c[i + 1] = c[i] + power[i];
  const right = Math.floor((n - 1) / 2), left = n - 1 - right, out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - left), b = Math.min(N - 1, i + right);
    out[i] = (c[b + 1] - c[a]) / n;
  }
  return out;
}
// np.interp(base, xp, fp, period=P) for an ascending base
function interpPeriodic(base, nBase, xp, fp, lo, hi, P, out, offset) {
  const n = hi - lo;
  const ord = new Array(n), xm = new Float64Array(n);
  for (let k = 0; k < n; k++) { ord[k] = k; xm[k] = pmod(xp[lo + k], P); }
  ord.sort((a, b) => xm[a] - xm[b]);
  const X = new Float64Array(n + 2), F = new Float64Array(n + 2);
  X[0] = xm[ord[n - 1]] - P; F[0] = fp[lo + ord[n - 1]];
  for (let k = 0; k < n; k++) { X[k + 1] = xm[ord[k]]; F[k + 1] = fp[lo + ord[k]]; }
  X[n + 1] = xm[ord[0]] + P; F[n + 1] = fp[lo + ord[0]];
  let j = 0;
  for (let i = 0; i < nBase; i++) {
    const b = base[i];
    while (j < n && X[j + 1] <= b) j++;
    const dx = X[j + 1] - X[j];
    out[offset + i] = dx > 0 ? F[j] + (b - X[j]) * (F[j + 1] - F[j]) / dx : F[j];
  }
}

// ---------- the fold (make_fold + frequency_echelle / period_echelle) ----------
// kind 'freq': x = nu or stretched f, wraps where diff(x % P) < 0, reverse=False
// kind 'period': x = tau, wraps where diff(x % P) > 0, reverse=True
// nu, ps, x are already windowed. Rows are stored bottom (stack 0) to top.
export function fold(nu, ps, x, P, kind, replicated) {
  const N = nu.length;
  if (N < 4) return null;
  const xm = new Float64Array(N);
  for (let i = 0; i < N; i++) xm[i] = pmod(x[i], P);
  const wrap = new Uint8Array(N - 1);
  const idxSet = [0];
  for (let i = 0; i < N - 1; i++) {
    const d = xm[i + 1] - xm[i];
    if (kind === 'freq' ? d < 0 : d > 0) { wrap[i] = 1; idxSet.push(i); }
  }
  idxSet.push(N - 2);
  const idx = [...new Set(idxSet)].sort((a, b) => a - b);      // np.unique
  const nStack = idx.length - 1;

  let res;
  if (kind === 'freq') {
    const d = new Float64Array(N - 1);
    for (let i = 0; i < N - 1; i++) d[i] = Math.abs(nu[i + 1] - nu[i]);
    res = median(d);
  } else {
    const d = new Float64Array(N - 1);
    for (let i = 0; i < N - 1; i++) d[i] = Math.abs(1 / (nu[i + 1] * 1e-6) - 1 / (nu[i] * 1e-6));
    res = median(d);
  }
  const nEl = Math.ceil(P / res);
  const nCols = replicated ? 2 * nEl : nEl;
  const base = new Float64Array(nEl);
  for (let i = 0; i < nEl; i++) base[i] = i * P / nEl;   // linspace(0, P, nEl, endpoint=False)
  const z = new Float32Array(nStack * nCols);            // row r = stack r (bottom first)
  const tmp = new Float64Array(nEl);
  for (let s = 0; s < nStack; s++) {
    if (!replicated) {
      interpPeriodic(base, nEl, x, ps, idx[s], idx[s + 1], P, tmp, 0);
      z.set(tmp, s * nCols);
    } else if (s < nStack - 1) {
      const [left, right] = kind === 'period' ? [s + 1, s] : [s, s + 1];
      interpPeriodic(base, nEl, x, ps, idx[left], idx[left + 1], P, tmp, 0); z.set(tmp, s * nCols);
      interpPeriodic(base, nEl, x, ps, idx[right], idx[right + 1], P, tmp, 0); z.set(tmp, s * nCols + nEl);
    }
  }
  // prefix count of wraps: stack of array element i = W[i] (clickelle)
  const W = new Int32Array(N);
  for (let i = 1; i < N; i++) W[i] = W[i - 1] + wrap[i - 1];
  // stack boundaries for decoding clicks/hover (clickelle on_click_tau)
  const bounds = [0];
  for (let i = 0; i < N - 1; i++) if (wrap[i]) bounds.push(i + 1);
  bounds.push(N);
  // median frequency of each stack, for truthful y labels (as plot_with='contour')
  const rowNu = new Float64Array(nStack);
  for (let s = 0; s < nStack; s++) rowNu[s] = median(nu.subarray(idx[s], Math.max(idx[s + 1], idx[s] + 1)));
  return {
    kind, P, replicated, nStack, nEl, nCols, z, xMax: replicated ? 2 * P - P / nEl : P - P / nEl,
    nu, xm, W, bounds, rowNu, numin: nu[0], numax: nu[N - 1],
  };
}

// Where a mode lands: list of {x, row} (row = stack index; draw at row + 0.5).
// Replicated freq: stack s in the left half of row s and right half of row s-1.
// Replicated period (reverse): right half of row s and left half of row s-1.
export function placeMode(F, fc, xMode) {
  if (fc <= F.numin || fc >= F.numax) return [];
  const s = F.W[Math.min(searchsorted(F.nu, fc), F.nu.length - 1)];
  const x = pmod(xMode, F.P), out = [];
  const inRows = r => r >= 0 && r < F.nStack;
  if (!F.replicated) { if (inRows(s)) out.push({ x, row: s }); return out; }
  if (F.kind === 'period') {
    if (inRows(s)) out.push({ x: x + F.P, row: s });
    if (inRows(s - 1)) out.push({ x, row: s - 1 });
  } else {
    if (inRows(s)) out.push({ x, row: s });
    if (inRows(s - 1)) out.push({ x: x + F.P, row: s - 1 });
  }
  return out;
}

// Invert a position on the image back to a frequency: row + half -> stack ->
// the element of that stack whose folded x is closest.
export function decode(F, xData, rowFloat) {
  const row = Math.floor(rowFloat);
  if (row < 0 || row >= F.nStack || xData < 0 || xData > (F.replicated ? 2 : 1) * F.P) return null;
  let s = row;
  if (F.replicated) s = F.kind === 'period' ? (xData < F.P ? row + 1 : row) : (xData < F.P ? row : row + 1);
  if (s < 0 || s >= F.bounds.length - 1) return null;
  const lo = F.bounds[s], hi = F.bounds[s + 1], xt = pmod(xData, F.P);
  if (hi <= lo) return null;
  let best = lo, bd = Infinity;
  for (let i = lo; i < hi; i++) {
    const d = Math.abs(F.xm[i] - xt), dd = Math.min(d, F.P - d);
    if (dd < bd) { bd = dd; best = i; }
  }
  return F.nu[best];
}

// ---------- text table parsing (spectra and mode lists) ----------
const FREQ_NAMES = ['freq_uhz', 'freq', 'frequency', 'nu', 'fc', 'nu0', 'f'];
const POWER_NAMES = ['snr', 'power', 'psd', 'ps', 'sb', 's/b'];
const L_NAMES = ['l', 'ell', 'degree', 'deg'];

export function parseTable(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^[#%!]/.test(s));
  if (!lines.length) throw new Error('the file is empty');
  const delim = /\s*[,;\t]\s*|\s+/;          // any mix of commas, semicolons, tabs and spaces
  const first = lines[0].split(delim);
  const hasHeader = first.some(t => t !== '' && !Number.isFinite(Number(t)));
  const header = hasHeader ? first.map(t => t.replace(/^["']|["']$/g, '').trim().toLowerCase()) : null;
  const rows = [];
  for (let k = hasHeader ? 1 : 0; k < lines.length; k++) rows.push(lines[k].split(delim).map(Number));
  return { header, rows, nCols: Math.max(...rows.slice(0, 50).map(r => r.length)) };
}
const findCol = (header, names) => header ? header.findIndex(h => names.includes(h)) : -1;

export function parseSpectrum(text) {
  const t = parseTable(text);
  if (t.nCols < 2) throw new Error('a power spectrum needs two columns: frequency and power');
  let fi = findCol(t.header, FREQ_NAMES), pi = findCol(t.header, POWER_NAMES);
  if (fi < 0) fi = 0;
  if (pi < 0) pi = fi === 0 ? 1 : 0;
  const pairs = [];
  for (const r of t.rows) { const f = r[fi], p = r[pi]; if (Number.isFinite(f) && Number.isFinite(p)) pairs.push([f, p]); }
  if (pairs.length < 10) throw new Error('found fewer than 10 numeric rows');
  pairs.sort((a, b) => a[0] - b[0]);
  return { nu: Float64Array.from(pairs, p => p[0]), power: Float64Array.from(pairs, p => p[1]),
           columns: t.header ? [t.header[fi], t.header[pi]] : [`column ${fi + 1}`, `column ${pi + 1}`] };
}

export function parseModes(text, defaultL = 1) {
  const t = parseTable(text);
  let fi = findCol(t.header, FREQ_NAMES), li = findCol(t.header, L_NAMES);
  if (!t.header && t.nCols >= 2) {
    // no header: the column made of small integers 0-3 is the degree
    const isDeg = c => t.rows.every(r => Number.isInteger(r[c]) && r[c] >= 0 && r[c] <= 3);
    li = isDeg(1) ? 1 : isDeg(0) ? 0 : -1;
    fi = li === 0 ? 1 : 0;
  }
  if (fi < 0) fi = li === 0 ? 1 : 0;
  const modes = [];
  for (const r of t.rows) {
    const fc = r[fi], l = li >= 0 ? r[li] : defaultL;
    if (Number.isFinite(fc) && fc > 0 && [0, 1, 2, 3].includes(l)) modes.push({ fc, l });
  }
  if (!modes.length) throw new Error('no usable mode frequencies found');
  return { modes, hasDegree: li >= 0 };
}
