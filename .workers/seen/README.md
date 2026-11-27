# The site's visit counter

How many people see slopswap, which pages, for how long, and what they used there. `styles/seen.js` is on every page
(`build.py` adds it) and reports one line per page view when the visitor leaves; this Worker keeps the lines and
`misc/visitors.html` shows their sums. It answers on the site's own hostname: `https://slopswap.org/api/seen`
(Worker `slopswap-seen`; not deployed yet as of 2026-11-27). Until it is deployed the pages' reports go nowhere.

## What is kept, and what is not

For a page view: the day, the page, seconds really looked at (the page showing, and the visitor active in the last
minute), how far it was scrolled, the site the visitor came from, the country Cloudflare names, the window's width,
and the labels of the controls used with a count each ("Sweep, 3 times").

Not kept: any address, any cookie, anything in the visitor's browser, anything typed or chosen. People are told apart
only within a day, by a one-way hash of the day, the address, the browser's name and the server's key. The same friend
tomorrow counts as somebody new, and the hash cannot be turned back into an address. So "people" on the visitors page
means people per day, added up.

Not counted at all: a browser that asks not to be tracked (Global Privacy Control, Do Not Track), machines that read
pages (link previews, crawlers), and Kevin's own browser (the one that holds the key).

## What it answers

| Call | Answer |
|---|---|
| `POST /api/seen` with `{ v, page, secs, scroll, ref, wide, used }` | 204. The same `v` (one page view) sent again replaces its line as the view grows. |
| `GET /api/seen?days=30` with `Authorization: Bearer <key>` | `{ total, days, pages, used, refs, countries }` |

| Status | When |
|---|---|
| 400, 413 | Not a page view, or over 4 kB. |
| 401 | The key is missing or wrong (reports only). |
| 403 | A report that does not come from one of this site's own pages. |
| 429 | Over 60 reports a minute from one address. |
| 503 | No key is stored on the server. Nothing is kept until one is: the key also salts the hash. |

Anyone can post made-up views (a program can claim to be a page of this site); the limiter is what there is against
that. These are numbers for curiosity, not for billing.

## The key, running, deploying

One secret, `SEEN_KEY`, 24 characters or more. It is pasted once into `misc/visitors.html`, which keeps it in that
browser (and that browser then stops being counted). Make one, store it, and copy it to the clipboard:

```bash
cd .workers/seen && k=$(openssl rand -base64 32) && printf %s "$k" | wrangler secret put SEEN_KEY && printf %s "$k" | pbcopy
wrangler deploy                               # publishes the route (wrangler 4.36 or newer, for the limiter)
node test/seen.test.mjs                       # its answers, with Node's own SQLite standing in for D1: nothing installed
```

Changing the key later starts everybody's daily hash afresh; nothing else is lost. The table lives in the notebook's
database (`slopswap-notebook`), made by the Worker on its first request. To empty it:
`wrangler d1 execute slopswap-notebook --remote --command "DELETE FROM seen"`.
