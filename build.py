#!/usr/bin/env python3
"""Build _site/ for slopswap.org.

Copies every project folder and styles/ into _site/, writes an index.html for each
project folder that does not have its own, and fills landing.html (the front page)
with the project list and the most recently updated pages.
Run locally:  python3 build.py && python3 -m http.server -d _site 8000
"""
import datetime
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
SKIP = {"_site", "styles", "__pycache__"}   # dotfolders (.git, .github) are skipped too
DEFAULT_THEME = "jumperless"
RECENT = "recent.json"            # written per folder: newest pages first, read by styles/splash.js
UNLISTED = ".unlisted"            # a folder holding this file is built as usual but left off the front page
HEAD_BYTES = 8000                  # only the top of a file is scanned for <title> / stylesheet
DR_LOCK = '<meta name="darkreader-lock">'   # tells the Dark Reader extension to leave a page alone
LATEST = 6                         # pages in the front page's "recently updated" list
ARTICLE_BYTES = 20_000             # ponytail: an index.html bigger than this is an article, not a list of links,
                                   # and may appear under "recently updated"; add a <meta> marker if this misfires
# Where the site answers: social tags need whole addresses. SLOPSWAP_AT=http://127.0.0.1:8788 builds a copy whose cards
# point at a local server (.workers/unfurl/dev.mjs), to look at them in the link preview tester before anything is pushed.
SITE = os.environ.get("SLOPSWAP_AT", "").rstrip("/") or "https://" + (ROOT / "CNAME").read_text().strip()
SITE_NAME = "slopswap"
ACCENT = "#f03060"                 # the theme's pink (--jl-accent): the stripe down the side of a Discord preview
CARD = {"image": "styles/social-card.png", "sweep": "styles/social-sweep.webp", "video": "styles/social-sweep.mp4", "w": 1200, "h": 630,
        "alt": "A rainbow Jumperless wordmark above a ridged circle whose picture changes with the viewing angle: a lenticular shirt print."}
DISCORD_EMBED = True               # False leaves Discord the plain tags (if its Embed Debugger turns the layout down)
DISCORD_BYTES = 3000               # the most Discord reads of a component embed
NOTEBOOK = "notebook.html"         # a folder holding this page has a notebook: the pages of the folder that tag themselves are its tabs
NOTEBOOK_VERSIONS = "notebook.json"   # written beside it: the version of every page of the folder, which an open notebook asks for
NOTEBOOK_OWN = "v6nb."             # the notebook's own names in a browser's storage (V6/notebook-sync.js): no page may claim one


def head(p: Path) -> str:
    return p.read_text(errors="replace")[:HEAD_BYTES]


def title_of(p: Path) -> str:
    m = re.search(r"<title>(.*?)</title>", head(p), re.S | re.I)
    return html.unescape(m.group(1).strip()) if m else p.stem.replace("-", " ")


def meta(p: Path, name: str) -> str:
    m = re.search(rf'<meta name="{name}" content="([^"]*)"', head(p))
    return html.unescape(m.group(1)) if m else ""


def added_on(p: Path) -> str:
    """Date the page was added to git (renames followed); file mtime for uncommitted pages."""
    try:
        out = subprocess.run(["git", "log", "--diff-filter=A", "--follow", "-1", "--format=%cs", "--", str(p)],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if out:
            return out
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return datetime.date.fromtimestamp(p.stat().st_mtime).isoformat()


def touched(p: Path) -> int:
    """Unix time of the last commit that touched a file or folder; mtime when it has no commit yet."""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", str(p)],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if out:
            return int(out)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return int(p.stat().st_mtime)


def day(ts: int, year: bool = True) -> str:
    d = datetime.date.fromtimestamp(ts)
    return f"{d.day} {d:%b}{f' {d.year}' if year else ''}".upper()


def into_head(s: str, tag: str) -> str:
    """Insert a tag after the charset declaration (which must stay first), else after <head>, else at the very top:
    some converted artifacts have no <head> tag and rely on the parser to imply one."""
    for anchor in (r"<meta\s+charset[^>]*>", r"<head[^>]*>"):
        s2 = re.sub(anchor, lambda m: m.group(0) + "\n" + tag, s, count=1, flags=re.I)
        if s2 != s:
            return s2
    return tag + "\n" + s


def recent(folder: Path) -> list:
    docs = [{"title": title_of(p), "short": meta(p, "short-title") or title_of(p), "href": p.name, "added": added_on(p)}
            for p in folder.glob("*.html") if p.name not in ("index.html", "index-cards-draft.html")]
    docs.sort(key=lambda d: d["title"])
    docs.sort(key=lambda d: d["added"], reverse=True)
    return docs


def theme_of(folder: Path) -> str:
    # ponytail: a folder's index takes the theme of the first doc in it; no config file
    for p in sorted(folder.glob("*.html")):
        m = re.search(r"styles/([\w-]+)\.css", head(p))
        if m:
            return m.group(1)
    return DEFAULT_THEME


def page(title: str, theme: str, css_prefix: str, body: str) -> str:
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{html.escape(title)}</title>\n"
        f'<link rel="stylesheet" href="{css_prefix}styles/{theme}.css?v={version()}">\n'
        f'</head>\n<body>\n<main class="page">\n{body}\n</main>\n</body>\n</html>\n'
    )


def size(n: int) -> str:
    return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{max(1, round(n / 1e3))} kB"


def role(name: str, texts: list) -> str:
    """How a folder's pages treat one of its files: 'loaded' (a page shows or fetches it),
    'linked' (a page links to it as a download), or '' (no page mentions it)."""
    names = [re.escape(n) for n in {name, quote(name)}]
    if any(re.search(rf"""src=["'](?:\./)?{n}["'?#]""", x) for n in names for x in texts):
        return "loaded"                     # an image that is also wrapped in a zoom link is still part of the page
    if any(re.search(rf"""href=["'](?:\./)?{n}["'?#]""", x) for n in names for x in texts):
        return "linked"
    return "loaded" if any(re.search(n, x) for n in names for x in texts) else ""


def folder_index(d: Path) -> str:
    """Body of the index build.py writes for a folder that has none: the pages first, as rows; then the files a
    visitor might want (linked from a page, or mentioned by none); then, folded away, the files pages only load."""
    esc = html.escape
    pages = sorted(d.glob("*.html"), key=lambda p: title_of(p).lower())
    texts = [p.read_text(errors="replace") for p in pages]
    files = sorted(p for p in d.iterdir() if p.is_file() and p.suffix != ".html" and not p.name.startswith(".") and p.name != RECENT)
    loaded = [p for p in files if role(p.name, texts) == "loaded"]
    wanted = [p for p in files if p not in loaded]

    def count(n: int, one: str, many: str) -> str:
        return f"{n} {one if n == 1 else many}"

    def file_list(group: list) -> str:
        return '<ul class="ix-files">\n' + "\n".join(
            f'  <li><a href="{quote(p.name)}">{esc(p.name)}</a><small>{esc(p.suffix[1:].upper() or "FILE")} · {size(p.stat().st_size)}</small></li>'
            for p in group) + "\n</ul>"

    out = []
    if pages:
        rows = "\n".join(
            f'  <li><h2><a href="{quote(p.name)}">{esc(title_of(p))}</a></h2><small>{day(touched(p))}</small>'
            + (f'<p>{esc(meta(p, "description"))}</p>' if meta(p, "description") else "") + "</li>" for p in pages)
        out.append(f'<p class="ix-label">{count(len(pages), "PAGE", "PAGES")}</p>\n<ul class="ix-rows stack cycle">\n{rows}\n</ul>')
    if wanted:
        out.append(f'<p class="ix-label">{count(len(wanted), "FILE", "FILES")}</p>\n{file_list(wanted)}')
    if loaded:
        where = "THE PAGE" if len(pages) == 1 else "THE PAGES"
        out.append(f'<details class="ix-more">\n<summary class="ix-label">{count(len(loaded), "MORE FILE", "MORE FILES")} USED INSIDE {where}</summary>\n'
                   f"{file_list(loaded)}\n</details>")
    return "\n".join(out) or '<p class="muted">Nothing here yet.</p>'


def version() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return datetime.datetime.now().strftime("%Y%m%d%H%M")


def bust(folder: Path, v: str) -> None:
    """Append ?v=<commit> to styles/*.css, styles/*.js and same-folder script references in the built HTML (Cloudflare caches them for hours)."""
    for p in folder.rglob("*.html"):
        s = p.read_text(errors="replace")
        s2 = re.sub(r'((?:href|src)="(?:\.\./)*styles/[\w-]+\.(?:css|js))"', rf'\1?v={v}"', s)
        s2 = re.sub(r'(<script src="[\w.-]+\.js)"', rf'\1?v={v}"', s2)     # a page's own shared script, next to it
        if s2 != s:
            p.write_text(s2)


def draws_itself_dark(s: str) -> bool:
    """True when a page has its own dark look: the Jumperless theme (dark only) or a dark palette of its own."""
    if re.search(r'<html[^>]*data-theme="light"', s):
        return False                # the page asked for the light look; let Dark Reader darken it
    if re.search(r"styles/jumperless\.css", s):
        return True
    return bool(re.search(r"prefers-color-scheme:\s*dark|color-scheme:\s*(?:light\s+)?dark", s))


def lock_dark_reader(folder: Path) -> int:
    """Add the Dark Reader lock to every built page that is already dark.

    Dark Reader re-colours a page by guessing what each CSS variable is for. On pages that are dark
    already it guesses wrong often enough to turn rainbow bars, coloured borders and SVG fills grey,
    so those pages opt out and keep their own colours. Light-only pages (the Del Mar theme) are left
    for Dark Reader to darken; check them with .tools/darkreader-audit.js after changing their colours.
    """
    n = 0
    for p in folder.rglob("*.html"):
        s = p.read_text(errors="replace")
        if "darkreader-lock" in s or not draws_itself_dark(s):
            continue
        p.write_text(into_head(s, DR_LOCK))
        n += 1
    return n


def add_icons(folder: Path, up: str) -> None:
    """Give every built page in a folder the site icon, unless the page names one of its own."""
    v = version()        # browsers hold on to tab icons; a new commit id makes them fetch again
    tag = (f'<link rel="icon" type="image/png" href="{up}styles/favicon.png?v={v}">\n'
           f'<link rel="apple-touch-icon" href="{up}styles/apple-touch-icon.png?v={v}">')
    for p in folder.glob("*.html"):
        s = p.read_text(errors="replace")
        if not re.search(r'rel="(?:shortcut )?icon"', s):
            p.write_text(into_head(s, tag))


def asset(rel: str) -> str:
    """The whole address of a file of the site, named by its contents, so a platform that keeps pictures for days
    fetches a new render and never an unchanged one."""
    return f"{SITE}/{rel}?v={hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()[:10]}"


def discord_embed(title: str, about: str, url: str, home: bool, picture: str = "", alt: str = "") -> str:
    """The page's preview as Discord lays it out from its own parts (a "component embed"): the page's name as a link,
    what it is, the sweep moving, and buttons. JSON for a script tag in the head; every "<" is written as \\u003c so
    no title can end the tag, and the description is cut to keep the whole under Discord's limit."""
    plain = lambda t: re.sub(r"([\\*_`~|\[\]()<>#])", r"\\\1", " ".join(t.split()))        # markdown marks, said as they are
    buttons = [{"type": 2, "style": 5, "label": "Open", "url": url}]
    if not home:
        buttons.append({"type": 2, "style": 5, "label": SITE_NAME, "url": SITE + "/"})
    head = ("" if home else f"-# {SITE_NAME}\n") + f"### [{plain(title[:120])}]({url})"
    words = about.split()
    while True:
        said = " ".join(words) + ("…" if words and len(words) < len(about.split()) else "")
        box = {"type": 17, "accent_color": int(ACCENT[1:], 16), "components": [
            {"type": 10, "content": head + ("\n" + plain(said) if said else "")},
            {"type": 12, "items": [{"media": {"url": asset(picture or CARD["sweep"])}, "description": alt or CARD["alt"]}]},
            {"type": 1, "components": buttons}]}
        text = json.dumps({"component": box}, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
        if len(text.encode()) <= DISCORD_BYTES or not words:
            return text
        words = words[:max(0, len(words) - max(1, len(words) // 8))]


def own_card(folder: Path, stem: str) -> dict | None:
    """The preview made for one page, on the page (styles/social.js publishes <page>-og.png, -og.webp, -og.mp4 and
    -og.json beside it): the file names, the still's size and its alt text; None for a page that has none."""
    still = next((folder / f"{stem}-og{ext}" for ext in (".png", ".jpg", ".webp") if (folder / f"{stem}-og{ext}").exists()), None)
    if not still:
        return None
    b = still.read_bytes()[:32]
    w, h = (int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")) if b[1:4] == b"PNG" else (CARD["w"], CARD["h"])
    name = lambda ext: f"{stem}-og{ext}" if (folder / f"{stem}-og{ext}").exists() else None
    try:
        alt = json.loads((folder / f"{stem}-og.json").read_text()).get("alt")
    except (OSError, ValueError):
        alt = None
    return {"image": still.name, "sweep": name(".webp") if still.suffix != ".webp" else None, "video": name(".mp4"), "w": w, "h": h, "alt": alt}


def with_maker(s: str, up: str) -> str:
    """The page with the preview maker's script in its head (styles/social.js: it shows itself only to a browser that
    holds the publishing token), once."""
    return s if re.search(r"<script[^>]+styles/social\.js", s) else into_head(s, f'<script defer src="{up}styles/social.js"></script>')


def with_seen(s: str, up: str) -> str:
    """The page with the visit counter's script in its head (styles/seen.js: what it reports, and what it never does,
    is at the top of that file), once."""
    return s if re.search(r"<script[^>]+styles/seen\.js", s) else into_head(s, f'<script defer src="{up}styles/seen.js"></script>')


def social_tags(s: str, url: str, home: bool, own: dict | None = None) -> str:
    """The tags that make a link to this page unfold with the site's card, or "" for a page that names a picture of
    its own. Three lanes: a still every platform can show (og:image), the sweep as a video that Messages plays by
    itself (og:video), and Discord's own layout with the sweep moving in it. A page keeps the title, description and
    card type it already declares."""
    end = re.search(r"</head>", s, re.I)
    top = s[:end.start()] if end else s[:HEAD_BYTES]
    if re.search(r"""property=["']og:image["']""", top):
        return ""
    has = lambda key: re.search(rf"""(?:property|name)=["']{key}["']""", top)
    said = lambda key: (lambda m: html.unescape(m.group(1)) if m else "")(re.search(rf"""<meta (?:property|name)=["']{key}["'] content="([^"]*)["]""", top))
    m = re.search(r"<title>(.*?)</title>", top, re.S | re.I)
    title = said("og:title") or (html.unescape(m.group(1).strip()) if m else SITE_NAME)
    about = said("og:description") or said("description")
    card = own or CARD                                    # the page's own preview, made on the page, or the site's
    kind = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[Path(card["image"]).suffix]
    esc = lambda t: html.escape(t, quote=True)
    tag = lambda key, value, attr="property": f'<meta {attr}="{key}" content="{esc(str(value))}">'
    out = []
    for key, value in (("og:type", "website"), ("og:site_name", SITE_NAME), ("og:title", title), ("og:description", about), ("og:url", url)):
        if value and not has(key):
            out.append(tag(key, value))
    out += [tag("og:image", asset(card["image"])), tag("og:image:type", kind), tag("og:image:width", card["w"]),
            tag("og:image:height", card["h"]), tag("og:image:alt", card["alt"] or title)]
    if card["video"]:
        out += [tag("og:video", asset(card["video"])), tag("og:video:secure_url", asset(card["video"])), tag("og:video:type", "video/mp4"),
                tag("og:video:width", card["w"]), tag("og:video:height", card["h"])]
    if not has("twitter:card"):
        out.append(tag("twitter:card", "summary_large_image", "name"))
    if not has("theme-color"):      # Discord takes its stripe from this; media="not all" keeps browsers from tinting their toolbar with it
        out.append(f'<meta name="theme-color" content="{ACCENT}" media="not all">')
    if DISCORD_EMBED:
        out.append(f'<script id="discord:component-embed" type="application/json">{discord_embed(title, about, url, home, card["sweep"] or card["image"], card["alt"] or title)}</script>')
    return "\n".join(out)


def add_social(folder: Path, at: str) -> int:
    """Give the built pages of a folder their social card (see social_tags) and the preview maker's script. `at` is
    the folder's place on the site: "" for the front page, "misc/" for a project. A page's own preview, if one was
    made for it, goes ahead of the site's card. Returns how many pages took a card."""
    n = 0
    for p in folder.glob("*.html"):
        s = p.read_text(errors="replace")
        home = not at and p.name == "index.html"
        own = own_card(folder, p.stem) if at else None
        if own:
            own = {**own, **{k: at + own[k] for k in ("image", "sweep", "video") if own[k]}}
        tags = social_tags(s, f"{SITE}/{at}" + ("" if p.name == "index.html" else quote(p.name)), home, own)
        s2 = with_maker(into_head(s, tags) if tags else s, "../" if at else "")
        if s2 != s:
            p.write_text(s2)
        n += bool(tags)
    return n


class TabTags(HTMLParser):
    """The <meta name="notebook-tab"> tags of a page's head, as their attributes."""
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "notebook-tab":
            self.found.append(a)


def notebook_tabs(folder: Path) -> tuple:
    """The tabs a folder's pages ask for in its notebook, and what was wrong with the tags that cannot be tabs.
    A page joins with one tag in its head for each tab:
        <meta name="notebook-tab" content="Lite cost" data-inner="tab-lite" data-keys="v6lite.v1" data-order="10">
    content is the tab's name; data-inner the id of a button of the page that the notebook presses to show that view
    (for a page with views of its own); data-keys the names the page keeps its design under in the browser's storage,
    which is what a notebook page saves and brings back; data-order where the tab goes, lower first, a tab without
    one after the rest by file name. Returns (tabs, wrong); a tab is {id, name, src, inner, keys}."""
    found, wrong = [], []
    for p in sorted(folder.glob("*.html")):
        if p.name == NOTEBOOK:
            continue
        s = p.read_text(errors="replace")
        end = re.search(r"</head>", s, re.I)
        top = s[:end.start()] if end else s[:HEAD_BYTES]
        if "notebook-tab" not in top:
            continue
        tags = TabTags()
        tags.feed(top)
        for i, a in enumerate(tags.found):
            name = " ".join((a.get("content") or "").split())
            if not name:
                wrong.append(f"{p.name}: a tab with no name")
                continue
            inner = a.get("data-inner") or None
            if inner and not re.fullmatch(r"[\w-]+", inner):
                wrong.append(f"{p.name}: {name!r} names {inner!r}, which is not an id, so the tab opens the page as it is")
                inner = None
            keys = (a.get("data-keys") or "").split()
            for k in [k for k in keys if k.startswith(NOTEBOOK_OWN) or len(k) > 120]:
                wrong.append(f"{p.name}: {name!r} may not keep {k!r}")
                keys.remove(k)
            try:
                order = float(a.get("data-order", ""))
            except ValueError:
                order = float("inf")
            found.append((order, p.name, i, {"id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "tab",
                                              "name": name, "src": p.name, "inner": inner, "keys": keys}))
    tabs = []
    for *_, tab in sorted(found, key=lambda f: f[:3]):
        if any(t["id"] == tab["id"] for t in tabs):
            wrong.append(f"{tab['src']}: a second tab named {tab['name']!r}")
        else:
            tabs.append(tab)
    return tabs, wrong


def page_version(p: Path, root: Path = ROOT) -> str:
    """A page's version, from what it is made of: its own file and the sheets and scripts of this site that it names.
    Not the commit: a push that leaves a page alone leaves its version alone, so an open notebook loads again only
    the tools that did change."""
    b = p.read_bytes()
    h = hashlib.sha256(b)
    for ref in sorted(set(re.findall(rb'(?:href|src)="([^"?#:]+\.(?:css|js))"', b))):
        f = (p.parent / ref.decode(errors="replace")).resolve()
        if f.is_file() and root.resolve() in f.parents:
            h.update(f.read_bytes())
    return h.hexdigest()[:10]


def with_notebook(s: str, tabs: list, v: str) -> str:
    """The notebook page with its tagged tabs and its own version in its head, where its script reads them. Every
    "<" of the list is written as \\u003c so that no tab's name can end the tag."""
    text = json.dumps(tabs, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return into_head(s, f'<meta name="notebook-version" content="{v}">\n<script type="application/json" id="notebook-tabs">{text}</script>')


def add_notebook(src: Path, out: Path, root: Path = ROOT) -> str | None:
    """A folder's notebook, built: its tabs put into the page, and the version of every page of the folder written
    beside it (notebook.json), which the open notebook asks for to load a tool again when a newer one is published.
    The notebook's own version covers its tab list, so a page that joins or leaves makes a new notebook. Returns a
    line to print, or None for a folder with no notebook."""
    if not (src / NOTEBOOK).exists():
        return None
    tabs, wrong = notebook_tabs(src)
    versions = {p.name: page_version(p, root) for p in sorted(src.glob("*.html"))}
    own = hashlib.sha256((versions[NOTEBOOK] + json.dumps(tabs, sort_keys=True)).encode()).hexdigest()[:10]
    (out / NOTEBOOK).write_text(with_notebook((out / NOTEBOOK).read_text(), tabs, own))
    (out / NOTEBOOK_VERSIONS).write_text(json.dumps({"self": own, "v": versions}, indent=0))
    said = f"{src.name} notebook: {len(tabs)} tagged tabs ({', '.join(t['name'] for t in tabs) or 'none'})"
    return said + "".join(f"\n  left out: {w}" for w in wrong)


def project(d: Path) -> dict:
    """What the front page shows for one folder: name, one line about it, its pages, when it last changed."""
    idx = d / "index.html"
    name = d.name.replace("-", " ")
    pages = sorted(d.glob("*.html"))
    moved = idx.exists() and 'http-equiv="refresh"' in head(idx)      # the folder only forwards somewhere else
    about = meta(idx, "description") if idx.exists() else ""
    if not about and idx.exists() and title_of(idx).lower() != name.lower():
        about = title_of(idx)
    if not about:
        about = " · ".join(title_of(p) for p in pages if p != idx)
    latest = [] if moved else [
        {"title": title_of(p), "href": f"{d.name}/" + ("" if p == idx else p.name), "in": name, "ts": touched(p)}
        for p in pages if p != idx or p.stat().st_size > ARTICLE_BYTES]
    # a folder is as new as its newest page; an edit to a plain index of links (or to an image) does not move it up
    ts = max((x["ts"] for x in latest), default=touched(d))
    return {"dir": d.name, "name": name, "about": about, "pages": len(pages), "moved": moved, "ts": ts, "latest": latest}


def landing(projects: list) -> str:
    """landing.html with its three placeholders filled."""
    esc = html.escape
    projects = sorted(projects, key=lambda p: p["ts"], reverse=True)
    rows = "\n".join(
        f'  <li><h2><a href="{p["dir"]}/">{esc(p["name"])}</a></h2><p>{esc(p["about"])}</p>'
        f'<small>{"MOVED" if p["moved"] else str(p["pages"]) + (" PAGE" if p["pages"] == 1 else " PAGES")} · {day(p["ts"])}</small></li>'
        for p in projects)
    pages = sorted((x for p in projects for x in p["latest"]), key=lambda x: x["ts"], reverse=True)[:LATEST]
    latest = "\n".join(
        f'      <li><a href="{x["href"]}">{esc(x["title"])}</a><small>{esc(x["in"]).upper()} · {day(x["ts"], year=False)}</small></li>'
        for x in pages)
    live = [p for p in projects if not p["moved"]]
    stats = f'{len(live)} PROJECTS · {sum(p["pages"] for p in live)} PAGES'
    out = (ROOT / "landing.html").read_text()
    for key, value in (("latest", latest), ("projects", rows), ("stats", stats)):
        assert out.count("{{" + key + "}}") == 1, f"landing.html needs exactly one {key} placeholder"
        out = out.replace("{{" + key + "}}", value)
    # the one check: every folder is linked and no placeholder is left behind
    assert "{{" not in out and all(f'href="{p["dir"]}/"' in out for p in projects), "landing.html did not fill"
    return out


def check() -> None:
    """The one self-check: role() tells a page's own images from the downloads it links and from stray files."""
    page = ['<a href="plate.jpg"><img src="plate.jpg"></a> <a href="print.pdf">get it</a> <script>fetch("data.json")</script>']
    got = [role(n, page) for n in ("plate.jpg", "print.pdf", "data.json", "orphan.zip")]
    assert got == ["loaded", "linked", "loaded", ""], got

    # social cards: a page with its own picture is left alone; any other gets the site's card, once
    url = SITE + "/misc/x.html"
    assert social_tags('<head><meta property="og:image" content="https://x/y.jpg"></head>', url, False) == ""
    bare = '<head><meta charset="utf-8"><title>A &amp; B</title><meta name="description" content="What it is."></head>'
    t = social_tags(bare, url, False)
    for want in ('property="og:image" content="' + SITE + '/styles/social-card.png?v=', 'property="og:image:width" content="1200"',
                 'property="og:image:height" content="630"', 'property="og:image:type" content="image/png"', 'property="og:image:alt"',
                 'property="og:video" content="' + SITE + '/styles/social-sweep.mp4?v=', 'property="og:video:secure_url"',
                 'property="og:video:type" content="video/mp4"', 'name="twitter:card" content="summary_large_image"',
                 'property="og:site_name" content="slopswap"', 'property="og:url" content="' + url + '"',
                 'property="og:title" content="A &amp; B"', 'property="og:description" content="What it is."',
                 'name="theme-color" content="' + ACCENT + '" media="not all"', 'id="discord:component-embed"'):
        assert want in t, want
    assert "twitter:image" not in t
    assert social_tags(bare.replace("<title>", '<meta property="og:title" content="Own"><title>'), url, False).count("og:title") == 0
    # Discord's layout: valid, small enough and unable to end its own script tag, whatever a page is called
    text = discord_embed('</script><b>*x*</b> [y](z) `q` _u_', "d " * 2500, url, False)
    box = json.loads(text)["component"]
    words, gallery, row = box["components"]
    assert box["type"] == 17 and box["accent_color"] == int(ACCENT[1:], 16) and len(text.encode()) <= 3000, len(text.encode())
    assert "</script" not in text and "<" not in text
    assert r"\*x\*" in words["content"] and r"\[y\]" in words["content"] and r"\_u\_" in words["content"] and r"\`q\`" in words["content"], words
    assert words["content"].startswith("-# slopswap\n### [") and "](" + url + ")" in words["content"]
    assert gallery["type"] == 12 and len(gallery["items"]) == 1 and "/styles/social-sweep.webp?v=" in gallery["items"][0]["media"]["url"]
    assert [sorted(b) for b in row["components"]] == [["label", "style", "type", "url"]] * 2 and all(b["style"] == 5 for b in row["components"])
    assert len(json.loads(discord_embed("slopswap", "About.", SITE + "/", True))["component"]["components"][2]["components"]) == 1
    # a preview made on the page (<page>-og.png and its companions, see styles/social.js) goes ahead of the site's card
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        assert own_card(d, "board") is None
        (d / "board-og.png").write_bytes(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" + (1200).to_bytes(4, "big") + (630).to_bytes(4, "big") + b"\x08\x06\0\0\0")
        assert own_card(d, "board") == {"image": "board-og.png", "sweep": None, "video": None, "w": 1200, "h": 630, "alt": None}
        (d / "board-og.webp").write_bytes(b"x"); (d / "board-og.mp4").write_bytes(b"x"); (d / "board-og.json").write_text('{"alt": "The board, turning."}')
        assert own_card(d, "board") == {"image": "board-og.png", "sweep": "board-og.webp", "video": "board-og.mp4", "w": 1200, "h": 630, "alt": "The board, turning."}
    mine = {"image": "styles/social-sweep.webp", "sweep": None, "video": None, "w": 960, "h": 504, "alt": None}      # a file that is there, standing in
    t = social_tags(bare, url, False, mine)
    for want in ('property="og:image" content="' + SITE + '/styles/social-sweep.webp?v=', 'property="og:image:type" content="image/webp"',
                 'property="og:image:width" content="960"', 'property="og:image:alt" content="A &amp; B"'):
        assert want in t, want
    assert "og:video" not in t and "social-card.png" not in t and t.count("social-sweep.webp?v=") == 2      # the still is also what Discord's layout shows
    assert social_tags(bare.replace("<title>", '<meta property="og:image" content="x"><title>'), url, False, mine) == ""
    # every page carries the maker's script, once
    once = with_maker(bare, "../")
    assert '<script defer src="../styles/social.js"></script>' in once and with_maker(once, "../") == once
    assert "<script defer" in with_maker(bare.replace("<title>", "<!-- see styles/social.js --><title>"), "../")      # a mention is not the script
    # and the visit counter's, every page of every folder
    counted = with_seen(bare, "../")
    assert '<script defer src="../styles/seen.js"></script>' in counted and with_seen(counted, "../") == counted and "social.js" not in counted


    # a notebook's tabs: the pages of its folder that tag themselves, in the order they ask for; a tag that cannot be
    # a tab is said and left out, and never stops the build
    with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as o:
        d, o = Path(d), Path(o)
        (d / NOTEBOOK).write_text('<head><meta charset="utf-8"><meta name="notebook-tab" content="Itself"><title>N</title></head>')
        (d / "b.html").write_text('<head><meta name="notebook-tab" content="Stack" data-keys="b.v1" data-order="30"></head>')
        (d / "a.html").write_text('<head>\n<meta data-order="10" data-keys="a.v1 a.v2 v6nb.key" data-inner="tab-one" content="One &amp; only" name="notebook-tab">\n'
                                  '<meta name="notebook-tab" content="Two" data-inner="tab two" data-order="20"><meta name="notebook-tab" content="stack">'
                                  '<meta name="notebook-tab" content=" "></head><body><meta name="notebook-tab" content="In the body"></body>')
        (d / "c.html").write_text('<head><meta name="notebook-tab" content="Last"></head>')
        tabs, wrong = notebook_tabs(d)
        assert tabs == [{"id": "one-only", "name": "One & only", "src": "a.html", "inner": "tab-one", "keys": ["a.v1", "a.v2"]},
                        {"id": "two", "name": "Two", "src": "a.html", "inner": None, "keys": []},
                        {"id": "stack", "name": "Stack", "src": "b.html", "inner": None, "keys": ["b.v1"]},
                        {"id": "last", "name": "Last", "src": "c.html", "inner": None, "keys": []}], tabs
        assert len(wrong) == 4, wrong          # the notebook's own name as a key, an inner with a space in it, a second "stack", a tab with no name
        # a page's version: its own file and the sheets and scripts of this site it names, so nothing else's change makes a new one
        (d / "s.css").write_text("a{}")
        (d / "p.html").write_text('<link rel="stylesheet" href="s.css"><script src="https://x.example/y.js"></script><script src="gone.js"></script>')
        v1 = page_version(d / "p.html", d)
        assert re.fullmatch(r"[0-9a-f]{10}", v1) and page_version(d / "p.html", d) == v1
        (d / "c.html").write_text("another page changed"); assert page_version(d / "p.html", d) == v1
        (d / "s.css").write_text("a{color:red}"); v2 = page_version(d / "p.html", d); assert v2 != v1
        (d / "p.html").write_text((d / "p.html").read_text() + " "); assert page_version(d / "p.html", d) not in (v1, v2)
        # the built notebook carries its tabs and its own version; the versions of the folder's pages go beside it
        shutil.copy(d / NOTEBOOK, o / NOTEBOOK)
        said = add_notebook(d, o, d)
        book, built = json.loads((o / NOTEBOOK_VERSIONS).read_text()), (o / NOTEBOOK).read_text()
        assert set(book["v"]) == {NOTEBOOK, "a.html", "b.html", "c.html", "p.html"} and book["v"]["p.html"] == page_version(d / "p.html", d)
        assert f'<meta name="notebook-version" content="{book["self"]}">' in built and built.index("charset") < built.index("notebook-version")
        assert [t["id"] for t in json.loads(re.search(r'id="notebook-tabs">(.*?)</script>', built).group(1))] == ["one-only", "two", "stack"], built
        assert "3 tagged tabs" in said and "left out" in said, said
        own = book["self"]; (d / "b.html").write_text('<head><meta name="notebook-tab" content="Stack renamed"></head>')
        shutil.copy(d / NOTEBOOK, o / NOTEBOOK); add_notebook(d, o, d)
        assert json.loads((o / NOTEBOOK_VERSIONS).read_text())["self"] != own          # a tab changed: the notebook itself is a new version
        (d / NOTEBOOK).unlink(); assert add_notebook(d, o, d) is None                  # a folder with no notebook gets nothing
    held = with_notebook('<head><meta charset="utf-8"></head>', [{"name": "</script><b>"}], "abc")
    assert "</script><b>" not in held and json.loads(re.search(r'id="notebook-tabs">(.*?)</script>', held).group(1)) == [{"name": "</script><b>"}]


def main() -> None:
    check()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copytree(ROOT / "styles", OUT / "styles")
    for name in ("CNAME", ".nojekyll"):
        if (ROOT / name).exists():
            shutil.copy(ROOT / name, OUT / name)

    projects = sorted(d for d in ROOT.iterdir()
                      if d.is_dir() and d.name not in SKIP and not d.name.startswith("."))
    carded = 0
    for d in projects:
        shutil.copytree(d, OUT / d.name, ignore=shutil.ignore_patterns(UNLISTED))
        (OUT / d.name / RECENT).write_text(json.dumps(recent(d), ensure_ascii=False, indent=0))
        if said := add_notebook(d, OUT / d.name):
            print(said)
        name = d.name.replace("-", " ")
        if not (d / "index.html").exists():
            crumb = f'<p class="eyebrow"><a href="../">slopswap</a> / {html.escape(d.name)}</p>'
            (OUT / d.name / "index.html").write_text(
                page(name, theme_of(d), "../", f"{crumb}\n<h1>{html.escape(name)}</h1>\n{folder_index(d)}"))
        if theme_of(d) == DEFAULT_THEME:        # folders with their own branding (Del Mar) keep the site's icon and card off
            add_icons(OUT / d.name, "../")
            carded += add_social(OUT / d.name, d.name + "/")

    listed = [d for d in projects if not (d / UNLISTED).exists()]
    (OUT / "index.html").write_text(landing([project(d) for d in listed]))
    add_icons(OUT, "")
    carded += add_social(OUT, "")
    for p in OUT.rglob("*.html"):            # every page of every folder is counted, Del Mar's too
        if len(p.relative_to(OUT).parts) <= 2:
            s = p.read_text(errors="replace")
            p.write_text(with_seen(s, "../" * (len(p.relative_to(OUT).parts) - 1)))
    bust(OUT, version())
    locked = lock_dark_reader(OUT)
    print(f"built {len(projects)} project folders into {OUT.relative_to(ROOT)}/ "
          f"({len(projects) - len(listed)} unlisted, {carded} pages given the social card, {locked} locked against Dark Reader)")


if __name__ == "__main__":
    main()
