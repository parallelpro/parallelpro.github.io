"""Export a YREC/GYRE run to the compact JSON used by resources/oscillations/.

Reuses the loaders and estimators from sg-rotation's examine_frequency.py so
the web widget shows exactly what that script plots, then shrinks the data:

  * every curve is simplified with Ramer-Douglas-Peucker in axis-normalised
    units, so only points that move the line by more than ~half a pixel on a
    ~400 px panel survive (spikes in N are kept, flat stretches collapse);
  * numbers are stored as fixed-point integers, delta-encoded along each
    curve, which keeps them short and gzips well.

Usage (with the sg-rotation virtualenv, which has h5py/pandas):
    ../sg-rotation/.venv/bin/python tools/export_oscillation_data.py \
        ../sg-rotation/hpc/run_1p0Msun resources/oscillations/data.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np

# Simplification tolerance as a fraction of each panel's axis span.
TOL = 0.0012
# Fixed-point scales.
S_LOG = 1000      # log quantities -> 0.001 dex
S_TEFF = 10000    # log Teff -> 0.0001 dex (the H-R x-range is narrow)
S_FREQ = 100      # mode frequencies -> 0.01 microHz
S_DIAM = 10       # echelle marker diameter (pt) -> 0.1 pt


def rdp(x, y, tol):
    """Indices kept by Ramer-Douglas-Peucker on already-normalised x, y."""
    n = len(x)
    if n < 3:
        return np.arange(n)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        dx, dy = x[j] - x[i], y[j] - y[i]
        seg = np.hypot(dx, dy)
        xs, ys = x[i + 1:j] - x[i], y[i + 1:j] - y[i]
        d = np.abs(dx * ys - dy * xs) / seg if seg > 0 else np.hypot(xs, ys)
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return np.flatnonzero(keep)


def encode_segments(x, y, xlim, ylim, sx, sy):
    """Split a curve at non-finite points, simplify each finite run, and
    return a list of flat delta-encoded int arrays [x0, y0, dx1, dy1, ...]."""
    ok = np.isfinite(x) & np.isfinite(y)
    xn = (x - xlim[0]) / (xlim[1] - xlim[0])
    yn = (y - ylim[0]) / (ylim[1] - ylim[0])
    out = []
    edges = np.flatnonzero(np.diff(np.concatenate([[0], ok.astype(int), [0]])))
    for a, b in zip(edges[::2], edges[1::2]):
        if b - a < 2:
            continue
        idx = a + rdp(xn[a:b], yn[a:b], TOL)
        xi = np.round(x[idx] * sx).astype(int)
        yi = np.round(y[idx] * sy).astype(int)
        flat = np.empty(2 * len(idx), dtype=int)
        flat[0::2] = np.diff(xi, prepend=0)
        flat[1::2] = np.diff(yi, prepend=0)
        out.append(flat.tolist())
    return out


def delta(values, scale):
    v = np.round(np.asarray(values, dtype=float) * scale).astype(int)
    return np.diff(v, prepend=0).tolist()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("out_json")
    ap.add_argument("--src", help="folder holding examine_frequency.py (default: <run_dir>/../../src)")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).resolve()
    src = Path(args.src).resolve() if args.src else run_dir.parents[1] / "src"
    os.environ.setdefault("MPLBACKEND", "Agg")
    sys.dont_write_bytecode = True   # leave the source repo untouched
    sys.path.insert(0, str(src))
    import pandas as pd
    import examine_frequency as ef

    logs = run_dir / "LOGS" if (run_dir / "LOGS").is_dir() else run_dir
    history = pd.read_csv(ef._find_history_file(logs), sep=r"\s+", skiprows=5)
    hist = history.set_index("model_number")
    freqs = pd.read_csv(ef._find_frequency_table(run_dir))
    by_profile = dict(tuple(freqs.groupby("profile_number")))

    # same profile selection as FrequencyExaminer: GSM on disk AND in the mode table
    profiles = {}
    for path in sorted(logs.glob("profile*.data.GSM")):
        n = int(re.match(r"profile(\d+)\.data", path.name).group(1))
        if n in by_profile:
            profiles[n] = ef._read_gsm(path)
    nums = sorted(profiles)
    print(f"{len(nums)} profiles")

    # ---- global axis limits, exactly as _compute_global_limits ----
    def pad(lo, hi, frac=0.03):
        s = hi - lo
        return [float(lo - frac * s), float(hi + frac * s)]

    teff_lim = pad(history.log_Teff.min(), history.log_Teff.max())
    logL_lim = pad(history.log_L.min(), history.log_L.max())
    logT_all = np.concatenate([p["logT"] for p in profiles.values()])
    logR_all = np.concatenate([p["logRho"] for p in profiles.values()])
    logT_lim, logR_lim = pad(logT_all.min(), logT_all.max()), pad(logR_all.min(), logR_all.max())
    m_min = min(p["mass_norm"][p["mass_norm"] > 0].min() for p in profiles.values())
    mass_lim = [float(np.log10(m_min * 0.5)), float(np.log10(1.5))]
    numax = {n: float(by_profile[n]["numax_uHz"].iloc[0]) for n in nums}
    comb = np.concatenate([p["brunt_muhz"] for p in profiles.values()]
                          + [p["lamb_muhz"] for p in profiles.values()] + [np.array(list(numax.values()))])
    comb = comb[np.isfinite(comb) & (comb > 0)]
    lo, hi = np.nanpercentile(comb, [0.5, 99.9])
    freq_lim = [float(np.log10(lo * 0.7)), float(np.log10(hi * 1.3))]

    # ---- H-R track, simplified ----
    tx, ty = history.log_Teff.to_numpy(), history.log_L.to_numpy()
    keep = rdp((tx - teff_lim[0]) / (teff_lim[1] - teff_lim[0]), (ty - logL_lim[0]) / (logL_lim[1] - logL_lim[0]), TOL)
    track = {"teff": delta(tx[keep], S_TEFF), "L": delta(ty[keep], S_LOG)}

    # ---- EOS reference lines over the T-rho panel's density range ----
    r = np.array(logR_lim)
    eos = {
        "radgas": [r.tolist(), ef._radgas_logT(r).tolist()],
        "degen": [r.tolist(), ef._degeneracy_logT(r).tolist()],
        "reldeg_logrho": float(ef._REL_DEG_LOGRHO),
    }

    P = {k: [] for k in ("model", "age", "xc", "teff", "L", "numax", "dnu", "eps", "trho", "brunt", "lamb", "l0", "l1", "l2", "d1", "d2")}
    for n in nums:
        s, modes = profiles[n], by_profile[n]
        mn = int(modes["model_number"].iloc[0])
        row = hist.loc[mn] if mn in hist.index else None
        P["model"].append(mn)
        P["age"].append(float(f"{row.star_age / 1e6:.4g}") if row is not None else None)
        P["xc"].append(round(float(row.center_h1), 4) if row is not None else None)
        P["teff"].append(round(float(row.log_Teff), 4) if row is not None else None)
        P["L"].append(round(float(row.log_L), 3) if row is not None else None)
        P["numax"].append(round(numax[n], 2))

        P["trho"].append(encode_segments(s["logRho"], s["logT"], logR_lim, logT_lim, S_LOG, S_LOG))
        with np.errstate(divide="ignore", invalid="ignore"):
            lm = np.log10(s["mass_norm"])
            P["brunt"].append(encode_segments(lm, np.log10(s["brunt_muhz"]), mass_lim, freq_lim, S_LOG, S_LOG))
            P["lamb"].append(encode_segments(lm, np.log10(s["lamb_muhz"]), mass_lim, freq_lim, S_LOG, S_LOG))

        # echelle: same mode selection, Dnu fit and marker sizes as _draw_echelle
        mixed = modes[modes["mode_type"] == "mixed"]
        l0 = mixed[mixed["l"] == 0].sort_values("freq_uHz")
        dnu, eps = ef.get_model_Dnu(l0["freq_uHz"].to_numpy(), l0["l"].to_numpy(), np.nan, numax[n],
                                    mod_n=l0["n_pg"].to_numpy())
        P["dnu"].append(round(float(dnu), 4) if np.isfinite(dnu) else None)
        P["eps"].append(round(float(eps), 4) if np.isfinite(eps) else None)
        nu0, logE0 = l0["freq_uHz"].to_numpy(), np.log10(l0["E_norm"].to_numpy())
        P["l0"].append(delta(nu0[np.isfinite(nu0)], S_FREQ))
        for ell, key, dkey in ((1, "l1", "d1"), (2, "l2", "d2")):
            m = mixed[mixed["l"] == ell].sort_values("freq_uHz")
            nu, E = m["freq_uHz"].to_numpy(), m["E_norm"].to_numpy()
            good = np.isfinite(nu)
            nu, E = nu[good], E[good]
            area = ef._inertia_sizes(nu, E, nu0, logE0)      # matplotlib s, pt^2
            P[key].append(delta(nu, S_FREQ))
            P[dkey].append(np.round(np.sqrt(area) * S_DIAM).astype(int).tolist())

    out = {
        "meta": {
            "model": "YREC evolution, GYRE adiabatic frequencies",
            "mass": 1.0, "X": 0.7196, "Z": 0.0165, "alpha_mlt": 1.7076,
            "first_profile": nums[0],
            "scales": {"log": S_LOG, "teff": S_TEFF, "freq": S_FREQ, "diam": S_DIAM},
            "lims": {"teff": teff_lim, "L": logL_lim, "logT": logT_lim, "logRho": logR_lim,
                     "logm": mass_lim, "lognu": freq_lim},
            "eos": eos,
        },
        "track": track,
        "profiles": P,
    }
    assert nums == list(range(nums[0], nums[0] + len(nums))), "profile numbers are not contiguous"
    Path(args.out_json).parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, separators=(",", ":"), allow_nan=False)
    Path(args.out_json).write_text(text)
    print(f"wrote {args.out_json}: {len(text) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
