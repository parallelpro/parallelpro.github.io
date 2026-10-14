# yaguangli.page

Source for https://www.yaguangli.page/ — a plain HTML + CSS site, no build step.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The main page: About, Research, Talks and Code sections |
| `resources/index.html` | Resources (separate page) |
| `css/style.css` | All styling (colours live in the `:root` block at the top) |
| `img/` | Portrait, research card images, the Resources banner, `og-image.jpg` (social preview) |
| `files/` | CV and slide PDFs hosted on the site |
| `resources/oscillations/` | Interactive oscillation explorer: page, `explorer.js`, and generated `data.json` |
| `resources/echelle/` | Stretched échelle tool: page, `echelle.js` (interface), `echelle-core.js` (fold and stretching, a port of clickelle), `examples/` |
| `tools/` | Scripts that build the data files above (not used by the live site) |
| `favicon.svg`, `favicon.png`, `apple-touch-icon.png` | Site icon |
| `fonts/` | A three-glyph subset of AR PL KaitiM GB (the LaTeX CJK `gkai` font) used for 李亚光 in the heading, with its Arphic Public License |
| `astronomy-*/` | Redirects from the old Google Sites URLs to the matching section |
| `CNAME` | Custom domain for GitHub Pages |
| `404.html` | Not-found page |

## Preview locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/ in a browser.

## Edit

The main page is one long file with a `<section id="...">` per topic, each starting with an
`<h2 class="section-title">`. To add a section, copy one of the existing
blocks, give it a new `id`, and add a matching `#id` link to the nav in both `index.html` and
`resources/index.html`. The nav highlights the section in view via a few lines of script at the
bottom of `index.html`.

The header, nav and footer are duplicated in `resources/index.html`, so change them in both files.

Each page's `<head>` has a `description` meta tag and matching Open Graph tags (`og:title`,
`og:description`). Keep them in sync when you change a page's title or summary.

### Updating the "Last updated" date

The footer of every page carries a date. Update all of them in one go:

```sh
sed -i '' 's/Last updated [^<]*/Last updated January 2027/' index.html */index.html
```

### Replacing the CV

Overwrite `files/Yaguang_Li_CV.pdf` and push. The link on the home page does not need to change.

## Deploy

The site is served by GitHub Pages from the `main` branch of `parallelpro/parallelpro.github.io`.
Pushing to `main` redeploys within a minute or two.

## Regenerating the oscillation explorer data

The explorer redraws the four panels of `sg-rotation/src/examine_frequency.py` in the browser. Its data file is
precomputed from a YREC/GYRE run using that script's own functions, then simplified to screen resolution
(about 0.8 MB, or 230 KB as served). Run it with the sg-rotation virtualenv, which has h5py and pandas:

```sh
../sg-rotation/.venv/bin/python tools/export_oscillation_data.py \
    ../sg-rotation/hpc/run_1p0Msun resources/oscillations/data.json
```

To show a different run, point the first argument at another run folder and update the model description at
the bottom of `resources/oscillations/index.html`.

## Stretched échelle tool

`resources/echelle/echelle-core.js` ports the fold (`make_fold`, `frequency_echelle`, `period_echelle`), the
stretching (`make_tau`, `make_f`) and clickelle's stack-index marker placement line by line, so the diagrams match
clickelle. Everything runs in the browser; user files are never uploaded. The two example stars come from
clickelle's `examples/` folder and are packed with:

```sh
git clone https://github.com/parallelpro/clickelle /tmp/clickelle
python3 tools/export_echelle_examples.py /tmp/clickelle resources/echelle/examples
```

The red clump example (KIC 7593843) is built from published catalogues instead: the Yu et al. (2018) S/B spectrum,
Kallinger (2019) mode frequencies and Vrard et al. (2016) ΔΠ1 and q. To add another catalogue star, run the exporter
and add an entry to `EXAMPLES` in `echelle.js` and to the select menu in `index.html`:

```sh
../sg-rotation/.venv/bin/python tools/export_echelle_catalog_example.py 7593843 \
    ~/Onedrive/Work/database/Spectra16000 ../stretched-frequency/sample resources/echelle/examples --half 3
```
