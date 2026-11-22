#!/usr/bin/env python3
"""Build _site/ for slopswap.org.

Copies every project folder and styles/ into _site/, writes an index.html for each
project folder that does not have its own, and fills landing.html (the front page)
with the project list and the most recently updated pages.
Run locally:  python3 build.py && python3 -m http.server -d _site 8000
"""
import datetime
import html
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
SKIP = {"_site", "styles"}          # dotfolders (.git, .github) are skipped too
DEFAULT_THEME = "jumperless"
RECENT = "recent.json"            # written per folder: newest pages first, read by styles/splash.js
HEAD_BYTES = 8000                  # only the top of a file is scanned for <title> / stylesheet
DR_LOCK = '<meta name="darkreader-lock">'   # tells the Dark Reader extension to leave a page alone
LATEST = 6                         # pages in the front page's "recently updated" list
ARTICLE_BYTES = 20_000             # ponytail: an index.html bigger than this is an article, not a list of links,
                                   # and may appear under "recently updated"; add a <meta> marker if this misfires


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
    """Append ?v=<commit> to styles/*.css and styles/*.js references in the built HTML (Cloudflare caches them for hours)."""
    for p in folder.rglob("*.html"):
        s = p.read_text(errors="replace")
        s2 = re.sub(r'((?:href|src)="(?:\.\./)*styles/[\w-]+\.(?:css|js))"', rf'\1?v={v}"', s)
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
    for d in projects:
        shutil.copytree(d, OUT / d.name)
        (OUT / d.name / RECENT).write_text(json.dumps(recent(d), ensure_ascii=False, indent=0))
        name = d.name.replace("-", " ")
        if not (d / "index.html").exists():
            crumb = f'<p class="eyebrow"><a href="../">slopswap</a> / {html.escape(d.name)}</p>'
            (OUT / d.name / "index.html").write_text(
                page(name, theme_of(d), "../", f"{crumb}\n<h1>{html.escape(name)}</h1>\n{folder_index(d)}"))
        if theme_of(d) == DEFAULT_THEME:        # folders with their own branding (Del Mar) keep the site icon off
            add_icons(OUT / d.name, "../")

    (OUT / "index.html").write_text(landing([project(d) for d in projects]))
    add_icons(OUT, "")
    bust(OUT, version())
    locked = lock_dark_reader(OUT)
    print(f"built {len(projects)} project folders into {OUT.relative_to(ROOT)}/ ({locked} pages locked against Dark Reader)")


if __name__ == "__main__":
    main()
