# slopswap.org

Static hosting for documents Claude makes for Kevin, reachable where claude.ai is not (China). Everything here is public.

**URL scheme:** `slopswap.org/<project-folder>/<file>.html`. Each top-level folder is a project; `misc/` is for one-offs.

## Add a document

1. Drop the `.html` file in a project folder (or `mkdir` a new one). Files live exactly one folder deep.
2. Link a theme near the top of the file, with a relative path:
   - default: `<link rel="stylesheet" href="../styles/jumperless.css">`
   - Del Mar plate freezer: `<link rel="stylesheet" href="../styles/delmar.css">`
3. `git add -A && git commit -m "..." && git push`. The `pages` workflow runs `build.py` and deploys about a minute later.

Index pages (`/` and `/<project>/`) are generated at build time; a folder with its own `index.html` keeps it.

## Rules that keep pages loading in China

- No Google Fonts, no CDN scripts (cdnjs usually works, nothing else does). Fonts are self-hosted in `styles/fonts/`.
- Inline the page's own CSS and JS; put images next to the page.
- Chinese text renders in system CJK fonts; nothing to ship.

## Preview locally

```bash
python3 build.py && python3 -m http.server -d _site 8000
```

Pages also open straight from Finder, since all links are relative.

## Hosting

GitHub Pages (workflow deploy) behind Cloudflare DNS with the proxy on, SSL mode "Full". See `.github/workflows/pages.yml`.
