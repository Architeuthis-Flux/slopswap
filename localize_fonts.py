#!/usr/bin/env python3
"""Make a claude.ai artifact China-safe: swap its Google Fonts <link> for self-hosted @font-face rules.

    python3 localize_fonts.py <artifact.html> <project>/<name>.html

Downloads each family's latin woff2 into styles/fonts/ (once), writes the page with
`../styles/fonts/...` @font-face rules in place of the googleapis/gstatic links.
CJK families (Noto Sans SC etc.) are dropped: readers' system fonts cover them.
"""
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FONTS = ROOT / "styles" / "fonts"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
CJK = ("Noto Sans SC", "Noto Sans TC", "Noto Sans JP", "Noto Serif SC", "Noto Sans KR")


def fetch(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def font_faces(css_url: str, rel: str) -> str:
    """Download the latin faces a Google Fonts CSS URL serves; return @font-face rules using `rel` as the fonts dir."""
    q = urllib.parse.urlparse(css_url).query
    fams = [f for f in urllib.parse.parse_qs(q).get("family", []) if not f.split(":")[0].replace("+", " ") in CJK]
    if not fams:
        return ""
    url = "https://fonts.googleapis.com/css2?" + "&".join("family=" + f.replace(" ", "+") for f in fams) + "&display=swap"
    css = fetch(url).decode()
    rules, seen = [], {}
    for subset, body in re.findall(r"/\* (\w[\w-]*) \*/\s*@font-face \{(.*?)\}", css, re.S):
        if subset != "latin":
            continue
        fam = re.search(r"font-family: '([^']+)'", body).group(1)
        weight = re.search(r"font-weight: (\d+)", body).group(1)
        style = re.search(r"font-style: (\w+)", body).group(1)
        src = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", body).group(1)
        key = (fam, style, src)
        if key in seen:           # a variable font: one file serves every requested weight
            seen[key] = "100 900"
            continue
        seen[key] = weight
    for (fam, style, src), weight in seen.items():
        name = f"{fam.replace(' ', '')}-{'var' if ' ' in weight else weight}{'' if style == 'normal' else '-' + style}.woff2"
        if not (FONTS / name).exists():
            (FONTS / name).write_bytes(fetch(src))
            print("  downloaded", name)
        rules.append(f'@font-face{{font-family:"{fam}";font-style:{style};font-weight:{weight};font-display:swap;src:url({rel}{name}) format("woff2")}}')
    return "\n".join(rules)


def localize(src: Path, dst: Path) -> None:
    html = src.read_text()
    depth = len(dst.relative_to(ROOT).parts) - 1
    rel = "../" * depth + "styles/fonts/"
    html = re.sub(r'<link[^>]+rel="preconnect"[^>]+fonts\.gstatic\.com[^>]*>\s*', "", html)
    links = re.findall(r'<link[^>]+href="(https://fonts\.googleapis\.com/[^"]+)"[^>]*>', html)
    for href in links:
        rules = font_faces(href.replace("&amp;", "&"), rel)
        html = re.sub(r'<link[^>]+href="' + re.escape(href) + r'"[^>]*>', f"<style>\n/* self-hosted fonts: Google Fonts is blocked in China */\n{rules}\n</style>", html, count=1)
    bad = [u for u in re.findall(r'https?://[^"\' )>]+', html) if re.search(r"googleapis|gstatic|unpkg|jsdelivr|esm\.sh|tailwindcss\.com", u)]
    dst.write_text(html)
    print(f"wrote {dst.relative_to(ROOT)} ({len(html)//1024} KB)" + (f"; STILL EXTERNAL: {bad}" if bad else ""))


if __name__ == "__main__":
    localize(Path(sys.argv[1]), Path(sys.argv[2]).resolve())
