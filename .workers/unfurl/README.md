# The link preview tester's fetcher

`misc/link-preview.html` shows how a pasted link unfolds on each platform. A page cannot read another site's HTML (the
browser forbids it), so this Worker reads it and hands back text. It answers on the page's own hostname:
`https://slopswap.org/api/unfurl` (Worker `slopswap-unfurl`; not deployed yet as of 2026-11-27).

Until it is deployed the tester still works for slopswap's own pages, which it can read by itself, and for page source
pasted in by hand.

## What it answers

| Call | Answer |
|---|---|
| `GET /api/unfurl?url=<address>&as=<crawler>` | `{ url, final, status, hops, type, html, bytes, cut, ms, as }`: the top of the document, to `</head>` or 400 kB, asked for as that crawler asks |
| `GET /api/unfurl?probe=<address>&as=<crawler>` | `{ url, final, status, type, bytes, format, width, height, animated, ms }`: what a picture or video is, from its first 256 kB |
| `GET /api/unfurl?text=<address>` | `{ url, final, status, type, text }`: a small text file (oEmbed, a linked Discord layout), at most 64 kB |

`as` is one of the names in `CRAWLERS` in `misc/link-preview.js` (`discord` when left out). `status` inside the answer
is the far site's; the Worker's own status says whether it fetched at all:

| Status | When |
|---|---|
| 400 | Not a whole http or https address, or not exactly one of `url`, `probe`, `text`. |
| 403 | An address it will not fetch (below), or a caller that is not a page of this site. |
| 405 | Anything but GET. |
| 429 | Over 120 calls a minute from one visitor (a pasted link costs up to eight). |
| 502, 504 | The far site did not answer, or not within 8 seconds. |
| 508 | More than five redirects. |

## What keeps it from being anyone's proxy

- http and https only, on their own ports; no name and password in the address.
- Never a local or private address (`localhost`, `10.x`, `192.168.x`, `169.254.x`, IPv6 literals, `.local`, `.internal`
  and the rest), and every redirect is checked again before it is followed.
- Never this site's own `/api/`.
- Only the start of a file, and only as JSON: it cannot be used to serve somebody else's page.
- Only for a page of this site: the browser's `Sec-Fetch-Site: same-origin`, which a page on another site cannot forge.
  A program can send that header itself; what it gets is what it could have fetched directly, and the limiter.
- Nothing fetched is ever run, here or in the page (`misc/link-preview.js`: `esc`, `md`, `safeUrl`).

## Running, testing, deploying

```bash
node .workers/unfurl/test/core.test.mjs      # the reading rules: no network, nothing installed (python3 for one check)
node .workers/unfurl/test/worker.test.mjs    # this Worker's answers, against a server the test starts
python3 build.py && node .workers/unfurl/dev.mjs     # the site and the Worker on this machine: http://127.0.0.1:8788/misc/link-preview.html
cd .workers/unfurl && wrangler deploy        # publishes the route (wrangler 4.36 or newer, for the limiter)
```

`dev.mjs` and the tests set `UNFURL_ALLOW_LOCAL=yes`, which lets the Worker fetch from 127.0.0.1 and nothing else
local. It is not in `wrangler.jsonc` and must never be.
