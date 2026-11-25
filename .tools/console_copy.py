#!/usr/bin/env python3
"""The console look, copied out of styles/jumperless.css for a tool that must also open from disk.
   .tools/console_copy.py <file> [<file> ...]
A .css file is written whole. In an .html file the inside of its <style id="console-copy"> element is replaced.
The text between "console:begin" and "console:end" in the stylesheet stands alone. Change the look in
jumperless.css and run this again; never edit a copy."""
import re
import sys
from pathlib import Path

sheet = (Path(__file__).resolve().parent.parent / "styles" / "jumperless.css").read_text(encoding="utf-8")
m = re.search(r"/\* console:begin.*?/\* console:end \*/\n", sheet, re.S)
if not m:
    sys.exit("styles/jumperless.css has no console:begin ... console:end section")
COPY = ("/* A copy of the console look from slopswap's styles/jumperless.css, written by its\n"
        "   .tools/console_copy.py. Do not edit: change it there and copy again. */\n" + m.group(0))
for name in sys.argv[1:]:
    out = Path(name).expanduser()
    if out.suffix == ".css":
        out.write_text(COPY, encoding="utf-8")
    else:
        html = out.read_text(encoding="utf-8")
        new, n = re.subn(r'(<style id="console-copy">).*?(</style>)', lambda k: k.group(1) + "\n" + COPY + k.group(2), html, count=1, flags=re.S)
        if n != 1:
            sys.exit('%s has no <style id="console-copy"> element' % out)
        out.write_text(new, encoding="utf-8")
    print(out)
