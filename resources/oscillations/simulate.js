/* Simulated observations for the oscillation explorer: a stochastically excited light curve and
   its power spectrum for one stellar model. Classic script; exposes window.OscSim (pure functions,
   no DOM), so it can be checked against a Python reimplementation.

   Ingredients (all illustrative scaling relations, not fits to a particular star):
   - envelope: Gaussian at numax, sigma = exp(0.9638 ln numax - 1.7145), as the mode scan used;
   - radial amplitude: A0 = 2.5 ppm (numax/3090 uHz)^-0.991, a power law through the Sun and the median
     Kepler red giant at numax = 200 uHz (37.7 ppm, Yu et al. 2018);
   - visibilities V^2 = 1, 1.54, 0.63 for l = 0, 1, 2 (Mosser et al. 2012);
   - radial linewidth: Gamma0 = 1 uHz (Teff/5777 K)^10.8, through the Sun (~1 uHz) and red giants
     (~0.12 uHz at 4750 K, Vrard et al. 2018);
   - mixed modes: Gamma = Gamma0/r and A^2 = A0^2 V^2 env / r for inertia ratio r = E/E_l0, which
     keeps the height of resolved modes (Grosjean et al. 2014);
   - background: the two granulation super-Lorentzians of Kallinger et al. (2014), plus a third, slower
     Harvey profile (exponent 2) scaled from the Sun: a ~8000 s timescale (b = 19.9 uHz) and a plateau
     ~10x the granulation plateau, as in the solar irradiance spectrum (Aigrain et al. 2004), scaling
     with numax like the granulation; flat photon noise.
   PSD convention: one-sided, ppm^2/uHz, integrating to the variance in ppm^2. */
(function (root) {
  'use strict';

  const XI = 2 * Math.SQRT2 / Math.PI;           // normalisation of a super-Lorentzian with exponent 4
  const XI2 = 2 / Math.PI;                       // normalisation of a standard Harvey profile (exponent 2)
  const VIS = [1, 1.54, 0.63];
  const WHITE = 0.1;                             // ppm^2/uHz, a bright Kepler target
  const N = 65536;
  const CADENCE = 60;                            // s: Nyquist 8333 uHz, above every model's hump

  const envSigma = numax => Math.exp(0.9638 * Math.log(numax) - 1.7145);
  const radialAmp = numax => 2.5 * (numax / 3090) ** -0.991;
  const linewidth0 = teff => (teff / 5777) ** 10.8;
  function granulation(f, numax) {
    const a = 3382 * numax ** -0.609, b1 = 0.317 * numax ** 0.970, b2 = 0.948 * numax ** 0.992;
    const x = numax / 3090, a3 = 17.7 * x ** -0.609, b3 = 19.9 * x ** 0.970;   // low-frequency, from the Sun
    return XI * a * a / b1 / (1 + (f / b1) ** 4) + XI * a * a / b2 / (1 + (f / b2) ** 4)
         + XI2 * a3 * a3 / b3 / (1 + (f / b3) ** 2);
  }

  // mulberry32 + Box-Muller: the same seed gives the same realisation every time
  function rng(seed) {
    let s = seed >>> 0, spare = null;
    const u = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let a; do { a = u(); } while (a <= 1e-300);
      const r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * u();
      spare = r * Math.sin(th);
      return r * Math.cos(th);
    };
  }

  // in-place iterative radix-2 FFT; sign = -1 forward, +1 inverse (unnormalised)
  const twiddleCache = new Map();
  function fft(re, im, sign) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    let tw = twiddleCache.get(n);
    if (!tw) {
      tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let k = 0; k < n / 2; k++) { tw.c[k] = Math.cos(2 * Math.PI * k / n); tw.s[k] = Math.sin(2 * Math.PI * k / n); }
      twiddleCache.set(n, tw);
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = tw.c[k * step], wi = sign * tw.s[k * step];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  // Expected (noise-free) one-sided PSD on the bin grid f_k = k df, k = 0..N/2.
  // Each Lorentzian is integrated over its bin, so unresolved modes keep their total power A^2.
  function limitSpectrum(m, df) {
    const nb = N / 2 + 1, P = new Float64Array(nb);
    for (let k = 1; k < nb; k++) P[k] = granulation(k * df, m.numax) + WHITE;
    const sig = envSigma(m.numax), A0sq = radialAmp(m.numax) ** 2, G0 = linewidth0(m.teff);
    for (const mode of m.modes) {
      const r = 10 ** mode.logr, G = G0 / r;
      const A2 = A0sq * VIS[mode.l] * Math.exp(-((mode.nu - m.numax) ** 2) / (2 * sig * sig)) / r;
      const reach = Math.max(200 * G, 8 * df);
      const k0 = Math.max(1, Math.floor((mode.nu - reach) / df)), k1 = Math.min(nb - 1, Math.ceil((mode.nu + reach) / df));
      for (let k = k0; k <= k1; k++) {
        const lo = (k - 0.5) * df - mode.nu, hi = (k + 0.5) * df - mode.nu;
        P[k] += A2 / df / Math.PI * (Math.atan(2 * hi / G) - Math.atan(2 * lo / G));
      }
    }
    return P;
  }

  // m: { numax, teff, modes: [{ nu, l, logr }] }, all frequencies in uHz
  function simulate(m, seed = 20261016, dt = CADENCE) {
    const sig = envSigma(m.numax);
    const df = 1e6 / (N * dt);                            // uHz
    const P = limitSpectrum(m, df);
    const g = rng(seed), re = new Float64Array(N), im = new Float64Array(N);
    const power = new Float64Array(N / 2 + 1);
    let variance = 0;
    for (let k = 1; k < N / 2; k++) {                     // Hermitian spectrum -> real light curve
      const s = Math.sqrt(P[k] * df / 4), a = s * g(), b = s * g();
      re[k] = a; im[k] = b; re[N - k] = a; im[N - k] = -b;
      power[k] = 2 * (a * a + b * b) / df;                // periodogram of this realisation, mean = P[k]
      variance += P[k] * df;
    }
    fft(re, im, +1);
    return { N, dt, df, nyquist: 1e6 / (2 * dt), sigma: sig, A0: radialAmp(m.numax), G0: linewidth0(m.teff),
             limit: P, power, flux: re, rmsExpected: Math.sqrt(variance) };
  }

  root.OscSim = { simulate, limitSpectrum, granulation, envSigma, radialAmp, linewidth0, fft, rng, VIS, WHITE, N, CADENCE };
})(window);
