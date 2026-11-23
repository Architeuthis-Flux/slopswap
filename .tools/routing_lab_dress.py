"""An exported routing-lab page (JumperlOS: python3 tools/routing_lab/lab.py export), dressed for slopswap.org.
   .tools/routing_lab_dress.py <export.html> <out.html> <title> <short title> <description>
Links the Jumperless theme, points the lab's own colour tokens at it, and names the page. The lab's layout stays."""
import sys
from pathlib import Path

src, out, title, short, about = sys.argv[1:6]
html = Path(src).read_text(encoding="utf-8")

OVERRIDE = """<style>
/* slopswap: the Jumperless theme's greys and fonts on the lab's own layout. Red still means a problem and nothing else. */
:root {
  --bg: var(--jl-bg, #27272b); --panel: var(--jl-surface, #323238); --line: var(--jl-line, #4b4b54);
  --ink: var(--jl-fg, #f3f3f5); --dim: var(--jl-muted, #aaaab5);
  --wire: #64646f; --chip: #2d2d32; --better: var(--jl-r8, #70f899); --worse: var(--jl-r11, #e8cb40); --changed: var(--jl-accent-2, #00fced);
  --head: var(--jl-surface-2, #3d3d44); --hover: #39393f; --sel: var(--jl-line, #4b4b54); --btn: var(--jl-surface-2, #3d3d44);
  --pad: #5a5a65; --tip: var(--jl-surface-2, #3d3d44);
}
body.app { padding: 5px 0 0; font-size: 13px; line-height: 1.35; font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace); }
main { height: calc(100vh - 5px); height: calc(100dvh - 5px); }
body.app h1 { font-size: 1.05rem; margin: 0 0 8px; }
body.app h2 { font-family: inherit; font-size: 12px; margin: 14px 0 4px; }
body.app p, body.app ul, body.app table, body.app pre { margin-bottom: 0; }
body.app th, body.app td { border-bottom: 0; vertical-align: baseline; }
body.app th { font-size: 12px; }
body.app pre { padding: 6px; line-height: 1.3; }
.eyebrow { margin: 0 0 6px; }
button, input, select { background: var(--bg); }
@media (max-width: 1200px) { main, main.ranking { height: auto; } }
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
