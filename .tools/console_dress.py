#!/usr/bin/env python3
"""A console-look tool that opens from disk, dressed for slopswap.org.
   .tools/console_dress.py <source.html> <folder>/<page>.html "<short title>" "<description>"
The source carries its own copy of the look in <style id="console-copy"> and a crumb in an element with id="crumb".
Here the copy is taken out and the site's stylesheet linked in its place (that is where the look is changed), the
crumb becomes the site's, and the page is named for the index. The routing lab has a script of its own
(routing_lab_dress.py), because its page is an export with a title to change."""
import re
import sys
from pathlib import Path

src, out, short, about = sys.argv[1:5]
out = Path(out)
folder = out.parent.name
html = Path(src).expanduser().read_text(encoding="utf-8")

def once(pattern, repl, text, what):
    new, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        sys.exit("%s: %s; this script must follow the source" % (src, what))
    return new

if 'class="console"' not in html.split("<head>")[0]:
    sys.exit("%s does not ask for the console look (<html class=\"console\">)" % src)
html = once(r'(?:<!--(?:(?!-->).)*console_copy\.py(?:(?!-->).)*-->\n)?<style id="console-copy">.*?</style>\n?',
            '<link rel="stylesheet" href="../styles/jumperless.css">\n', html, 'no <style id="console-copy"> element')
html = once(r"(<title>.*?</title>)", lambda m: '%s\n<meta name="short-title" content="%s">\n<meta name="description" content="%s">'
            % (m.group(1), short.replace('"', "&quot;"), about.replace('"', "&quot;")), html, "no <title>")
html = once(r'(<(\w+)[^>]*\bid="crumb"[^>]*>).*?(</\2>)',
            lambda m: '%s<a href="../">slopswap</a> / <a href="./">%s</a>%s' % (m.group(1), folder, m.group(3)), html, 'no element with id="crumb"')
home = str(Path.home())
if home in html:
    sys.exit("refusing to publish: the page holds %r" % home)
if re.search(r'(?:src|href)="https?://[^"]*(?:googleapis|gstatic|cdn|unpkg|jsdelivr)', html):
    sys.exit("refusing to publish: the page loads something from a CDN (blocked in China)")
out.write_text(html, encoding="utf-8")
print("%s: %d kB" % (out, len(html.encode()) // 1000))
