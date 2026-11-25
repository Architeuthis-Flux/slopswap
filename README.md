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
- Tool pages (dense UI with their own layout): `<body class="app">` turns off the document decorations. A tool in the console look uses `<html class="console">` instead: see the next section.
- Style guide: links and single highlights are pink (the J); a row of siblings cycles the rainbow (`.cycle`); backgrounds are layered greys, never black; on phones a control panel is capped at 40% of the screen and scrolls inside itself (`.capped`) and rows of chips or buttons scroll sideways (`.scroll-x`). The converter applies the phone rules to the usual `header`, `.filters`, `.frow`, `.seg`, `.chips`, `.tabs` and `.toc` patterns.

## The console look, and where to change it

Tools (the routing lab, the board outline, the cost explorer, the V6 notebook) wear one look: panels with name plates, cut corners, narrow capital labels, the rainbow and the magenta. It lives in one place, the section of `styles/jumperless.css` between `console:begin` and `console:end`, and a page asks for it with `<html class="console">` (and no `app` on its body).

- **To change every tool at once**, edit `styles/jumperless.css`. Colours, fonts, the corner cut and the three grounds are the `--jl-*` values at the top (`--jl-surface`, `--jl-font-label`, `--jl-font-console`, `--jl-cut`, `--jl-hover`, `--jl-sel`, `--jl-problem`, and the palette); the shapes (plate, button, panel bar, heading mark, table head, tab row) are in the console section. Document pages follow the `--jl-*` colours too.
- **The section does not hide `[hidden]` elements for a page**: a page that sets `display` on things it also hides says `[hidden] { display: none !important; }` itself (the lab and the notebook do; the outline shows a hidden dock on a phone on purpose).
- **Every console rule starts with `:where(.console)`**, so it weighs no more than the same rule in a page's own sheet: the document rules above it lose by coming first, a page's own rules win by coming after. Keep new rules that way.
- **A tool keeps only its own layout** in its page. A tool that must also open from disk carries a copy of the section in `<style id="console-copy">` (or, the routing lab, in `console.css`). Never edit a copy: `python3 .tools/console_copy.py <file> [...]` writes it again from the sheet.

| Tool | Source | How it gets here |
|---|---|---|
| Routing lab | the Jimulator repo, `Routing/` (`web/console.css` is the copy) | `lab.py export`, then `.tools/routing_lab_dress.py` (takes the copy out, links the sheet) |
| Cost explorer | the V6 pile, `notes/v6_cost_explorer.html` (copy inline) | `.tools/console_dress.py <source> V6/cost-explorer.html "<short title>" "<description>"` |
| Board outline | the JumperlessV6 folder, `v6mech/` (copy inline in `src/viewer.html`) | `node build.mjs`, then its own `tools/to_slopswap.py` (takes the copy out, links the sheet) |
| V6 notebook | `V6/notebook.html`, written here | nothing: it links the sheet |

After a change to the look, run `console_copy.py` on the three copies if the tools should also follow from disk, then `python3 build.py` and look at one page of each tool.

## The V6 notebook

`V6/notebook.html` shows the V6 tools as tabs of one page. Each tool is its own page in a frame, so it still opens alone at its own address and a newer copy of a tool drops in with nothing to redo.

- **Tabs** are the `TABS` list in the page; the frames behind them are `FRAMES`. To add a tool, add a line to each: its address and the names it keeps its state under in the browser's storage (`keys`).
- **A notebook page** is a whole design: a copy of what every tool keeps under its `keys`, taken when the page is put away and written back when it is opened. The page open now is simply what the tools hold; nothing in a tool was changed for this. Pages live in this browser (`v6nb.v1`); Export and Import carry them as a file.
- **Sync** (the button by the page list): with the notebook key pasted once on a device, that device and Kevin's Cloudflare account keep the same pages. A sync runs when the page opens, a few seconds after a change, when the page is come back to, and on the button. A page changed on one device comes down on the others; a page changed on two is never merged or dropped: the account's keeps the name and the other is kept beside it as "name (this device, date)". The rules are `V6/notebook-sync.js` (tested by `node .workers/notebook/test/merge.test.mjs`); the service, its key and how to run it locally are in `.workers/notebook/README.md`. Without a key the page asks the network for nothing.
- **Inside the notebook** a tool gets `class="embedded"` on its `<html>` and drops its stripe, its crumb and its own name (the console section and each tool's sheet say how).
- **Linked** (the box in the bar, on by default): the outline is the design and the cost explorer prices it. The display, its window (none, cut, glass), the expansion port and the number of magnetometers go one way, from the outline's kept design into the cost explorer's own controls, whenever the outline changes or the Cost tab opens. `LINK` and `facts()` in the page hold the two tools' names for the same things; add a display or a socket there when a tool gains one. What the cost explorer has no price for (the 1.9 and 2.99 inch displays, SFP cages, the test board's mixed sensors) is left as it was. Open the page with `?check` to try the reading on four made-up designs. Unticked, the cost explorer keeps what is set in it.
- **The Routing tab shows a saved run**, one per copper (`COPPER`): it switches between runs made ahead of time and does not route.

## Dark Reader

The Dark Reader browser extension re-colours a page by guessing what each CSS variable is used for. On pages that are dark already it guesses wrong often: rainbow bars, coloured borders and SVG fills come out grey. So `build.py` adds `<meta name="darkreader-lock">` to every built page that draws itself dark (it links `jumperless.css`, or has its own `prefers-color-scheme: dark` or `color-scheme: dark` palette), which makes Dark Reader leave the page alone. Nothing to do per page; `styles/template.html` carries the tag only as a reminder.

- Light-only pages (the Del Mar theme, `data-theme="light"`) are not locked, so Dark Reader still darkens them. After changing colours on one, run `.tools/darkreader-audit.js` (usage at the top of the file): it loads every built page with Dark Reader's own engine and lists any colour that went grey. It should report 0 bad.
- A page that follows the reader's system setting is locked too, so with Dark Reader on it shows its own dark palette in dark mode and its light one otherwise.

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

## Art published from the lenticular shirt viewer

`lenticular-shirt/art.json` lists the images the viewer opens on, and `art-<hash>.png` beside it are those images (preview size, plus full size when ticked). They are committed by the viewer's own **Publish these on the page** button, through the GitHub API with a token kept in Kevin's browser, in commits named `lenticular-shirt: art published from the viewer`. An `art.json` with no layers means the page opens on its built-in art. Do not edit these by hand; rebuilding `index.html` leaves them alone.

## Preview locally

```bash
python3 build.py && python3 -m http.server -d _site 8000
```

## Front page and icons

`landing.html` is the front page. Edit its HTML and CSS there; `build.py` fills three placeholders: `{{latest}}` (the six most recently changed pages), `{{stats}}` and `{{projects}}` (one row per folder, most recently changed first). A folder's row shows its `index.html`'s `<meta name="description">`, falling back to the index title, then to its page titles. Dates are the last commit that touched the page or folder.

To keep a folder off the front page, put a file named `.unlisted` in it. The folder is still built and its pages open by direct link; it just gets no row, no entry under "recently updated" and no place in the counts. Delete the file to list it again.

The hero image is `styles/architeuthis-flux.webp`, the Architeuthis Flux mark; the two icons are the same mark. `styles/favicon.png` and `styles/apple-touch-icon.png` are added to every built page that does not name an icon of its own, except in folders with their own branding (Del Mar).

A folder without its own `index.html` gets a generated one in three tiers: its pages as rows (title, the page's `<meta name="description">`, date), then the files a visitor might want (anything a page links to as a download, or that no page mentions), then, folded away, the files the pages only load (their images, data and scripts). The rows, labels and file lists are the theme's `.ix-rows`, `.ix-label` and `.ix-files`, which a hand-written index can use too.

## Hosting

GitHub Pages (workflow deploy) behind Cloudflare DNS with the proxy on, SSL mode "Full". See `.github/workflows/pages.yml`.
