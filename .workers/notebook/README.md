# The V6 notebook's account

`V6/notebook.html` keeps its pages in the browser. This Worker keeps one copy of them on Kevin's Cloudflare account,
so that every device he gives the key to shows the same pages. It answers on the page's own hostname:
`https://slopswap.org/api/notebook` (Worker `slopswap-notebook`, D1 database `slopswap-notebook`, deployed 2026-11-25).

## What it answers

Both calls need `Authorization: Bearer <key>`.

| Call | Answer |
|---|---|
| `GET /api/notebook` | `{ "rev": n, "notebook": {...} }`; `rev` 0 and `null` while there is none |
| `PUT /api/notebook` with `{ "base": n, "notebook": {...} }` | `{ "rev": n + 1 }` if the notebook is still at `base` |
| the same, when another device wrote since `base` | 409 with `{ "error", "rev", "notebook" }`: merge with that and try again |

| Status | When |
|---|---|
| 401 | The key is missing or wrong. |
| 503 | No key is stored on the server. Nothing is answered until one is. |
| 400, 413 | The body is not a notebook, or is over 1.5 MB (a page is about 12 kB). |
| 405 | Anything but GET and PUT. |

The notebook is one row: its JSON, and `rev`, which goes up by one with each write. A write is one SQL statement that
succeeds only if `rev` is still what the writer read, so two devices cannot write over each other. What is inside the
notebook is the page's business (`V6/notebook-sync.js`: how two sets of pages become one with nothing lost). Nothing
sent here is ever run.

There is no CORS, because the page is on the hostname this answers on, and no `workers.dev` address.

## The key

One secret on the Worker, `NOTEBOOK_KEY`, 24 characters or more. It is pasted into the notebook page once on each
device (the Sync button) and kept in that browser. Make one, store it, and copy it to the clipboard:

```bash
cd .workers/notebook && k=$(openssl rand -base64 32) && printf %s "$k" | wrangler secret put NOTEBOOK_KEY && printf %s "$k" | pbcopy
```

Run it again to replace the key; the old one stops working at once, and each device is asked for the new one.

A key kept in the browser for slopswap.org can be read by any page on that hostname, and some folders of this site
are edited by other people. The key keeps strangers out; what it guards is the notebook's pages (designs, not
secrets), and Export on the page is the way to keep a copy that nothing here can touch.

## Running, testing, deploying

Always from this folder (wrangler run from the home folder loses its login).

```bash
node test/merge.test.mjs                          # how pages merge: no network, nothing installed
python3 ../../build.py                            # the site, for the page to be served beside the Worker
printf 'NOTEBOOK_KEY=%s\n' "$(openssl rand -base64 32)" > .dev.vars     # a test key, ignored by git
wrangler d1 execute slopswap-notebook --local --file schema.sql
wrangler dev --assets ../../_site --port 8787 --ip 127.0.0.1           # the Worker and the site on this machine
node test.mjs http://127.0.0.1:8787               # the Worker's answers, against that
wrangler deploy                                   # publishes the route
```

Two devices can be tried on one machine: `http://localhost:8787/V6/notebook.html` and
`http://127.0.0.1:8787/V6/notebook.html` are two origins, each with its own storage.

The database was made once with `wrangler d1 create slopswap-notebook` and its table with
`wrangler d1 execute slopswap-notebook --remote --file schema.sql`. To look at what the account holds:
`wrangler d1 execute slopswap-notebook --remote --command "SELECT rev, length(body), t FROM notebook"`.
