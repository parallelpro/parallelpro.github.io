"""Pack clickelle's example stars into compact JSON for resources/echelle/.

Each example is a background-normalised (S/B) power spectrum on a uniform
frequency grid, the saved widget parameters and the tagged modes, all from
https://github.com/parallelpro/clickelle (MIT licence). The grid is stored as
(f0, df, n) and the power as integers in units of 0.01, which is far finer than
the smoothing the widget applies.

Usage:
    python3 tools/export_echelle_examples.py <clickelle checkout> resources/echelle/examples
"""
import csv
import json
import sys
from pathlib import Path

STARS = {
    "KIC10272858": "red giant",
    "KIC10972873": "subgiant",
}


def main():
    repo, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for star, kind in STARS.items():
        rows = list(csv.reader(open(repo / "examples" / f"{star}_snr.csv")))[1:]
        f = [float(r[0]) for r in rows]
        p = [float(r[1]) for r in rows]
        n = len(f)
        df = (f[-1] - f[0]) / (n - 1)
        worst = max(abs(f[i] - (f[0] + i * df)) for i in range(n))
        assert worst < 1e-4, f"{star}: grid not uniform (max deviation {worst} uHz)"

        prm = next(csv.DictReader(open(repo / "examples" / "clickelle_out" / star / "params_init.csv")))
        modes = [[round(float(r["fc"]), 4), int(r["l"])]
                 for r in csv.DictReader(open(repo / "examples" / "clickelle_out" / star / "modes_init.csv"))]
        data = {
            "name": star.replace("KIC", "KIC "), "kind": kind,
            "source": "clickelle example, background-normalised Kepler spectrum (S/B)",
            "numax": float(prm["numax"]),
            "params": {k: float(prm[k]) for k in ("dnu", "eps_p", "dpi1", "q", "d01", "smooth")},
            "f0": f[0], "df": df, "n": n,
            "snr100": [round(v * 100) for v in p],
            "modes": sorted(modes),
        }
        text = json.dumps(data, separators=(",", ":"))
        (out / f"{star}.json").write_text(text)
        print(f"{star}: {n} points, {len(modes)} modes, grid deviation {worst:.1e} uHz -> {len(text) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
