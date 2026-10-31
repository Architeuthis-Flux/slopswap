#!/usr/bin/env python3
"""Publish a claude.ai artifact on slopswap: China-safe fonts, and (with --theme) the Jumperless look.

    python3 localize_fonts.py [--theme] <artifact.html> <project>/<name>.html

Always: downloads each Google Fonts family the page links as latin woff2 into styles/fonts/ (once)
and swaps the <link> for `../styles/fonts/...` @font-face rules. CJK families are dropped
(readers' system fonts cover them).

--theme: links ../styles/jumperless.css first, adds class="app" to <body> and a breadcrumb, and
appends an override block that points the artifact's own colour and font tokens (the common
names in THEME_MAP) at the theme's --jl-* aliases, using the artifact's own :root selectors so
its dark-mode blocks cannot win. Tokens the map does not know keep their values; tune by hand.
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
THEME_MAP = {  # artifact token → theme alias (only tokens the artifact actually declares are remapped)
    "--bg": "--jl-bg",
    "--surface": "--jl-surface", "--panel": "--jl-surface", "--card": "--jl-surface",
    "--surface-2": "--jl-surface-2", "--bg2": "--jl-surface-2", "--copper-soft": "--jl-surface-2", "--phone": "--jl-surface-2",
    "--fg": "--jl-fg", "--ink": "--jl-fg", "--text": "--jl-fg",
    "--muted": "--jl-muted", "--fg-2": "--jl-muted", "--mute": "--jl-muted",
    "--line": "--jl-line", "--ring": "--jl-line", "--grid": "--jl-line", "--axis": "--jl-line", "--phone-line": "--jl-line",
    "--accent": "--jl-accent", "--accent-ink": "--jl-bg", "--copper": "--jl-accent", "--hqb": "--jl-r12",
    "--font": "--jl-font-body", "--sans": "--jl-font-body", "--body": "--jl-font-body", "--font-body": "--jl-font-body",
    "--mono": "--jl-font-mono", "--font-mono": "--jl-font-mono",
    "--display": "--jl-font-display", "--font-display": "--jl-font-display",
    "--s1": "--jl-r1", "--s2": "--jl-r3", "--s3": "--jl-r4", "--s4": "--jl-r6", "--s5": "--jl-r7", "--s6": "--jl-r9", "--s7": "--jl-r10", "--s8": "--jl-r12",
    "--bar1": "--jl-r1", "--bar2": "--jl-r3", "--bar3": "--jl-r5", "--bar4": "--jl-r7", "--bar5": "--jl-r9", "--bar6": "--jl-r11",
}


def fetch(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def offline_faces(fams: list, rel: str) -> str | None:
    """@font-face rules from files already in styles/fonts/ (Family-400.woff2 or Family-var.woff2); None if any is missing."""
    rules = []
    for f in fams:
        name, _, spec = f.partition(":")
        fam = name.replace("+", " ")
        base = fam.replace(" ", "")
        weights = re.findall(r"\d{3}", spec) or ["400"]
        var = FONTS / f"{base}-var.woff2"
        if var.exists():
            rules.append(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:100 900;font-display:swap;src:url({rel}{var.name}) format("woff2")}}')
            continue
        for w in weights:
            file = FONTS / f"{base}-{w}.woff2"
            if not file.exists():
                return None
            rules.append(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{w};font-display:swap;src:url({rel}{file.name}) format("woff2")}}')
    return "\n".join(rules)


def font_faces(css_url: str, rel: str) -> str:
    """Download the latin faces a Google Fonts CSS URL serves; return @font-face rules using `rel` as the fonts dir."""
    q = urllib.parse.urlparse(css_url).query
    fams = [f for f in urllib.parse.parse_qs(q).get("family", []) if not f.split(":")[0].replace("+", " ") in CJK]
    if not fams:
        return ""
    offline = offline_faces(fams, rel)      # fonts already in styles/fonts/: no network needed
    if offline is not None:
        return offline
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


def themed(html: str, up: str, folder: str) -> str:
    """Link the Jumperless theme, mark the page as an app, add a breadcrumb, remap the artifact's tokens."""
    declared = set(re.findall(r"(--[\w-]+)\s*:", html))
    rules = "".join(f"{k}:var({v});" for k, v in THEME_MAP.items() if k in declared)
    override = ('<style>\n/* slopswap: the artifact\'s own tokens now point at the Jumperless theme */\n'
                f':root,:root:not([data-theme="light"]),:root[data-theme="dark"]{{{rules}}}\n</style>\n')
    html = re.sub(r"<body(\s[^>]*)?>", lambda m: f'<body class="app"{m.group(1) or ""}>\n'
                  f'<link rel="stylesheet" href="{up}styles/jumperless.css">\n'
                  f'<p class="eyebrow"><a href="{up}">slopswap</a> / <a href="./">{folder}</a></p>', html, count=1)
    return html.replace("</body>", override + "</body>", 1) if "</body>" in html else html + override


def localize(src: Path, dst: Path, theme: bool = False) -> None:
    html = src.read_text()
    depth = len(dst.relative_to(ROOT).parts) - 1
    rel = "../" * depth + "styles/fonts/"
    html = re.sub(r'<link[^>]+rel="preconnect"[^>]+fonts\.gstatic\.com[^>]*>\s*', "", html)
    links = re.findall(r'<link[^>]+href="(https://fonts\.googleapis\.com/[^"]+)"[^>]*>', html)
    for href in links:
        rules = font_faces(href.replace("&amp;", "&"), rel)
        html = re.sub(r'<link[^>]+href="' + re.escape(href) + r'"[^>]*>', f"<style>\n/* self-hosted fonts: Google Fonts is blocked in China */\n{rules}\n</style>", html, count=1)
    bad = [u for u in re.findall(r'https?://[^"\' )>]+', html) if re.search(r"googleapis|gstatic|unpkg|jsdelivr|esm\.sh|tailwindcss\.com", u)]
    if theme:
        html = themed(html, "../" * depth, dst.parent.name)
    dst.write_text(html)
    print(f"wrote {dst.relative_to(ROOT)} ({len(html)//1024} KB)" + (f"; STILL EXTERNAL: {bad}" if bad else ""))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    localize(Path(args[0]), Path(args[1]).resolve(), theme="--theme" in sys.argv)
