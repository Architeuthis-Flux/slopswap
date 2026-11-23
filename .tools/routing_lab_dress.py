"""An exported routing-lab page (JumperlOS: python3 tools/routing_lab/lab.py export), dressed for slopswap.org.
   .tools/routing_lab_dress.py <export.html> <out.html> <title> <short title> <description>
Links the Jumperless theme, points the lab's own colour tokens at it, and names the page. The lab's layout stays."""
import sys
from pathlib import Path

src, out, title, short, about = sys.argv[1:6]
html = Path(src).read_text(encoding="utf-8")

OVERRIDE = """<style>
/* slopswap: this site's fonts for the lab's labels and numbers. The colours are the lab's own, under the --jl-* names
   the Jumperless stylesheet sets. The rest undoes what that stylesheet does to every page's plain tags. */
@font-face{font-family:"Archivo Narrow";src:url(../styles/fonts/ArchivoNarrow-var.woff2) format("woff2");font-weight:400 700;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(../styles/fonts/IBMPlexMono-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(../styles/fonts/IBMPlexMono-500.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(../styles/fonts/IBMPlexMono-600.woff2) format("woff2");font-weight:600;font-display:swap}
body.app { padding: 5px 0 0; font-size: 13px; line-height: 1.35; font-family: var(--mono); }
main { height: calc(100vh - 5px); height: calc(100dvh - 5px); }
body.app h1 { font-size: 14px; margin: 0 0 8px; }
body.app h2 { font-family: var(--label); font-size: 12px; margin: 14px 0 5px; }
body.app p, body.app ul, body.app table, body.app pre { margin-bottom: 0; }
body.app td { border-bottom: 0; vertical-align: baseline; }
body.app .battery th, body.app .bridges th { font-family: var(--label); font-size: 11px; background: var(--panel); vertical-align: baseline; }
body.app .bridges th { background: none; }
body.app pre { padding: 6px; line-height: 1.3; }
.eyebrow { margin: 0 0 6px; }
@media (max-width: 1200px) { main { height: auto; } }
</style>
"""

def swap(text, old, new):
    if old not in text:
        raise SystemExit("the export no longer has %r" % old)
    return text.replace(old, new, 1)

html = swap(html, "<title>Routing lab</title>",
            '<title>%s</title>\n<meta name="short-title" content="%s">\n<meta name="description" content="%s">\n'
            '<link rel="stylesheet" href="../styles/jumperless.css">' % (title, short, about))
html = swap(html, "</head>", OVERRIDE + "</head>")
html = swap(html, "<body>", '<body class="app">')
html = swap(html, "<h1>Routing lab</h1>",
            '<p class="eyebrow"><a href="../">slopswap</a> / <a href="./">routing-lab</a></p>\n    <h1>%s</h1>' % title)
home = str(Path.home())
for bad in (home, "__LAB_TOKEN__", "LAB_TOKEN ="):
    if bad in html:
        raise SystemExit("refusing to publish: the page holds %r" % bad)
Path(out).write_text(html, encoding="utf-8")
print("%s: %.1f MB" % (out, len(html.encode()) / 1e6))
