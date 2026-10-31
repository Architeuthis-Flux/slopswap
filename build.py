#!/usr/bin/env python3
"""Build _site/ for slopswap.org.

Copies every project folder and styles/ into _site/, then writes an index.html
for the root and for each project folder that does not have its own.
Run locally:  python3 build.py && python3 -m http.server -d _site 8000
"""
import datetime
import html
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
SKIP = {"_site", "styles"}          # dotfolders (.git, .github) are skipped too
DEFAULT_THEME = "jumperless"
RECENT = "recent.json"            # written per folder: newest pages first, read by styles/splash.js
HEAD_BYTES = 8000                  # only the top of a file is scanned for <title> / stylesheet


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


def listing(folder: Path, href_prefix: str) -> str:
    items = []
    for p in sorted(folder.iterdir()):
        if p.name.startswith(".") or p.name in ("index.html", RECENT) or p.is_dir():
            continue
        if p.suffix == ".html":
            items.append(f'<li><a href="{href_prefix}{p.name}">{html.escape(title_of(p))}</a></li>')
        else:
            items.append(f'<li><a href="{href_prefix}{p.name}">{html.escape(p.name)}</a><small>{p.suffix[1:]}</small></li>')
    return "<ul class=\"docs\">\n" + "\n".join(items) + "\n</ul>" if items else "<p class=\"muted\">Nothing here yet.</p>"


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


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copytree(ROOT / "styles", OUT / "styles")
    for name in ("CNAME", ".nojekyll"):
        if (ROOT / name).exists():
            shutil.copy(ROOT / name, OUT / name)

    projects = sorted(d for d in ROOT.iterdir()
                      if d.is_dir() and d.name not in SKIP and not d.name.startswith("."))
    sections = []
    for d in projects:
        shutil.copytree(d, OUT / d.name)
        (OUT / d.name / RECENT).write_text(json.dumps(recent(d), ensure_ascii=False, indent=0))
        name = d.name.replace("-", " ")
        if not (d / "index.html").exists():
            crumb = f'<p class="eyebrow"><a href="../">slopswap</a> / {html.escape(d.name)}</p>'
            (OUT / d.name / "index.html").write_text(
                page(name, theme_of(d), "../", f"{crumb}\n<h1>{html.escape(name)}</h1>\n{listing(d, '')}"))
        # a folder with its own index curates itself: the root links it without listing its files
        files = "" if (d / "index.html").exists() else "\n" + listing(d, d.name + "/")
        sections.append(f'<h2><a href="{d.name}/">{html.escape(name)}</a></h2>{files}')

    bust(OUT, version())
    (OUT / "index.html").write_text(page("slopswap", DEFAULT_THEME, "",
        '<img class="logo" src="styles/jumperless-wordmark.png" alt="Jumperless">\n<h1>slopswap</h1>\n' + "\n".join(sections)))
    print(f"built {len(projects)} project folders into {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
