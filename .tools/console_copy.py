#!/usr/bin/env python3
"""The console look, written out of styles/jumperless.css for a tool that must also open from disk.
   .tools/console_copy.py <out.css> [more.css ...]
The text between "console:begin" and "console:end" stands alone. Change the look in jumperless.css and run this
again; never edit a copy."""
import re
import sys
from pathlib import Path

sheet = (Path(__file__).resolve().parent.parent / "styles" / "jumperless.css").read_text(encoding="utf-8")
m = re.search(r"/\* console:begin.*?/\* console:end \*/\n", sheet, re.S)
if not m:
    sys.exit("styles/jumperless.css has no console:begin ... console:end section")
for out in sys.argv[1:]:
    Path(out).write_text("/* A copy of the console look from slopswap's styles/jumperless.css, written by its\n"
                         "   .tools/console_copy.py. Do not edit: change it there and copy again. */\n" + m.group(0), encoding="utf-8")
    print(out)
