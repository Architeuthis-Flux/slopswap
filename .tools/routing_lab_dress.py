"""An exported routing-lab page (Jimulator: python3 Routing/lab.py export), dressed for slopswap.org.
   .tools/routing_lab_dress.py <export.html> <out.html> <title> <short title> <description>
Links the Jumperless stylesheet and names the page. The export carries its own copy of the console look so that it
opens anywhere; here that copy is taken out, because the stylesheet has the look and is where it is changed."""
import re
import sys
from pathlib import Path

src, out, title, short, about = sys.argv[1:6]
html = Path(src).read_text(encoding="utf-8")

OVERRIDE = """<style>
/* slopswap: room under the line that says where the page is */
.eyebrow { margin: 0 0 6px; }
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
html, cut = re.subn(r'<style id="console-copy">.*?</style>\n?', "", html, count=1, flags=re.S)
if cut != 1 or 'class="console"' not in html.split("<head>")[0]:
    raise SystemExit("the export no longer carries the console look as its own element; this script must follow it")
html = swap(html, "<h1>Routing lab</h1>",
            '<p class="eyebrow"><a href="../">slopswap</a> / <a href="./">V6</a></p>\n    <h1>%s</h1>' % title)
home = str(Path.home())
for bad in (home, "__LAB_TOKEN__", "LAB_TOKEN ="):
    if bad in html:
        raise SystemExit("refusing to publish: the page holds %r" % bad)
Path(out).write_text(html, encoding="utf-8")
print("%s: %.1f MB" % (out, len(html.encode()) / 1e6))
