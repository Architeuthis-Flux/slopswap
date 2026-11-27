# Social card and link preview tester: design

2026-11-27. Approved by Kevin in chat ("go ahead"); the tester page was asked for in the same message and its design below is Claude's call, not yet seen by him.

## Why

A slopswap link pasted into a chat should show something worth clicking: the lenticular shirt, moving where the chat can move it. And there should be one place to paste any link and see what each chat or feed will make of it, before sharing it.

## Part 1: the card

**Goal.** Every slopswap page without an image of its own unfurls with the lenticular shirt. Where the platform can animate, it sweeps; everywhere else it is a still that never fails to load.

**Non-goals.** A different card per page (a later job). Changing pages that already name an `og:image` (emf-badge, apex-electronics, Del Mar).

**Anti-goal.** A fallback that breaks: a platform showing no image because the file was too heavy or the wrong kind.

**Approaches considered.**
1. *Three lanes on one static page (picked).* A plain still as `og:image` for everyone; a looping MP4 as `og:video`, which Messages autoplays; a Discord component embed holding the animated WebP and link buttons. No infrastructure; the still is never at risk. A payload Discord rejects can blank its preview, so it needs one paste test.
2. *The animated file as `og:image`.* Simplest, but every other platform gets frame one of a heavy file and WhatsApp drops images over 600 KB.
3. *A Worker swapping the image per crawler.* Most control, and a Worker in front of every page for what lane 1 does without one.

**Decided by Kevin.**
- The sweep is the middle half of the viewer's Sweep: ±35° instead of ±70°.
- Approach 1.
- 1200×630, rendered by the viewer itself from the published art, shirt centred on the site charcoal, loupe crosshair hidden, no added text.
- Still at about 30° right (View A clean). Sweep eased like the Sweep button, about a 4 s loop.
- `build.py` gives the card to the front page and to every page with no image of its own; pages keep their own title and description; Del Mar is skipped.
- Discord: pink accent, site name.
- A re-runnable script in `.tools/`, a README section, nothing pushed before he has seen the still and the sweep.

**Changed by Kevin while it was being built (2026-11-27, 09:27 and 09:36).**
- Crop in and lay the shirt flat. The wordmark sits just above the middle and mostly fills the width; about a third of the circle may fall off the bottom. Then: lift it a little, so there is less empty space above the wordmark.
- The ground is see-through wherever nothing is printed. (So the still is a PNG, not a JPG; the sweep's WebP is see-through too; the MP4, which cannot be, sits on the site charcoal.)
- These replace "shirt centred on the site charcoal" above.

**Claude's calls.**
- Files: `styles/social-card.png`, `styles/social-sweep.webp`, `styles/social-sweep.mp4`, written by `.tools/social_card.py`. URLs carry a hash of the file so a new render is fetched and an unchanged one is not.
- The loop starts at +35° (next to the still's 30°) so the hand-over from still to motion is small.
- No `twitter:image`: X falls back to `og:image`, and a second image tag risks a two-picture gallery on Discord.
- `theme-color` is written with `media="not all"`: Discord reads the colour for its stripe, browsers skip the tag and keep their own toolbar colour.
- The Discord layout per page: site name, the page's title as a link, its description, the sweep, an "Open" button and (off the front page) a "slopswap" button. Built by `build.py`, checked to be under Discord's 3,000 bytes.
- One switch in `build.py` (`DISCORD_EMBED`) turns the Discord layout off if the paste test fails; the plain tags stay.

## Part 2: the link preview tester

**Goal.** `slopswap.org/misc/link-preview.html`: paste a link, see how each platform would show it, which tags each one read, and what each would reject.

**Non-goal.** Pixel-true copies of each app. The cards are drawn from each platform's documented rules where there are any and are labelled as approximations where there are not. No platform logos.

**The one real constraint.** A page cannot read another site's HTML (the browser forbids it), so something on a server has to fetch it.

**Approaches considered.**
1. *A small Worker on the site's own hostname (picked):* `slopswap.org/api/unfurl`, beside the notebook's. It fetches the top of a page as the chosen crawler would and hands back the text; the page does the reading. Works for any link; Kevin deploys it once with `wrangler deploy`.
2. *A public CORS proxy.* Nothing to deploy, but every pasted link goes through a stranger's server, and those are blocked in China.
3. *Paste the page source by hand.* Always works, and is kept as the fallback, but is not "paste a link".

**Claude's calls.**
- Until the Worker is deployed the page still reads slopswap's own pages (same hostname, no Worker needed), which is the first use: checking the new card.
- The Worker returns only the head of a document (to 400 kB) or the first 256 kB of a media file's facts (kind, size, dimensions, animated or not). It follows at most five redirects, refuses private and local addresses and anything but ports 80/443, answers only pages on its own hostname (`Sec-Fetch-Site: same-origin`), and is rate limited per address. Nothing fetched is ever run.
- Platforms drawn: Discord (standard, gallery, video and component embeds), Messages, Slack, X, WhatsApp, Facebook, LinkedIn, Telegram, Signal, Mastodon, Bluesky, Teams.
- The reading rules live in `misc/link-preview.js`, with no page code and no network, so `node .workers/unfurl/test/core.test.mjs` runs them as they are; the Worker uses the same file to tell what a media file is.
- Console look (`<html class="console">`), like the other tools.

## Left to the builder

Exact composition of the card inside 1200×630 (how much shirt shows at the sides), frame count and encoder settings, the mock cards' styling.

## Part 3: a preview made from the page itself (2026-11-27, 10:06; approved 10:16, Chrome)

**Asked for.** An option on any of these pages to make a new social preview (the V6 3D viewer, the stickers), with animations; and on the lenticular shirt viewer, a way to set the preview sweep's parameters.

**Approaches considered.**
1. *A shared maker in the browser, publishing as the viewer already does (picked).* `styles/social.js` on every page, shown only where the publishing token is kept. It photographs a canvas, a few of the page's pictures or a dropped file, frames it, and commits `<page>-og.png`, `-og.webp`, `-og.mp4` beside the page through the GitHub API. Chrome encodes the frames; the script only joins them.
2. *A script per page run on the Mac.* Nothing in the browser, but every page needs its own recipe and nothing can be framed by eye.
3. *Render in CI from a settings file.* No token in the browser, but a slow loop (push, wait, look) and a second pipeline to keep alive.

**Decided.**
- A page may hand the maker a driver, `window.socialPreview` (its settings, how to show the loop at position t, optionally the same view with nothing printed). The lenticular viewer has one: reach, still angle, flat or curved; its bare view makes the cut-out see-through, as the script's does.
- With no driver the maker records the canvas as it moves (the 3D viewer turning) or runs the chosen pictures as a slideshow.
- `build.py` uses a page's own `-og` files ahead of the site's card. On the front page and the lenticular viewer the maker can also publish the site's card itself.
- `.tools/social_card.py` stays as the headless way and reads the settings the maker published for the site's card (`styles/social-card.json`).

**Not in it.** Safari (cannot encode WebP frames). Pictures from other sites (the browser will not let a page read them back).

## Part 4: visits (2026-11-27, 11:31; approved 12:03)

**Asked for.** Some analytics: the site goes to friends; how many people see it, and what they spent time doing.

**Approaches considered.** Cloudflare's own Web Analytics (one switch, counts only, nothing on what was used). A counter of the site's own on the Worker and database already there (picked): both answers, nothing sent to a third party. A hosted service (a third party's script on every page, against the site's own rules for loading in China).

**Decided.** `styles/seen.js` on every page reports page, seconds really looked at, scroll, referrer, window width and the names of the controls used; `.workers/seen` keeps it in D1; `misc/visitors.html` shows the sums behind a key. No address, cookie or browser storage; people are told apart per day by a salted one-way hash. A line in the front page's footer says so.

**Claude's calls.** The table lives in the notebook's database rather than a second one (nothing to create; the Worker makes its table). Every folder is counted, Del Mar's too. Browsers that ask not to be tracked, machines, and the owner's own browser are not counted.
