// node .workers/unfurl/test/core.test.mjs     the link preview tester's reading rules (misc/link-preview.js): no network,
// nothing installed. One thing needs python3: the Discord layout build.py writes is read here as Discord would read it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import LP from '../../../misc/link-preview.js';

const U = 'https://ex.org/a/b.html';
const page = (head) => LP.read('<!doctype html><html><head>' + head + '</head><body><meta property="og:title" content="in the body"></body></html>', U);
const card = (id, head, media = {}, extra = {}) => LP.resolve(id, page(head), media, extra);
const og = (k, v) => `<meta property="og:${k}" content="${v}">`;
const tw = (k, v) => `<meta name="twitter:${k}" content="${v}">`;
const IMG = 'https://ex.org/i.png', big = { [IMG]: { type: 'image/png', bytes: 90000, width: 1200, height: 630, animated: false, status: 200 } };

// ---- tags, written the ways real pages write them ----
let p = page(`<META CONTENT="T &amp; U" PROPERTY="og:title"><meta name='og:description' content='single &#39;q&#x27;'>
  <meta property=og:site_name content=Bare><meta property="og:url" value="https://ex.org/v"><meta property="og:image" content="/img/a.png">
  <title> Doc &lt;1&gt; </title><meta name="description" content="Plain."><link rel="shortcut icon" href="fav.png" sizes="32x32">
  <link rel="alternate" type="application/json+oembed" href="/oembed.json"><link rel="canonical" href="https://ex.org/canon">`);
assert.equal(LP.pick(p, ['og:title']), 'T & U');                         // content before property, upper-case attribute names
assert.equal(LP.pick(p, ['og:description']), "single 'q'");                // single quotes, numbered entities, name= for an og key
assert.equal(LP.pick(p, ['og:site_name']), 'Bare');                       // no quotes at all
assert.equal(LP.pick(p, ['og:url']), 'https://ex.org/v');                 // value= instead of content=
assert.equal(p.title, 'Doc <1>'); assert.equal(p.description, 'Plain.');
assert.deepEqual(p.icons.map((i) => [i.href, i.sizes]), [['https://ex.org/a/fav.png', '32x32']]);
assert.equal(p.oembed, 'https://ex.org/oembed.json'); assert.equal(p.canonical, 'https://ex.org/canon');
assert.equal(LP.pick(p, ['og:title', 'og:missing']), 'T & U');
assert.equal(LP.resolve('facebook', p, {}, {}).images[0], 'https://ex.org/img/a.png');      // addresses are made whole against the page's
// a key is name if there is one, else property; key names keep their case (Discord: case-sensitive)
p = page('<meta name="twitter:title" property="og:title" content="both"><meta property="OG:Title" content="shout">');
assert.equal(LP.pick(p, ['twitter:title']), 'both'); assert.equal(LP.pick(p, ['og:title']), '');
// what a crawler's parser never sees as a tag: comments, script and style text, anything after the head
p = page(`<!-- ${og('title', 'commented')} --><script>var s = '${og('title', 'in a script')}';</script><style>/* ${og('title', 'styled')} */</style>${og('title', 'real')}`);
assert.deepEqual(p.metas.filter((m) => m.key === 'og:title').map((m) => m.value), ['real']);
// where a tag sits, in bytes: WhatsApp reads only the first 300 kB
p = page('<!--' + 'é'.repeat(160000) + '-->' + og('title', 'late') + og('image', IMG));
assert.ok(p.metas[0].at > 320000, String(p.metas[0].at));
assert.ok(LP.checks(p, big, {}).some((c) => c.level === 'bad' && c.who.includes('whatsapp') && /300 kB/.test(c.text)));

// ---- Discord, by its own documentation ----
let c = card('discord', tw('title', '') + tw('title', 'Tw') + og('title', 'Og'));
assert.equal(c.title, 'Tw');                                              // the first tag that is not empty, of either name
c = card('discord', og('title', 't') + og('image', IMG) + tw('card', 'summary_large_image') + tw('card', 'summary'), big);
assert.equal(c.layout, 'small');                                          // the last layout tag wins
c = card('discord', og('title', 't') + og('image', IMG) + tw('card', 'summary') + tw('card', 'summary_large_image'), big);
assert.equal(c.layout, 'large'); assert.deepEqual(c.images, [IMG]);
c = card('discord', og('title', 't') + og('image', IMG) + tw('card', 'photo') + og('description', 'd'), big);
assert.deepEqual([c.layout, c.description], ['photo', '']);
c = card('discord', og('title', 't') + [1, 2, 3, 4, 5, 6].map((n) => og('image', `https://ex.org/${n}.png`)).join(''));
assert.equal(c.layout, 'gallery'); assert.equal(c.images.length, 4);     // two or more pictures: a gallery, at most four
c = card('discord', og('title', 't') + og('image', IMG) + og('video', 'https://ex.org/v.mp4'), big);
assert.equal(c.layout, 'small'); assert.equal(c.video, '');              // a video is not shown unless the page says it is one
c = card('discord', og('title', 't') + og('image', IMG) + og('video', 'https://ex.org/v.mp4') + og('type', 'video.other') + og('description', 'd'), big);
assert.deepEqual([c.layout, c.video, c.description], ['video', 'https://ex.org/v.mp4', '']);
c = card('discord', og('title', 't') + og('video', 'https://ex.org/v.mp4') + tw('card', 'player'));
assert.equal(c.layout, 'text');                                           // and not without a picture to stand as its first frame
c = card('discord', '<title>T</title><meta name="description" content="D">');
assert.deepEqual([c.layout, c.title, c.description], ['text', 'T', 'D']); // <title> and description: only as a pair,
c = card('discord', '<title>T</title><meta name="description" content="D">' + og('description', 'OD'));
assert.deepEqual([c.title, c.description], ['', 'OD']);                   // and only when there is no og or twitter text at all
c = card('discord', og('title', 'é'.repeat(50)) + og('description', 'x'.repeat(400)));
assert.ok(Buffer.byteLength(c.title) <= 70 && !c.title.includes('�') && c.title.startsWith('ééé'), c.title);
assert.ok(Buffer.byteLength(c.description) <= 350); assert.ok(c.notes.some((n) => /70 bytes/.test(n)));
c = card('discord', og('title', 't') + '<meta name="theme-color" content="red"><meta name="theme-color" content="#445566" media="not all">');
assert.equal(c.color, '#445566');
c = card('discord', og('title', 't') + '<meta name="theme-color" content="#445566"><meta name="theme-color" content="red">');
assert.equal(c.color, '');                                                // the last one wins, and it has to be #RRGGBB
c = card('discord', og('title', 't') + og('site_name', 'Site'), {}, { oembed: { author_name: 'Kev', provider_name: 'Prov' } });
assert.deepEqual([c.author, c.site], ['Kev', 'Prov']);
c = card('discord', og('title', 't') + og('image', IMG) + tw('card', 'summary_large_image'), { [IMG]: { ...big[IMG], animated: true, type: 'image/webp' } });
assert.equal(c.animates, true);

// ---- the others ----
c = card('imessage', og('title', 'T') + og('description', 'D') + og('image', IMG) + og('video', 'https://ex.org/v.mp4'), big);
assert.deepEqual([c.layout, c.video, c.animates, c.description, c.domain], ['video', 'https://ex.org/v.mp4', true, '', 'ex.org']);
c = card('imessage', og('title', 'T') + og('image', IMG) + og('video', 'https://www.youtube.com/embed/abc'), big);
assert.deepEqual([c.layout, c.animates], ['large', false]);              // only a file plays by itself
c = card('imessage', '<title>Only a title</title><link rel="apple-touch-icon" href="/t.png">');
assert.deepEqual([c.layout, c.title, c.images], ['small', 'Only a title', ['https://ex.org/t.png']]);
c = card('slack', og('title', 'T') + og('image', IMG) + tw('card', 'summary_large_image') + tw('label1', 'Updated') + tw('data1', '25 NOV') + tw('label2', 'Project') + tw('data2', 'V6'), big);
assert.deepEqual([c.layout, c.site, c.fields], ['large', 'ex.org', [['Updated', '25 NOV'], ['Project', 'V6']]]);
c = card('slack', og('title', 'T') + og('image', IMG), big); assert.equal(c.layout, 'small');
c = card('x', og('title', 'T') + og('image', IMG) + tw('image', 'https://ex.org/x.png') + tw('card', 'summary_large_image'),
    { 'https://ex.org/x.png': { ...big[IMG], animated: true } });
assert.deepEqual([c.layout, c.images, c.animates], ['large', ['https://ex.org/x.png'], false]);   // its own tag first; never moving
c = card('x', og('title', 'T') + og('image', IMG) + tw('card', 'summary'), big); assert.equal(c.layout, 'small');
const wa = (m) => card('whatsapp', og('title', 'T') + og('description', 'D') + og('image', IMG), { [IMG]: { ...big[IMG], ...m } });
assert.equal(wa({}).layout, 'large');
assert.equal(wa({ width: 200, height: 200 }).layout, 'small');           // under 300 px wide
assert.equal(wa({ width: 1500, height: 300 }).layout, 'small');          // wider than 4:1
c = wa({ bytes: 600001 }); assert.deepEqual([c.layout, c.images], ['text', []]);   // over 600 kB the picture is dropped
c = card('linkedin', og('title', 'T') + og('description', 'D') + og('image', IMG), big); assert.deepEqual([c.layout, c.description], ['large', '']);
c = card('mastodon', og('title', 'T') + og('image', IMG) + '<meta name="fediverse:creator" content="@kev@example.social">', big);
assert.deepEqual([c.layout, c.author], ['large', '@kev@example.social']);
c = card('teams', og('title', 'T') + og('image', IMG), big); assert.equal(c.layout, 'small');
for (const { id, name, source } of LP.PLATFORMS) {                        // every platform draws something for a bare page and for none
  assert.ok(name && ['docs', 'observed'].includes(source), id);
  assert.equal(card(id, '<title>Bare</title>').title, 'Bare', id);
  assert.ok(['text', 'none'].includes(card(id, '').layout), id);
}
assert.deepEqual(LP.PLATFORMS.map((x) => x.id), ['discord', 'imessage', 'slack', 'x', 'whatsapp', 'facebook', 'linkedin', 'telegram', 'signal', 'mastodon', 'bluesky', 'teams']);
assert.match(LP.CRAWLERS.discord.ua, /Discordbot\/2\.0/);

// ---- checks ----
const levels = (head, media = {}, extra = {}) => LP.checks(page(head), media, extra);
assert.ok(levels(og('title', 'T')).some((k) => k.level === 'warn' && /og:image/.test(k.text)));
assert.ok(levels(og('title', 'T') + og('image', IMG), { [IMG]: { ...big[IMG], bytes: 700000 } }).some((k) => k.level === 'bad' && k.who.includes('whatsapp')));
assert.ok(levels(og('title', 'T') + og('image', IMG), { [IMG]: { ...big[IMG], bytes: 6e6 } }).some((k) => k.level === 'bad' && k.who.includes('x')));
assert.ok(levels(og('title', 'T') + og('image', 'http://ex.org/i.png')).some((k) => k.level === 'bad' && /https/.test(k.text)));
assert.ok(levels(og('title', 'T') + og('image', IMG), { [IMG]: { ...big[IMG], status: 404 } }).some((k) => k.level === 'bad' && /404/.test(k.text)));
assert.ok(levels(og('title', 'T') + og('image', IMG) + og('video', 'https://ex.org/v.mp4'), { ...big, 'https://ex.org/v.mp4': { type: 'video/mp4', bytes: 11e6, status: 200 } })
  .some((k) => k.level === 'bad' && k.who.includes('imessage') && /10 MB/.test(k.text)));
assert.ok(levels(og('title', 'T') + og('image', IMG), big, { component: LP.component('{"component":{"type":3}}') }).some((k) => k.level === 'bad' && k.who.includes('discord')));
assert.ok(!levels(og('title', 'T') + og('description', 'D') + og('url', U) + og('image', IMG) + og('image:width', '1200') + og('image:height', '630') + tw('card', 'summary_large_image'), big).some((k) => k.level === 'bad'));

// ---- Discord's component embeds ----
const box = (components, more = {}) => JSON.stringify({ component: { type: 17, components, ...more } });
const btn = (more = {}) => ({ type: 1, components: [{ type: 2, style: 5, label: 'Open', url: 'https://ex.org/', ...more }] });
const item = (n) => ({ media: { url: `https://ex.org/${n}.webp` } });
let k = LP.component(box([{ type: 10, content: '# Hi' }, { type: 12, items: [item(1)] }, btn(), { type: 14, spacing: 1 },
  { type: 9, components: [{ type: 10, content: 'x' }], accessory: { type: 11, media: { url: 'https://ex.org/t.png' } } }], { accent_color: 5793266 }));
assert.deepEqual([k.ok, k.problems], [true, []]); assert.equal(k.tree.type, 17);
const no = (text, why) => { const r = LP.component(text); assert.equal(r.ok, false, why); assert.match(r.problems.join(' | '), why); };
no(box([{ type: 10, content: 'x'.repeat(3000) }]), /3,000 bytes/);
no('{"component":{"type":17,"components":[]},"also":1}', /beside/);
no('{"component":{"type":10,"content":"x"}}', /Container/);
no(box([{ type: 3, custom_id: 'a', options: [] }]), /type 3/);
no(box([btn({ custom_id: 'a' })]), /custom_id/);
no(box([btn({ style: 1 })]), /style 5/);
no(box([{ type: 1, components: [{ type: 2, style: 5, url: 'https://ex.org/' }] }]), /label/);
no(box([{ type: 12, items: Array.from({ length: 11 }, (_, n) => item(n)) }]), /10/);
no(box([{ type: 12, items: [{ media: { url: 'javascript:alert(1)' } }] }]), /http/);
no(box([{ type: 17, components: [] }]), /Container/);
no(box(Array.from({ length: 40 }, () => ({ type: 14 }))), /40/);
no('{nope', /JSON/);
const built = execFileSync('python3', ['-B', '-c', 'import build; print(build.discord_embed("A [b] *c*", "What it is.", build.SITE + "/misc/x.html", False))'],
  { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' }).trim();
k = LP.component(built); assert.deepEqual([k.ok, k.problems], [true, []]);     // what build.py writes is what Discord accepts
p = page(`<script id="discord:component-embed" type="application/json">${built}</script>` + '<link rel="discord:component-embed" type="application/json" href="/e.json">');
assert.equal(p.embed.inline, built); assert.equal(p.embed.href, 'https://ex.org/e.json');
c = card('discord', og('title', 't'), {}, { component: k }); assert.equal(c.layout, 'component'); assert.equal(c.tree.type, 17);

// ---- what a media file is, from its first bytes ----
const bytes = (...parts) => Uint8Array.from(parts.flatMap((x) => (typeof x === 'string' ? [...x].map((ch) => ch.charCodeAt(0)) : x)));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], le16 = (n) => [n & 255, n >> 8], le24 = (n) => [n & 255, (n >> 8) & 255, n >> 16];
const png = (extra) => bytes([137], 'PNG', [13, 10, 26, 10], be32(13), 'IHDR', be32(1200), be32(630), [8, 6, 0, 0, 0], be32(0), extra, be32(0), 'IDAT');
const F = (format, width, height, animated, alpha) => ({ format, width, height, animated, alpha });
assert.deepEqual(LP.sniff(png([])), F('png', 1200, 630, false, true));                                   // colour type 6: with alpha
assert.deepEqual(LP.sniff(png([...be32(8), ...bytes('acTL'), ...be32(5), ...be32(0), ...be32(0)])), F('png', 1200, 630, true, true));
const flat = png([]); flat[25] = 2; assert.equal(LP.sniff(flat).alpha, false);                           // colour type 2: none
const pal = png([...be32(1), ...bytes('tRNS'), 0, ...be32(0)]); pal[25] = 3; assert.equal(LP.sniff(pal).alpha, true);   // a palette with a clear entry
assert.deepEqual(LP.sniff(bytes('GIF89a', le16(320), le16(200), [0, 0, 0], [0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0])), F('gif', 320, 200, true, false));
assert.deepEqual(LP.sniff(bytes('GIF89a', le16(320), le16(200), [0, 0, 0], [0x2c])), F('gif', 320, 200, false, false));
assert.deepEqual(LP.sniff(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 11, 8], [630 >> 8, 630 & 255], [1200 >> 8, 1200 & 255], [3])), F('jpeg', 1200, 630, false, false));
assert.deepEqual(LP.sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0x02, 0, 0, 0], le24(1199), le24(629))), F('webp', 1200, 630, true, false));
assert.deepEqual(LP.sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0x12, 0, 0, 0], le24(959), le24(503))), F('webp', 960, 504, true, true));
assert.deepEqual(LP.sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ', [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(640), le16(480))), F('webp', 640, 480, false, false));
assert.deepEqual(LP.sniff(bytes(be32(24), 'ftypavis', be32(0), 'avifmsf1', be32(20), 'ispe', be32(0), be32(800), be32(400))), F('avif', 800, 400, true, false));
assert.deepEqual(LP.sniff(bytes(be32(20), 'ftypisom', be32(0), 'mp42', be32(92), 'tkhd', new Array(76).fill(0), be32(1200 << 16), be32(630 << 16))), F('mp4', 1200, 630, true, false));
assert.deepEqual(LP.sniff(bytes([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])), F('webm', 0, 0, true, false));
assert.deepEqual(LP.sniff(bytes('<!doctype html>')), F('', 0, 0, false, false));
assert.deepEqual(LP.sniff(new Uint8Array(0)), F('', 0, 0, false, false));
// a see-through picture is said to be one, where it matters
assert.ok(levels(og('title', 'T') + og('image', IMG), { [IMG]: { ...big[IMG], format: 'png', alpha: true } }).some((k) => /see-through/.test(k.text) && k.who.includes('whatsapp') && !k.who.includes('discord')));
assert.ok(card('x', og('title', 'T') + og('image', IMG) + tw('card', 'summary_large_image'), { [IMG]: { ...big[IMG], alpha: true } }).notes.some((n) => /see-through/.test(n)));
assert.ok(!card('discord', og('title', 'T') + og('image', IMG), { [IMG]: { ...big[IMG], alpha: true } }).notes.some((n) => /see-through/.test(n)));

// ---- nothing a fetched page says can become markup ----
assert.equal(LP.esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
assert.equal(LP.safeUrl('https://ex.org/a b'), 'https://ex.org/a%20b');
for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//ex.org/x', '/x', '', null, undefined]) assert.equal(LP.safeUrl(bad), '', String(bad));
let h = LP.md('<img src=x onerror=1> [a](javascript:alert(1)) **b** *i* `c<d` [ok](https://ex.org/?a=1&b=2)\n-# small\n### Head\n- one\n\\*not bold\\*');
assert.ok(!/<img|javascript:|onerror=1>/.test(h.replace(/&lt;img src=x onerror=1&gt;/, '')), h);
for (const want of ['&lt;img src=x onerror=1&gt;', '<strong>b</strong>', '<em>i</em>', '<code>c&lt;d</code>', '<a href="https://ex.org/?a=1&amp;b=2"', '<small>small</small>', '<h3>Head</h3>', '<li>one</li>', '*not bold*'])
  assert.ok(h.includes(want), want + '\n' + h);
assert.ok(!LP.md('[x](https://ex.org/"onmouseover="alert(1))').includes('"onmouseover'));

console.log('ok');
