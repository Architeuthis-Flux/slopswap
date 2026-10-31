#!/usr/bin/env python3
"""Build _site/ for slopswap.org.

Copies every project folder and styles/ into _site/, then writes an index.html
for the root and for each project folder that does not have its own.
Run locally:  python3 build.py && python3 -m http.server -d _site 8000
"""
import html
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
SKIP = {"_site", "styles"}          # dotfolders (.git, .github) are skipped too
DEFAULT_THEME = "jumperless"
HEAD_BYTES = 8000                  # only the top of a file is scanned for <title> / stylesheet


def head(p: Path) -> str:
    return p.read_text(errors="replace")[:HEAD_BYTES]


def title_of(p: Path) -> str:
    m = re.search(r"<title>(.*?)</title>", head(p), re.S | re.I)
    return html.unescape(m.group(1).strip()) if m else p.stem.replace("-", " ")


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
        f'<link rel="stylesheet" href="{css_prefix}styles/{theme}.css">\n'
        f'</head>\n<body>\n<main class="page">\n{body}\n</main>\n</body>\n</html>\n'
    )


def listing(folder: Path, href_prefix: str) -> str:
    items = []
    for p in sorted(folder.iterdir()):
        if p.name.startswith(".") or p.name == "index.html" or p.is_dir():
            continue
        if p.suffix == ".html":
            items.append(f'<li><a href="{href_prefix}{p.name}">{html.escape(title_of(p))}</a></li>')
        else:
            items.append(f'<li><a href="{href_prefix}{p.name}">{html.escape(p.name)}</a><small>{p.suffix[1:]}</small></li>')
    return "<ul class=\"docs\">\n" + "\n".join(items) + "\n</ul>" if items else "<p class=\"muted\">Nothing here yet.</p>"


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
        name = d.name.replace("-", " ")
        if not (d / "index.html").exists():
            crumb = f'<p class="eyebrow"><a href="../">slopswap</a> / {html.escape(d.name)}</p>'
            (OUT / d.name / "index.html").write_text(
                page(name, theme_of(d), "../", f"{crumb}\n<h1>{html.escape(name)}</h1>\n{listing(d, '')}"))
        # a folder with its own index curates itself: the root links it without listing its files
        files = "" if (d / "index.html").exists() else "\n" + listing(d, d.name + "/")
        sections.append(f'<h2><a href="{d.name}/">{html.escape(name)}</a></h2>{files}')

    (OUT / "index.html").write_text(page("slopswap", DEFAULT_THEME, "", "<h1>slopswap</h1>\n" + "\n".join(sections)))
    print(f"built {len(projects)} project folders into {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
