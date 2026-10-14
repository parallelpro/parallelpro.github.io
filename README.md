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
