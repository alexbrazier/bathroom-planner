# Bathroom Designer

Personal bathroom planner: exact-dimension 2D plans, a 3D view, and a drag-and-drop library of
Dansani Luna, Villeroy & Boch (Collaro, Subway 3.0) and hansgrohe products.
Plain static site — HTML + ES modules, three.js from a CDN, no build step.

## Run locally

```bash
python3 serve.py
```

Then open http://localhost:8137 (or double-click `start.command` on macOS).
`serve.py` disables caching so code/data changes always load.

Designs are saved in the browser (per web address). Use **File → Save project** to keep a `.json`
copy and **File → Open project** to move it between machines or between localhost and the live site.

## Sharing

**Share ▾** creates a link to the current room or the whole project. The design is compressed into the
URL fragment (`#p=…`, see `js/share.js`), so nothing is stored on a server and the fragment never leaves
the browser. Links are snapshots (~0.5–1.5 KB for typical rooms). Opening one shows the design
view-only, with **Save a copy** (adds the rooms to your own project) or **Close**; the viewer's own saved
project is never touched until they save a copy.

## Layout

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | the app (`main.js` entry; `plan2d.js` 2D editor; `view3d.js` + `models3d.js` 3D; `export3d.js` GLB/OBJ export) |
| `data/catalog.json` | Dansani Luna (dansani.co.uk, £) |
| `data/catalog_vb.json`, `data/catalog_hg.json` | Villeroy & Boch, hansgrohe (megabad.com, €) |
| `data/img/` | product thumbnails |
| `assets/`, `manifest.webmanifest` | favicons, app icons and header logo (generated) |
| `design/icon-source.png` | original icon artwork — regenerate `assets/` with `python3 tools/make_icons.py` |
| `tools/` | scripts used to build the catalogues and icons |
| `_headers` | Cloudflare Pages headers (noindex, no-cache for JS/data); ignored by GitHub Pages |

## Deploy (GitHub Pages)

`.github/workflows/github-pages.yml` publishes `index.html`, `manifest.webmanifest`, `assets/`, `css/`, `js/` and `data/` on every push to
`main` (or run it manually from the Actions tab).

One-time setup: in the GitHub repo go to **Settings → Pages → Build and deployment → Source** and choose
**GitHub Actions**. The site appears at `https://<username>.github.io/<repo-name>/`.

> **Heads-up:** GitHub Pages sites are public, even when the repository is private (access control for
> Pages needs GitHub Enterprise Cloud). The catalogue contains product images and data copied from
> manufacturer/retailer sites for personal use, so anyone with the URL can see them. The page sends a
> `noindex` meta tag so search engines shouldn't list it, but that isn't access control.
> `_headers` is Cloudflare-only and is ignored by GitHub Pages.

### Cloudflare Pages (alternative, currently manual-only)

`.github/workflows/deploy.yml` deploys to Cloudflare Pages and only runs when triggered by hand from
the Actions tab. It can be put behind Cloudflare Access (free, up to 50 users) to keep the site private.
To use it: add secrets `CLOUDFLARE_API_TOKEN` (custom token with **Account → Cloudflare Pages → Edit**)
and `CLOUDFLARE_ACCOUNT_ID`, optionally a variable `CF_PAGES_PROJECT`, then run the workflow.
To make it automatic again, add a `push: branches: [main]` trigger back to the file.

For Access: Zero Trust → Access → Applications → Add → Self-hosted → domain
`<project>.pages.dev` (plus `*.<project>.pages.dev` for previews) → Allow → Emails → your address.

## Refreshing product data

`tools/` holds the scripts used to build the catalogues (they need Python 3 and `curl`):

- `build_catalog.py` — turns scraped Dansani product data into `data/catalog.json`.
- `megabad.py` — downloads and parses megabad.com product pages from a list of links
  (the link lists were collected from Megabad's category pages in a browser, since those render client-side).
- `build_brands.py` — turns parsed Megabad products into `data/catalog_vb.json` / `catalog_hg.json`
  and downloads thumbnails into `data/img/<prefix>/`.

Prices are snapshots and will drift; dimensions are what matter for planning.
