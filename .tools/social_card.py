#!/usr/bin/env python3
"""Render slopswap's social card from the lenticular shirt viewer.

    python3 .tools/social_card.py            render the three files into styles/
    python3 .tools/social_card.py --check    only check the files that are there

It opens lenticular-shirt/index.html in a headless Chrome, with whatever art is published beside it, lays the shirt
flat, closes the view in on the wordmark, walks the viewer's own angle slider and photographs the shirt canvas. Out come:

    styles/social-card.png     the still (30 degrees right, View A clean): og:image, what every platform can show
    styles/social-sweep.webp   the sweep, 35 degrees each way and back: the picture in Discord's own layout
    styles/social-sweep.mp4    the same sweep as a video: og:video, which Messages plays by itself and loops

The still and the sweep are see-through wherever nothing is printed: the viewer is photographed twice, once with the
art and once with empty pictures in its place, and what the two have in common (the cloth) is taken out. A video
cannot be see-through, so the MP4 sits on the site's charcoal.

build.py puts them on the pages (see README, "Social cards"). Run this again after publishing new art from the viewer.

Needs: pip install playwright pillow, a Chrome or Chromium that Playwright can start (an installed Google Chrome is
found by itself; CHROME=/path/to/chrome names another; `playwright install chromium` fetches one), and ffmpeg.
"""
import base64
import functools
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STILL = ROOT / "styles" / "social-card.png"
SWEEP = ROOT / "styles" / "social-sweep.webp"
VIDEO = ROOT / "styles" / "social-sweep.mp4"
W, H = 1200, 630
SWEEP_SIZE = (960, 504)            # the moving picture a little smaller: it is fifty see-through frames
GROUND = (0x27, 0x27, 0x2B)        # the site's charcoal, --jl-bg
STILL_AT = 30                      # degrees right: View A clean and near its brightest
HALF = 35                          # the sweep goes this far each way: the middle half of the viewer's own 70
FRAMES, FRAME_MS = 50, 80          # one there-and-back in 4 seconds
STILL_MOST = 300_000               # bytes; WhatsApp drops a preview image over 600 kB, so stay at half of it
ALL_MOST = 10_000_000              # Messages loads icon, image and video together only up to 10 MB
ART_FILE = re.compile(r"art-[0-9a-f]{16}\.(png|jpg|webp)")   # the published art beside the viewer (see README)
TEXT_FILL = 0.62                   # how much of the card's width the wordmark spans, seen straight on
TEXT_RAISE = 0.13                  # how far above the card's middle the wordmark's middle sits, as a part of the height


SETTINGS = ROOT / "styles" / "social-card.json"     # written when the site's card is published from the viewer (styles/social.js)


def settings() -> dict:
    """How the card is made: reach, still angle, flat or curved, the loop's seconds, and the framing. From the card
    last published from the viewer, where there is one; otherwise this file's own numbers and its own framing."""
    st = {"reach": HALF, "still": STILL_AT, "flat": True, "seconds": FRAMES * FRAME_MS / 1000, "framing": None}
    try:
        made = json.loads(SETTINGS.read_text())
    except (OSError, ValueError):
        return st
    st.update({k: v for k, v in (made.get("settings") or {}).items() if k in ("reach", "still", "flat")})
    if made.get("from") == "driver":
        st["seconds"], st["framing"] = made.get("seconds", st["seconds"]), made.get("framing")
    return st


def angles(reach: float = HALF, frames: int = FRAMES) -> list:
    """The loop: starts at +HALF (beside the still), eases to -HALF and back, as the viewer's Sweep button does."""
    return [round(reach * math.cos(2 * math.pi * k / frames) * 2) / 2 for k in range(frames)]


def check() -> list:
    """What is wrong with the three files, as a list of lines; empty when they are fit to publish."""
    bad = []
    for p in (STILL, SWEEP, VIDEO):
        if not p.exists():
            bad.append(f"{p.relative_to(ROOT)} is missing")
    if bad:
        return bad
    clear = lambda im: im.convert("RGBA").getchannel("A").getextrema()    # (0, 255): something clear and something solid
    with Image.open(STILL) as im:
        if im.size != (W, H) or im.format != "PNG":
            bad.append(f"the still is {im.format} {im.size}, not PNG {(W, H)}")
        if clear(im) != (0, 255) or im.convert("RGBA").getpixel((4, 4))[3] != 0:
            bad.append("the still should be see-through around the print and solid on it (all see-through means the viewer had no published art to take away)")
    if STILL.stat().st_size > STILL_MOST:
        bad.append(f"the still is {STILL.stat().st_size} bytes, over {STILL_MOST}")
    with Image.open(SWEEP) as im:
        n = getattr(im, "n_frames", 1)
        if im.size != SWEEP_SIZE or im.format != "WEBP":
            bad.append(f"the sweep is {im.format} {im.size}, not WEBP {SWEEP_SIZE}")
        if not 12 <= n <= 110:
            bad.append(f"the sweep has {n} frames, not 12 to 110")
        total = 0
        for i in range(n):
            im.seek(i)
            im.load()                                      # a frame's duration is only known once it is decoded
            total += im.info.get("duration", 0)
            if i in (0, n // 2) and clear(im) != (0, 255):
                bad.append(f"frame {i} of the sweep is not clear where nothing is printed")
        if not 1000 <= total <= 8500:
            bad.append(f"the sweep lasts {total} ms, not 1 to 8.5 s")
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(VIDEO)], capture_output=True, text=True, check=True).stdout)
    kinds = [s["codec_type"] for s in probe["streams"]]
    v = next((s for s in probe["streams"] if s["codec_type"] == "video"), {})
    if kinds != ["video"]:
        bad.append(f"the video's streams are {kinds}, not one video stream and no sound")
    if (v.get("codec_name"), v.get("pix_fmt"), v.get("width"), v.get("height")) != ("h264", "yuv420p", W, H):
        bad.append(f"the video is {v.get('codec_name')} {v.get('pix_fmt')} {v.get('width')}x{v.get('height')}, not h264 yuv420p {W}x{H}")
    together = sum(p.stat().st_size for p in (STILL, SWEEP, VIDEO)) + (ROOT / "styles" / "apple-touch-icon.png").stat().st_size
    if together > ALL_MOST:
        bad.append(f"icon, still, sweep and video are {together} bytes together, over {ALL_MOST}")
    return bad


def browser(p):
    """A Chrome that Playwright can start: the one CHROME names, an installed Google Chrome, or Playwright's own."""
    named = os.environ.get("CHROME") or next((c for c in ("/usr/bin/google-chrome", "/usr/bin/chromium") if os.path.exists(c)), None)
    if named:
        return p.chromium.launch(executable_path=named, args=["--no-sandbox"])
    try:
        return p.chromium.launch(channel="chrome")
    except Exception:
        return p.chromium.launch()


class Viewer:
    """The lenticular shirt viewer, open in a headless Chrome on a local copy of the site. It does all the drawing."""

    def __init__(self, blank: bool = False, flat: bool = True):
        self.blank = blank          # True: every published art file is answered with an empty picture, so the shirt is bare
        self.flat = flat            # True: no chest curve

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        blank = self.blank

        class Site(SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                name = self.path.split("?")[0].rsplit("/", 1)[-1]
                if not (blank and ART_FILE.fullmatch(name) and "/lenticular-shirt/" in self.path):
                    return super().do_GET()
                with Image.open(ROOT / "lenticular-shirt" / name) as im:
                    out = io.BytesIO()
                    Image.new("RGBA", im.size, (0, 0, 0, 0)).save(out, "PNG")
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(out.tell()))
                self.end_headers()
                self.wfile.write(out.getvalue())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Site, directory=str(ROOT)))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.pw = sync_playwright().start()
        self.browser = browser(self.pw)
        # twice the pixels of a 1700 px window: the viewer then draws its canvas at its largest, 1350 px
        page = self.page = self.browser.new_page(viewport={"width": 1700, "height": 1500}, device_scale_factor=2)
        page.goto(f"http://127.0.0.1:{self.server.server_address[1]}/lenticular-shirt/index.html")
        page.wait_for_function("window.__lent && window.__lent.art()")
        page.wait_for_load_state("networkidle")           # art.json and the published images beside the page
        # The shirt flat (no chest curve), the frames counted, and the loupe's mark left out: it is the one thing the
        # viewer strokes in this white on the shirt canvas, and the view is aimed with it, so it cannot be moved away.
        page.evaluate("""(flat) => { const L = window.__lent; if (flat) L.S.curve = 0; window.__drawn = 0; L.hooks.push(() => { window.__drawn++; });
            const ctx = document.getElementById('shirt').getContext('2d'), stroke = ctx.stroke;
            ctx.stroke = function () { if (this.strokeStyle !== 'rgba(255, 255, 255, 0.9)') return stroke.apply(this, arguments); }; }""", self.flat)
        last = None                                        # the art is in once two looks a moment apart are the same
        for _ in range(40):
            now = self._png(STILL_AT)
            if now == last:
                break
            last = now
            page.wait_for_timeout(500)
        return self

    def __exit__(self, *exc):
        self.browser.close()
        self.pw.stop()
        self.server.shutdown()

    def _png(self, a: float) -> str:
        n = self.page.evaluate("() => window.__drawn")
        self.page.evaluate("(a) => { const el = document.getElementById('angle'); el.value = a; el.dispatchEvent(new Event('input', { bubbles: true })); }", a)
        self.page.wait_for_function(f"window.__drawn > {n}")
        return self.page.evaluate("() => document.getElementById('shirt').toDataURL('image/png')")

    def shot(self, a: float) -> Image.Image:
        """The shirt canvas with the viewer standing `a` degrees to the right."""
        return Image.open(io.BytesIO(base64.b64decode(self._png(a).split(",", 1)[1]))).convert("RGBA")

    def view(self) -> dict:
        """The window the canvas shows: mm per pixel, and the mm at its middle (see mainView in the viewer)."""
        return self.page.evaluate("() => { const v = window.__lent.view(); return { mm: v.mmOut, x: v.sx, y: v.v, z: v.z }; }")

    def aim(self, u: float, v: float, zoom: float) -> None:
        """Close the view in `zoom` times on the point (u, v) of the shirt, in mm: the viewer keeps it there as it turns."""
        self.page.evaluate("([u, v, z]) => { const L = window.__lent; L.S.lu = u; L.S.lv = v; L.setZoom(z); }", [u, v, zoom])


def wordmark(shot: Image.Image) -> tuple:
    """Where the wordmark is in a straight-on shot, as (left, top, right, bottom) in pixels. It is the widest thing
    printed: the rows whose ink (strong colour, or the white outline) reaches nearly as far across as the widest row."""
    n = 450
    px = shot.resize((n, n), Image.BILINEAR).load()
    spans = {}
    for y in range(n):
        xs = [x for x in range(n) if px[x, y][3] > 250 and (max(px[x, y][:3]) - min(px[x, y][:3]) > 90 or sum(px[x, y][:3]) > 640)]
        if len(xs) > 6:
            spans[y] = (xs[0], xs[-1])
    widest = max(b - a for a, b in spans.values())
    rows = [y for y, (a, b) in spans.items() if b - a >= 0.6 * widest]
    k = shot.width / n
    return (min(spans[y][0] for y in rows) * k, rows[0] * k, (max(spans[y][1] for y in rows) + 1) * k, (rows[-1] + 1) * k)


def cut_out(shot: Image.Image, bare: Image.Image) -> Image.Image:
    """The print alone: `shot` made see-through wherever it is the same as `bare`, the same view of the shirt with
    nothing printed on it. The two are the same to the bit where nothing is printed, so a pixel is solid once it is
    6 levels from the bare shirt in any channel (black ink on black cloth is some 30 away)."""
    from PIL import ImageChops
    r, g, b = ImageChops.difference(shot.convert("RGB"), bare.convert("RGB")).split()
    far = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda d: min(255, d * 255 // 6))
    out = shot.convert("RGB")
    out.putalpha(ImageChops.darker(far, shot.getchannel("A")))
    return out


def palette(im: Image.Image, colours: int) -> Image.Image:
    """`im` in `colours` colours, the last of them see-through: a PNG a third the size. A palette has no half-clear
    entries here, so the print's edge is one or the other."""
    on = Image.new("RGB", im.size, (0, 0, 0))
    on.paste(im, (0, 0), im)
    q = on.quantize(colours - 1, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    q.putpalette((q.getpalette() or [])[:3 * (colours - 1)] + [0, 0, 0])
    q.paste(colours - 1, (0, 0), im.getchannel("A").point(lambda v: 255 if v < 128 else 0))
    return q


def compose(canvas: Image.Image, box: tuple, framing: dict | None = None) -> Image.Image:
    """The card: the part of the canvas in which the wordmark `box` spans TEXT_FILL of the width and sits TEXT_RAISE
    above the middle; or, with a `framing` published from the viewer (size, 1 filling the height, and a shift in card
    pixels), exactly what the preview maker framed. See-through stays see-through."""
    if framing:
        k = framing["zoom"] * H / canvas.height
        canvas = canvas.resize((round(canvas.width * k), round(canvas.height * k)), Image.LANCZOS)
        card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        card.paste(canvas, (round((W - canvas.width) / 2 + framing["x"]), round((H - canvas.height) / 2 + framing["y"])))
        return card
    s = TEXT_FILL * W / (box[2] - box[0])                  # 1, or next to it: the view was closed in to make it so
    if abs(s - 1) > 0.01:
        canvas = canvas.resize((round(canvas.width * s), round(canvas.height * s)), Image.LANCZOS)
    else:
        s = 1
    x = round((box[0] + box[2]) / 2 * s - W / 2)
    y = round((box[1] + box[3]) / 2 * s + TEXT_RAISE * H - H / 2)
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    card.paste(canvas, (-x, -y))
    return card


def make() -> None:
    st = settings()
    loop = angles(st["reach"], max(12, round(st["seconds"] * 1000 / FRAME_MS)))
    wanted = sorted(set(loop + [st["still"]]))
    with Viewer(flat=st["flat"]) as viewer:
        whole = viewer.shot(0)
        box, view = wordmark(whole), viewer.view()
        mm = lambda px, mid: mid + (px - whole.width / 2) * view["mm"]          # a canvas pixel as mm on the shirt
        zoom = max(1.0, TEXT_FILL * W / (box[2] - box[0]))                      # so that the canvas needs no scaling
        # aimed a little below the wordmark's middle, where the card's own middle will be
        aim = (mm((box[0] + box[2]) / 2, view["x"]), mm((box[1] + box[3]) / 2, view["y"]) + TEXT_RAISE * H / zoom * view["mm"], zoom)
        viewer.aim(*aim)
        box = wordmark(viewer.shot(0))
        shots = {a: viewer.shot(a) for a in wanted}
    with Viewer(blank=True, flat=st["flat"]) as viewer:    # the same views of the same shirt with nothing printed on it
        viewer.aim(*aim)
        bare = {a: viewer.shot(a) for a in wanted}
    cards = {a: compose(cut_out(shots[a], bare[a]), box, st["framing"]) for a in wanted}

    still = cards[st["still"]]
    still.save(STILL, "PNG", optimize=True)
    for colours in (256, 128, 64):                         # too heavy in full colour: a palette, as small as it has to be
        if STILL.stat().st_size <= STILL_MOST:
            break
        palette(still, colours).save(STILL, "PNG", optimize=True, transparency=colours - 1)
    frames = [cards[a].resize(SWEEP_SIZE, Image.LANCZOS) for a in loop]
    frames[0].save(SWEEP, "WEBP", save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, quality=64, alpha_quality=60, method=4)
    frames = [cards[a] for a in loop]
    with tempfile.TemporaryDirectory() as d:               # video has no see-through: on the site's charcoal. One loop: Messages repeats it
        for i, f in enumerate(frames):
            on = Image.new("RGB", (W, H), GROUND)
            on.paste(f, (0, 0), f)
            on.save(Path(d) / f"f{i:03d}.png")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(1000 / FRAME_MS), "-i", str(Path(d) / "f%03d.png"),
                        "-vf", "fps=25", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", "-an", str(VIDEO)], check=True)


def main() -> None:
    if "--check" not in sys.argv:
        make()
    bad = check()
    for line in bad:
        print("NOT OK:", line)
    if bad:
        sys.exit(1)
    print("ok:", ", ".join(f"{p.name} {p.stat().st_size // 1000} kB" for p in (STILL, SWEEP, VIDEO)))


if __name__ == "__main__":
    main()
