#!/usr/bin/env python3
"""Build Crabbe Construction & Design's pages from content/*.json.

    python3 build.py <outdir>    write index.html, work.html and one page per project / page
    python3 build.py --test      self-check

Stdlib only. slopswap's build.py copies this folder into _site/ and then runs this with that copy
as <outdir>, so photos/, fonts/, site.css and site.js are already there. The editor at admin/
(Sveltia CMS) writes the JSON this reads.
"""
import datetime
import hashlib
import html
import json
import re
import sys
import tempfile
from pathlib import Path

SRC = Path(__file__).resolve().parent
RESERVED = {"index", "work"}       # page names the site itself uses


def esc(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=True)


def photo(path) -> str:
    """Stored image path -> relative URL, or "" if the file is gone (deleted in the editor but still
    listed somewhere), so a page never shows a broken image. The editor stores
    '/crabbe-construction/photos/x.webp'; keeping only the file name means the site still works
    when the folder moves to its own domain."""
    name = Path(str(path)).name if path else ""
    return "photos/" + name if name and (SRC / "photos" / name).exists() else ""


def paras(text) -> str:
    return "".join(f"<p>{esc(p.strip())}</p>" for p in re.split(r"\n\s*\n", str(text or "")) if p.strip())


def tel(phone) -> str:
    digits = re.sub(r"\D", "", str(phone))
    return "+1" + digits if len(digits) == 10 else "+" + digits


def slugify(name) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load(folder) -> list:
    """Entries of a collection, one JSON file each. A file that will not parse is skipped, not fatal:
    one bad save must not take the whole site (or the rest of slopswap's deploy) down."""
    out = []
    for p in sorted((SRC / "content" / folder).glob("*.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            print(f"crabbe: skipped {p.name}: {e}", file=sys.stderr)
            continue
        if isinstance(d, dict) and d.get("title") and slugify(p.stem):
            d["slug"] = slugify(p.stem)
            out.append(d)
    return out


def version() -> str:
    """Hash of the stylesheet and script, appended as ?v= because Cloudflare caches them for hours."""
    h = hashlib.sha1()
    for name in ("site.css", "site.js"):
        h.update((SRC / name).read_bytes())
    return h.hexdigest()[:8]


# ---------------------------------------------------------------- pieces

def contact(site) -> str:
    phone = site.get("phone")
    email = site.get("email")
    owner = site.get("owner")
    lines = []
    if phone:
        lines.append(f'<p class="label">Call us directly</p><a class="phone" href="tel:{tel(phone)}">{esc(phone)}</a>')
    if email:
        lines.append(f'<p class="label">Or write</p><a class="email" href="mailto:{esc(email)}">{esc(email)}</a>')
    signoff = f'<p class="signoff">Thank you,<br>{esc(owner)}</p>' if owner else ""
    return f"""<section id="contact" class="contact"><div class="wrap">
<p class="lead">{esc(site.get("contact_lead"))}</p>
<h2>Contact us</h2>
{"".join(lines)}
{signoff}
</div></section>"""


def layout(site, menu, title, desc, body, here="") -> str:
    name = site.get("name", "")
    phone = site.get("phone")
    links = [("work.html", "Work"), ("./#services", "Services"), ("./#about", "About")] + menu + [("#contact", "Contact")]
    nav = "".join('<a href="{}"{}>{}</a>'.format(esc(h), ' aria-current="page"' if h == here else "", esc(t))
                  for h, t in links)
    call = f'<a class="tel" href="tel:{tel(phone)}">{esc(phone)}</a>' if phone else ""
    v = version()
    # ponytail: noindex while this copy sits on slopswap next to the live constructioncrabbe.com;
    # delete the robots line when the site moves to Phil's own domain.
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="icon" href="logo-navy.png">
<link rel="preload" href="fonts/eb-garamond.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="site.css?v={v}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
<a class="brand" href="./"><img src="logo.svg" alt="" width="44" height="44"><span>{esc(name)}</span></a>
{call}
<nav aria-label="Main">{nav}</nav>
</div></header>
<main id="main">
{body}
{contact(site)}
</main>
<footer class="foot"><div class="wrap">
<img src="logo.svg" alt="" width="56" height="56">
<p>{esc(name)}<br>{esc(site.get("area"))}</p>
<p class="small">&copy; {datetime.date.today().year} {esc(name)}. All rights reserved. <a href="admin/">Owner login</a></p>
</div></footer>
<script src="site.js?v={v}" defer></script>
</body>
</html>
"""


def card(p) -> str:
    href = p["slug"] + ".html"
    img = f'<img src="{photo(p.get("cover"))}" alt="" loading="lazy">' if photo(p.get("cover")) else ""
    kind = f'<p class="label">{esc(p.get("kind"))}</p>' if p.get("kind") else ""
    return f"""<article class="card">
<a class="card-photo" href="{href}" tabindex="-1" aria-hidden="true">{img}</a>
<div class="card-text">
{kind}
<h3>{esc(p["title"])}</h3>
<span class="rule"></span>
<p>{esc(p.get("summary"))}</p>
<a class="btn" href="{href}" aria-label="View {esc(p["title"])}">View project</a>
</div>
</article>"""


def page_head(label, title, lede) -> str:
    label = f'<p class="label">{esc(label)}</p>' if label else ""
    lede = f'<p class="lede">{esc(lede)}</p>' if lede else ""
    return f'<header class="page-head"><div class="wrap">{label}<h1>{esc(title)}</h1>{lede}</div></header>'


def gallery(shots, title, start=1) -> str:
    shots = [s for s in shots if photo(s)]
    if not shots:
        return ""
    # ponytail: tiles load the full 1800px photo (lazily); add build-time thumbnails if galleries get slow
    items = "".join(f'<a class="zoom" href="{photo(s)}"><img src="{photo(s)}" alt="{esc(title)}, photo {i}" loading="lazy"></a>'
                    for i, s in enumerate(shots, start))
    return f'<div class="gallery">{items}</div>'


# ---------------------------------------------------------------- pages

def home(site, projects) -> str:
    name = site.get("name", "")
    head, amp, tail = name.partition(" & ")
    small = f"<small>&amp; {esc(tail)}</small>" if amp else ""
    phone = site.get("phone")
    call = f'<a class="btn" href="tel:{tel(phone)}">Call {esc(phone)}</a>' if phone else ""
    services = "".join(f'<div class="service"><h3>{esc(s.get("title"))}</h3>{paras(s.get("text"))}</div>'
                       for s in site.get("services") or [] if isinstance(s, dict))
    featured = [p for p in projects if p.get("featured", True)]
    owner = site.get("owner")
    by = f'<p class="by">{esc(owner)}</p>' if owner else ""
    portrait = ""
    if photo(site.get("portrait")):
        portrait = f'<figure class="portrait framed"><img src="{photo(site["portrait"])}" alt="{esc(owner)} at work" loading="lazy"></figure>'
    hero = f'<img src="{photo(site.get("hero_photo"))}" alt="" fetchpriority="high">' if photo(site.get("hero_photo")) else ""
    work = ""
    if featured:
        work = f"""<section class="work"><div class="wrap">
<header class="section-head"><p class="label">Recent</p><h2>Works</h2></header>
<div class="cards">{"".join(card(p) for p in featured)}</div>
<p class="more"><a class="btn" href="work.html">See portfolio</a></p>
</div></section>"""
    return f"""<section class="hero">
{hero}
<div class="wrap">
<h1>{esc(head)}{small}</h1>
<p class="lede">{esc(site.get("headline"))}</p>
<p class="actions"><a class="btn solid" href="work.html">See our work</a>{call}</p>
</div>
</section>
<section class="intro"><div class="wrap"><p>{esc(site.get("intro"))}</p></div></section>
<section id="services" class="services"><div class="wrap">
<p class="ghost" aria-hidden="true">Services</p>
<h2 class="label">Services</h2>
<div class="service-grid">{services}</div>
</div></section>
<section id="about" class="about"><div class="wrap about-grid">
<div class="philosophy"><h2 class="label">Philosophy</h2><blockquote><p>&ldquo;{esc(site.get("philosophy"))}&rdquo;</p></blockquote>{by}</div>
{portrait}
<div class="experience"><h2>{esc(site.get("about_title"))}</h2>{paras(site.get("about"))}</div>
</div></section>
{work}"""


def work_page(projects) -> str:
    return f"""{page_head("Portfolio", "Works", "")}
<section class="work plain"><div class="wrap"><div class="cards">{"".join(card(p) for p in projects)}</div></div></section>"""


def project_page(p, nxt) -> str:
    shots = [s for s in dict.fromkeys([p.get("cover")] + list(p.get("photos") or [])) if photo(s)]   # cover first, no repeats
    cover = ""
    if shots:
        cover = (f'<figure class="cover framed"><a class="zoom" href="{photo(shots[0])}">'
                 f'<img src="{photo(shots[0])}" alt="{esc(p["title"])}, photo 1"></a></figure>')
    body = f'<div class="prose">{p["body"]}</div>' if p.get("body") else ""      # HTML from the editor's rich text box
    following = f'<a href="{nxt["slug"]}.html">Next: {esc(nxt["title"])} &rarr;</a>' if nxt else ""
    return f"""{page_head(p.get("kind"), p["title"], p.get("summary"))}
<article class="project"><div class="wrap">
{cover}
{body}
{gallery(shots[1:], p["title"], 2)}
<nav class="pager" aria-label="More work"><a href="work.html">&larr; All work</a>{following}</nav>
</div></article>"""


def content_page(g) -> str:
    body = f'<div class="prose">{g["body"]}</div>' if g.get("body") else ""
    return f"""{page_head("", g["title"], g.get("intro"))}
<article class="project"><div class="wrap">
{body}
{gallery(list(g.get("photos") or []), g["title"])}
</div></article>"""


# ---------------------------------------------------------------- build

def broken_links(out: Path) -> list:
    """Local href/src targets in the built pages that do not exist."""
    bad = []
    for page in out.glob("*.html"):
        for ref in re.findall(r'(?:href|src)="([^"]+)"', page.read_text(encoding="utf-8")):
            ref = html.unescape(ref).split("#")[0].split("?")[0]
            if not ref or re.match(r"[a-z]+:", ref) or ref.startswith("//"):
                continue
            target = out / ref
            if not (target.exists() or (target / "index.html").exists() or (SRC / ref).exists()):
                bad.append(f"{page.name} -> {ref}")
    return bad


def build(out: Path) -> list:
    site = json.loads((SRC / "content" / "site.json").read_text(encoding="utf-8"))
    projects = sorted((p for p in load("projects") if p["slug"] not in RESERVED),      # never overwrite index/work
                      key=lambda p: (num(p.get("order")), p["title"].lower()))
    taken = RESERVED | {p["slug"] for p in projects}
    pages = []
    for g in load("pages"):
        if g["slug"] in taken:
            print(f'crabbe: page "{g["title"]}" skipped, its name is already used ({g["slug"]})', file=sys.stderr)
            continue
        taken.add(g["slug"])
        pages.append(g)
    menu = [(g["slug"] + ".html", g["title"]) for g in pages if g.get("menu", True)]
    name = site.get("name", "")
    out.mkdir(parents=True, exist_ok=True)

    def write(fname, title, desc, body):
        (out / fname).write_text(layout(site, menu, title, desc, body, here=fname), encoding="utf-8")

    write("index.html", name, site.get("intro"), home(site, projects))
    write("work.html", f"Works | {name}", f"Projects by {name}.", work_page(projects))
    for i, p in enumerate(projects):
        nxt = projects[(i + 1) % len(projects)] if len(projects) > 1 else None
        write(p["slug"] + ".html", f'{p["title"]} | {name}', p.get("summary") or p["title"], project_page(p, nxt))
    for g in pages:
        write(g["slug"] + ".html", f'{g["title"]} | {name}', g.get("intro") or g["title"], content_page(g))
    bad = broken_links(out)
    for b in bad:
        print("crabbe: missing file:", b, file=sys.stderr)
    print(f"crabbe: built {2 + len(projects) + len(pages)} pages ({len(projects)} projects, {len(pages)} pages)")
    return bad


def selftest() -> None:
    first = next(f.name for f in sorted((SRC / "photos").iterdir()) if f.is_file())
    assert photo("/crabbe-construction/photos/" + first) == "photos/" + first == photo(first)
    assert photo("photos/gone.webp") == "" and photo(None) == "" and photo("") == ""
    assert tel("(831) 220-2362") == "+18312202362" and tel("+1 831 220 2362") == "+18312202362"
    assert slugify("Connoly Deck & Fence") == "connoly-deck-fence"
    assert paras("a <b>\n\n c") == "<p>a &lt;b&gt;</p><p>c</p>" and paras(None) == ""
    assert num("2") == 2 and num(None) == 0 and num("x") == 0
    with tempfile.TemporaryDirectory() as tmp:
        bad = build(Path(tmp))
        assert not bad, bad
        assert 'href="work.html"' in (Path(tmp) / "index.html").read_text(encoding="utf-8")
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--test":
        selftest()
    else:
        build(Path(sys.argv[1]))
