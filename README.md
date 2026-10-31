# slopswap.org

Static hosting for documents Claude makes for Kevin, reachable where claude.ai is not (China). Everything here is public.

**URL scheme:** `slopswap.org/<folder>/<file>.html`. Each top-level folder is a project; `misc/` is for one-offs, `V6/` is Jumperless V6, `del-mar-plate-freezer/` is the Del Mar project.

## Add a page

1. Save the `.html` in a project folder (or `mkdir` a new one). Files live exactly one folder deep; images and PDFs sit next to the page.
2. Link a theme near the top, with a relative path:
   - default, the Jumperless look: `<link rel="stylesheet" href="../styles/jumperless.css">`
   - Del Mar plate freezer: `<link rel="stylesheet" href="../styles/delmar.css">`
3. `git add -A && git commit -m "..." && git push`. The `pages` workflow runs `build.py` and deploys in about a minute.

Start a new page from `styles/template.html`. Give it a `<title>` and, if the title is long, a `<meta name="short-title">` for the splash.

## The Jumperless theme

`styles/jumperless.css` follows shop.jumperless.org (charcoal, hot pink, cyan, Michroma headings, Press Start 2P labels) and docs.jumperless.org (the rainbow). Dark only; `data-theme="light"` on `<html>` gives the light look. Tokens: `--bg --surface --surface-2 --fg --muted --line --accent --accent-2 --accent-3 --r1…--r10 --rainbow --font-display --font-body --font-mono --font-pixel`. Logo: `styles/jumperless-wordmark.png` (the pixel wordmark), `styles/jump-logo.svg` (the round mark). The ten `--r` colours are the wordmark's letters in order.

- Document pages: `<main class="page">` (reading column) or `class="page wide"`.
- Tool pages (dense UI with their own layout): `<body class="app">` turns off the document decorations.
- Style guide: links and single highlights are pink (the J); a row of siblings cycles the rainbow (`.cycle`); backgrounds are layered greys, never black; on phones a control panel is capped at 40% of the screen and scrolls inside itself (`.capped`) and rows of chips or buttons scroll sideways (`.scroll-x`). The converter applies the phone rules to the usual `header`, `.filters`, `.frow`, `.seg`, `.chips`, `.tabs` and `.toc` patterns.

## Splash

`styles/ddj-splash.svg` is the Dirty Deeds Jumperless artwork; `styles/splash.js` puts the newest pages' names in the eye boxes (and lists them below on phones). In a folder's `index.html`:

```html
<div class="splash" data-svg="../styles/ddj-splash.svg" data-recent="recent.json"></div>
<script src="../styles/splash.js"></script>
```

`build.py` writes `recent.json` into every folder: the pages newest first, dated by the commit that added them (the workflow checks out full history for this; uncommitted pages fall back to their mtime).

## Converting a claude.ai artifact

```bash
python3 localize_fonts.py --theme <saved-artifact.html> V6/<name>.html
```

Self-hosts any Google Fonts the page links (Google is blocked in China), links the theme, marks the page as an app, adds a breadcrumb, and points the artifact's own colour and font tokens at the theme. Tokens it does not recognise keep their values; adjust by hand if the look is off. Without `--theme` it only swaps the fonts.

## Rules that keep pages loading in China

- No Google Fonts, no CDN scripts (cdnjs usually works, nothing else does). Fonts live in `styles/fonts/`.
- Inline the page's own CSS and JS. Chinese text renders in system CJK fonts; nothing to ship.

## Preview locally

```bash
python3 build.py && python3 -m http.server -d _site 8000
```

Index pages (`/` and `/<folder>/`) are generated unless the folder has its own `index.html`; the root links such folders without listing their files.

## Hosting

GitHub Pages (workflow deploy) behind Cloudflare DNS with the proxy on, SSL mode "Full". See `.github/workflows/pages.yml`.
