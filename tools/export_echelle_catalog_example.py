"""Pack a Kepler red giant from published catalogues into resources/echelle/examples/.

Sources, all for the same star:
  * spectrum: the background-divided power density (S/B) from the Yu et al. (2018)
    Kepler red giant database (<KIC>.seis), trimmed to the oscillation range;
  * modes: Kallinger (2019) KeplerRGpeakbagging mode file, keeping modes with
    evidence > 0.91 ("strong evidence" in that catalogue);
  * DPi1 and q: Vrard et al. (2016);
  * Dnu and eps_p: a straight-line fit of frequency against radial order to the
    catalogue's l = 0 modes, as clickelle's "refine Dnu" does.

Usage:
    python tools/export_echelle_catalog_example.py <KIC> <spectra dir> <sample dir> <out dir> [--half 3]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


def read_seis(path):
    lines = Path(path).read_text().split("\n")
    start = max(i for i, s in enumerate(lines) if s.startswith("#")) + 1
    a = np.loadtxt(lines[start:])
    return a[:, 0], a[:, 1]


def read_modes(path):
    rows, started = [], False
    for line in Path(path).read_text().split("\n"):
        if line.strip().startswith("l ") and "freq" in line:
            started = True
            continue
        if started and line.strip() and not line.startswith("#"):
            t = line.split()
            rows.append((int(t[0]), float(t[1]), float(t[7])))
    return pd.DataFrame(rows, columns=["l", "fc", "ev"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kic", type=int)
    ap.add_argument("spectra_dir")
    ap.add_argument("sample_dir", help="folder with vrard+16.csv and KeplerRGpeakbagging/")
    ap.add_argument("out_dir")
    ap.add_argument("--half", type=int, default=3, help="window half-width in Dnu around numax")
    ap.add_argument("--kind", default="red clump")
    a = ap.parse_args()

    sample = Path(a.sample_dir)
    vrard = pd.read_csv(sample / "vrard+16.csv").set_index("KIC").loc[a.kic]
    summ = pd.read_csv(sample / "KeplerRGpeakbagging" / "summary.dat", sep=";").set_index("KIC").loc[a.kic]
    modes = read_modes(sample / "KeplerRGpeakbagging" / "ModeFiles" / f"{a.kic}.modes.dat")
    modes = modes[modes.ev > 0.91]
    numax = float(summ.fmax)

    f0 = np.sort(modes[modes.l == 0].fc.values)
    n = np.round(f0 / float(summ.dnu_cor) - 0.5).astype(int)
    dnu, intercept = np.polyfit(n, f0, 1)
    eps = (intercept / dnu) % 1.0
    if eps < 0.5:                       # clickelle's convention: eps_p in [0.5, 1.5)
        eps += 1.0

    nu, sb = read_seis(Path(a.spectra_dir) / f"{a.kic}.seis")
    keep = (nu > numax - (a.half + 3) * dnu) & (nu < numax + (a.half + 4) * dnu)   # room to widen the window
    nu, sb = nu[keep], sb[keep]
    df = (nu[-1] - nu[0]) / (len(nu) - 1)
    worst = float(np.max(np.abs(nu - (nu[0] + df * np.arange(len(nu))))))
    assert worst < 1e-4, f"grid not uniform (max deviation {worst} uHz)"

    data = {
        "name": f"KIC {a.kic}", "kind": a.kind,
        "source": "Kepler S/B spectrum from Yu et al. (2018); modes from Kallinger (2019); ΔΠ1 and q from Vrard et al. (2016)",
        "numax": round(numax, 4),
        "params": {"dnu": round(float(dnu), 4), "eps_p": round(float(eps), 4), "dpi1": float(vrard.DPi1),
                   "q": float(vrard.q), "d01": 0.0, "smooth": 0.005},
        "view": {"half": a.half},
        "f0": float(nu[0]), "df": float(df), "n": int(len(nu)),
        "snr100": [int(round(v * 100)) for v in sb],
        "modes": sorted([[round(float(r.fc), 4), int(r.l)] for r in modes.itertuples()]),
    }
    out = Path(a.out_dir) / f"KIC{a.kic}.json"
    text = json.dumps(data, separators=(",", ":"))
    out.write_text(text)
    counts = modes.l.value_counts().sort_index().to_dict()
    print(f"KIC {a.kic}: numax {numax:.2f}, dnu {dnu:.4f}, eps_p {eps:.4f}, DPi1 {vrard.DPi1}, q {vrard.q}, "
          f"{len(nu)} points {nu[0]:.1f}-{nu[-1]:.1f} uHz, modes {counts}, grid deviation {worst:.1e} -> {len(text)/1e3:.0f} kB")


if __name__ == "__main__":
    main()
