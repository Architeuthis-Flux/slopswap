# Social Card and Link Preview Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every slopswap page without its own image unfurls with the lenticular shirt (still everywhere, moving in Messages and Discord), and `misc/link-preview.html` shows how any pasted link unfurls on each platform.

**Architecture:** A script drives the existing viewer in headless Chrome and writes three files into `styles/`; `build.py` writes the tags into built pages. The tester is a static page whose reading rules live in one dependency-free script shared with a small Worker that fetches other sites' heads.

**Tech Stack:** Python 3 (stdlib, Pillow, Playwright), ffmpeg, plain browser JavaScript (no bundler, no CDN), Node 22 `node:test`-free assert scripts, Cloudflare Workers (wrangler ≥ 4.36 for `ratelimits`).

**Spec:** `.docs/superpowers/specs/2026-11-27-social-card-and-link-preview-design.md`

## Global Constraints

- No Google Fonts, no CDN scripts; a page's fonts come from `styles/fonts/` (README, "Rules that keep pages loading in China").
- Tools wear the console look: `<html class="console">`, no `app` on the body, only their own layout in the page.
- Files live exactly one folder deep; dot-folders are not built into the site.
- Card: 1200×630; still at 30° right; sweep ±35°, loop about 4 s, starting at +35°.
- `styles/social-card.jpg` ≤ 300 kB (half of WhatsApp's 600 kB). Icon + image + video ≤ 10 MB (Messages).
- Discord component payload ≤ 3,000 bytes, ≤ 40 components, buttons `style` 5 with only `type, style, label, url`.
- Pages that already name an `og:image` are not touched. Folders whose theme is not `jumperless` (Del Mar) are skipped.
- Nothing fetched by the tester or the Worker is ever run or inserted as markup.
- Nothing is committed or pushed until Kevin has seen the still and the sweep.

## Review Focus

1. A fetched page's title or description holding markup (`<img onerror>`, `</script>`), or a `javascript:` image or link address: the tester shows it as text and never loads it. → Task 3 tests `esc`, `md`, `safeUrl`.
2. A slopswap page whose title holds `</script>`, markdown marks or 5,000 characters: its Discord payload still parses, stays ≤ 3,000 bytes and cannot close its own script tag. → Task 2 `check()`.
3. A pasted link with no scheme, a link to an image or PDF, a 404, a redirect loop, a site that never answers: one plain line saying what happened, no blank page. → Task 4 Worker tests; Task 5 page check.
4. The Worker asked for `localhost`, `10.0.0.1`, `[::1]`, a `:8080` port, its own `/api/` address, or by a page on another site: refused. → Task 4.
5. Tags written the ways real pages write them (`content` before `property`, single or no quotes, upper case, `&amp;`, `value=` instead of `content=`, tags after 300 kB): read the way a crawler reads them. → Task 3.

---

### Task 1: Render the card

**Files:** Create `.tools/social_card.py`; writes `styles/social-card.jpg`, `styles/social-sweep.webp`, `styles/social-sweep.mp4`.

**Interfaces — Produces:** the three files above, all 1200×630. `python3 .tools/social_card.py --check` exits 0 when they exist and meet the Global Constraints.

- [ ] Write `check()` first: JPG is 1200×630 and ≤ 300 kB; WebP is animated, 1200×630, 40–60 frames, total duration 3.5–4.5 s; MP4 probes (ffprobe) as h264, yuv420p, 1200×630, no audio stream; the three together ≤ 10 MB. Run `--check`: fails, files missing.
- [ ] `render(angles: list[float]) -> list[PIL.Image]`: serve the repo root on a free port, open `lenticular-shirt/index.html` at device scale 2 in a 1700×1500 viewport, wait until `__lent.keep.site` is set and two frames in a row are identical, set `__lent.S.lv = 1e5` (puts the loupe mark off the canvas), then per angle set the `#angle` slider, dispatch `input`, await a pushed `__lent.hooks` callback, read `#shirt` with `toDataURL`.
- [ ] `compose(canvas: Image) -> Image`: 1200×630 on `#27272b`; the canvas scaled so the print (wordmark top to circle bottom) fills the height with a 4% margin, centred on the print.
- [ ] Angles: still `[30]`; loop `35·cos(2πk/50)` for k in 0..49 at 80 ms a frame; render the 26 distinct angles once and reuse them on the way back.
- [ ] Encode: JPG `quality` stepped down from 90 until ≤ 300 kB; WebP `save_all, duration=80, loop=0, quality=70, method=6`; MP4 `libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart -an`, the loop written three times so a player that does not loop still shows 12 s.
- [ ] Run it, run `--check` (passes), and look at the still, four frames of the sweep and the first frame of the MP4.

### Task 2: `build.py` writes the tags

**Files:** Modify `build.py` (new functions after `add_icons`, two calls in `main`, asserts in `check`).

**Interfaces — Consumes:** Task 1's three files. **Produces:**
- `SITE = "https://" + CNAME`, `ACCENT = "#fc0289"`, `DISCORD_EMBED = True`.
- `asset(rel: str) -> str`: absolute URL with `?v=<first 10 hex of the file's sha256>`.
- `discord_embed(title: str, about: str, url: str, home: bool) -> str`: the JSON text, `<` written as `<`.
- `social_tags(s: str, url: str, home: bool) -> str`: the tag block for a page's HTML, `""` when it names an `og:image`.
- `add_social(folder: Path, at: str) -> int`: applies it to `folder/*.html`; `at` is `""` or `"<project>/"`.

- [ ] Add to `check()`, run `python3 build.py`, see it fail on the missing names:
  - a page with `property="og:image"` → `""`.
  - a bare page (`<title>A &amp; B</title>`, a description) → block has `og:image`, `og:image:width` 1200, `og:image:height` 630, `og:image:type` image/jpeg, `og:image:alt`, `og:video`, `og:video:secure_url`, `og:video:type` video/mp4, `twitter:card` summary_large_image, `og:site_name` slopswap, `og:url`, `og:title` "A &amp; B", `og:description`, `theme-color` with `media="not all"`, and no `twitter:image`.
  - a page that has `og:title` already → block has no second `og:title`.
  - `json.loads(discord_embed('</script><b>*x*</b> [y](z)', 'd' * 5000, url, False))`: `component.type == 17`; `len(text.encode()) <= 3000`; `"</script" not in text`; the title's `*`, `[`, `]`, `_`, `` ` `` are backslashed in the Text Display; buttons have exactly the keys `type, style, label, url`; one gallery item whose URL ends `social-sweep.webp?v=…`.
  - `home=True` → one button; else two.
- [ ] Implement. Text Display content: `-# slopswap\n### [title](url)\ndescription`, the description cut on a word to fit the byte budget. Skip folders where `theme_of(d) != DEFAULT_THEME`. `og:url` is the folder address for `index.html`.
- [ ] `python3 build.py` passes; `grep -c og:image _site/index.html` is 1; `_site/emf-badge/index.html` still has exactly its own image; no file under `_site/del-mar-plate-freezer/` mentions `social-card`.

### Task 3: The reading rules

**Files:** Create `misc/link-preview.js` (UMD like `V6/notebook-sync.js`, global `LinkPreview`); test `.workers/unfurl/test/core.test.mjs`.

**Interfaces — Produces** (`LP = LinkPreview`):
- `LP.read(html: string, base: string) -> Page`: `{ url, metas: [{key, value, at}], title, description, icons: [{href, sizes, rel}], oembed, canonical, embed: {inline: string|null, href: string|null}, headEnd: number }`. Regex scanner, no DOM; `key` is `name` else `property`, `value` is `content` else `value`; entities decoded; addresses resolved against `base`; `at` is the byte offset of the tag.
- `LP.pick(page, keys: string[], which = 'first') -> string`.
- `LP.sniff(bytes: Uint8Array) -> { format, width, height, animated }` for PNG/APNG, GIF, JPEG, WebP, AVIF, MP4/MOV, WebM; unknown → `{format: ''}`.
- `LP.component(text: string) -> { ok, problems: string[], bytes, tree }` by Discord's rules in Global Constraints.
- `LP.PLATFORMS`: ordered list of `{ id, name, source }` for discord, imessage, slack, x, whatsapp, facebook, linkedin, telegram, signal, mastodon, bluesky, teams; `source` is `'docs'` or `'observed'`.
- `LP.resolve(id, page, media, extra) -> Card`: `{ layout: 'large'|'small'|'text'|'video'|'gallery'|'photo'|'component'|'none', site, title, description, domain, images: string[], video, color, author, date, fields: [[label, value]], animates: boolean, notes: string[] }`. `media` maps address → `{ type, bytes, width, height, animated, status }`; `extra` is `{ oembed, component }`.
- `LP.checks(page, media, extra) -> [{ level: 'ok'|'warn'|'bad', who: string[], text }]`.
- `LP.esc(s)`, `LP.safeUrl(s) -> string` (`''` unless http/https), `LP.md(s) -> string` (escaped HTML for the Discord subset: `#`–`###`, `-#`, `**`, `*`, `` ` ``, `[t](u)`, list items, line breaks).
- `LP.CRAWLERS`: `{ id: { name, ua } }`.

- [ ] Write the tests (fail: no module): the Review Focus 5 tag forms; Discord's documented rules (first non-empty title; last `twitter:card`/`og:type`/`theme-color` wins; two `og:image` → gallery capped at 4; video needs `og:type` video* or `twitter:card` player and an `og:image`; `<title>`+description only as a pair when no og/twitter text; title trimmed to 70 bytes, description to 350); Messages (`og:video` direct file → `layout: 'video'`, `animates`); Slack fields from `twitter:label1/data1`; X prefers `twitter:image`, `animates` false; WhatsApp large only when width ≥ 300 and width/height ≤ 4 and bytes ≤ 600 kB, else small, and `none` image when over; `component()` rejects 3,001 bytes, a second top-level key, type 3, a button with `custom_id`, 11 gallery items, a `javascript:` URL, and accepts the payload `build.py` writes; `sniff` on eight hand-built headers; `md('<img src=x onerror=1> [a](javascript:alert(1)) **b**')` has no `<img`, no `javascript:`, has `<strong>b</strong>`.
- [ ] Implement until `node .workers/unfurl/test/core.test.mjs` prints `ok`.

### Task 4: The fetch Worker

**Files:** Create `.workers/unfurl/src/index.js`, `.workers/unfurl/wrangler.jsonc` (name `slopswap-unfurl`, route `slopswap.org/api/unfurl`, `workers_dev` false, `ratelimits` `LIMIT` 30 per 60 s, namespace `"2711"`), `.workers/unfurl/dev.mjs`, `.workers/unfurl/README.md`; test `.workers/unfurl/test/worker.test.mjs`.

**Interfaces — Produces:**
- `GET /api/unfurl?url=<address>&as=<crawler id>` → `{ url, final, status, hops: [{url, status}], type, html, bytes, cut, ms, as }`; `html` is the document up to `</head>` or 400 kB.
- `GET /api/unfurl?probe=<address>&as=` → `{ url, final, status, type, bytes, format, width, height, animated, ms }` from the first 256 kB (`Range`), `bytes` from `Content-Range` or `Content-Length`, else null.
- `GET /api/unfurl?text=<address>` → `{ url, final, status, type, text }`, at most 64 kB (oEmbed, linked component JSON).
- Errors as `{ error }`: 400 not an http(s) address; 403 refused address or caller; 405 not GET; 429 limited; 502 fetch failed; 504 over 8 s; 508 more than 5 redirects.
- `env.UNFURL_ALLOW_LOCAL === 'yes'` lets tests and `dev.mjs` reach `127.0.0.1` on any port; never set in `wrangler.jsonc`.
- `dev.mjs [port] [site dir]`: serves the built site and the Worker on `127.0.0.1` (default 8788, `../../_site`).

- [ ] Write the tests against `worker.fetch(new Request(...), env)` with a local `node:http` target: a head is returned and cut at `</head>`; the `User-Agent` the target saw is the crawler's; a 3-hop redirect is followed and listed; a 6-hop loop → 508; an image → probe facts; 404 → `status: 404`, no throw; a hung target → 504 (timeout shortened by `env.UNFURL_TIMEOUT_MS`); Review Focus 4's addresses → 403 without `UNFURL_ALLOW_LOCAL`; `POST` → 405; missing `Sec-Fetch-Site: same-origin` → 403; `LIMIT.limit()` returning `{success: false}` → 429. Run: fails.
- [ ] Implement with `redirect: 'manual'` and a per-hop address check. Run: `ok`.

### Task 5: The page

**Files:** Create `misc/link-preview.html`.

**Interfaces — Consumes:** `LinkPreview` (Task 3), the Worker's three calls (Task 4).

- [ ] Layout: a bar (crumb, name, address field, "as" select of `LP.CRAWLERS`, Preview, dark/light, "paste source"); panel 01 PREVIEWS (a grid of the twelve cards, each with its notes); panel 02 CHECKS; panel 03 TAGS READ (key, value, which platforms used it). `?url=` in the address fills the field and runs, so a preview can be linked.
- [ ] Getting the page: same hostname → `fetch` it directly; otherwise the Worker; a 404 from `/api/unfurl` → one line saying the Worker is not deployed and how to deploy it, with paste-source still offered. Media facts the same way (`Range` request, `LP.sniff`).
- [ ] Every string from the fetched page goes in through `textContent` or `LP.esc`/`LP.md`; every address through `LP.safeUrl`; images get `referrerpolicy="no-referrer"`; videos `muted loop playsinline`, autoplay only on the Messages card.
- [ ] Check in headless Chrome against `dev.mjs`: the built front page's address gives twelve cards, the Discord card shows the component layout with the moving sweep, Messages shows the video, WhatsApp shows the large still, no `bad` checks; an address that 404s, an image address, and `not a link` each give one plain line; a test page whose title is `<img src=x onerror=window.__pwned=1>` leaves `window.__pwned` undefined.

### Task 6: Words and hand-over

**Files:** Modify `README.md` (sections "Social cards" and "The link preview tester"; a row in the Worker list).

- [ ] README: what the three files are and which platform uses which; `python3 .tools/social_card.py` and what it needs; the `DISCORD_EMBED` switch and Discord's Embed Debugger; where the tester's rules live and how to deploy the Worker.
- [ ] Run all three test commands and `python3 build.py`; copy the new and changed files into the slopswap working tree; show Kevin the still, the sweep and a screenshot of the tester.
