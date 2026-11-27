// The link preview tester's reading rules: what each platform makes of a page's tags when a link to it is pasted.
// No page code and no network here, so `node .workers/unfurl/test/core.test.mjs` runs it as it is; the page
// (misc/link-preview.html) and the fetch Worker (.workers/unfurl) both use this one file.
//
// A crawler does not run a page: it reads the tags in its head. read() does the same with a scanner (no DOM), keeping
// each tag in the order and at the byte it was found. resolve() then applies one platform's rules and returns what
// that platform would draw. Rules marked 'docs' follow the platform's own documentation (Discord's link preview
// pages, Apple's Messages talk, Meta's WhatsApp page, Slack's unfurling notes, X's card docs); rules marked
// 'observed' are how those cards look today and may drift. Nothing read from a page is ever run, and everything that
// reaches markup goes through esc(), md() or safeUrl().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PLATFORMS = [
    { id: 'discord', name: 'Discord', source: 'docs' }, { id: 'imessage', name: 'Messages', source: 'docs' },
    { id: 'slack', name: 'Slack', source: 'docs' }, { id: 'x', name: 'X', source: 'docs' },
    { id: 'whatsapp', name: 'WhatsApp', source: 'docs' }, { id: 'facebook', name: 'Facebook', source: 'observed' },
    { id: 'linkedin', name: 'LinkedIn', source: 'observed' }, { id: 'telegram', name: 'Telegram', source: 'observed' },
    { id: 'signal', name: 'Signal', source: 'observed' }, { id: 'mastodon', name: 'Mastodon', source: 'observed' },
    { id: 'bluesky', name: 'Bluesky', source: 'observed' }, { id: 'teams', name: 'Teams', source: 'observed' }];

  // Who asks for the page. Some sites answer each of these differently, so the tester can ask as any of them.
  const CRAWLERS = {
    discord: { name: 'Discord', ua: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
    imessage: { name: 'Messages', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0' },
    slack: { name: 'Slack', ua: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' },
    x: { name: 'X', ua: 'Twitterbot/1.0' },
    whatsapp: { name: 'WhatsApp', ua: 'WhatsApp/2.23.20.0 A' },
    facebook: { name: 'Facebook', ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
    linkedin: { name: 'LinkedIn', ua: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)' },
    telegram: { name: 'Telegram', ua: 'TelegramBot (like TwitterBot)' },
    mastodon: { name: 'Mastodon', ua: 'Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.social/)' },
    bluesky: { name: 'Bluesky', ua: 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)' },
    browser: { name: 'a browser', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' } };

  // ---- words ----
  const enc = new TextEncoder();
  const blen = (s) => enc.encode(s).length;
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  function unent(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] !== '#') return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (x) { return m; }
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  // An address that may be loaded or linked: whole, and http or https. Anything else is ''.
  function safeUrl(s) {
    if (typeof s !== 'string') return '';
    let u; try { u = new URL(s.trim()); } catch (e) { return ''; }
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  }
  function abs(u, base) { if (!u) return ''; try { return safeUrl(new URL(String(u).trim(), base).href); } catch (e) { return ''; } }
  function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function cut(s, most) {                                   // at most `most` bytes, never through the middle of a letter
    let n = 0, out = '';
    for (const ch of String(s)) { n += blen(ch); if (n > most) break; out += ch; }
    return out;
  }
  const kB = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1000)) + ' kB');

  // Discord's markdown, the part a preview uses, as HTML in which nothing but these few tags can appear.
  function md(src) {
    const kept = [], stash = (h) => { kept.push(h); return '\uE000' + (kept.length - 1) + '\uE001'; };
    let t = String(src == null ? '' : src).replace(/[\uE000\uE001]/g, '');
    t = t.replace(/\\([\\*_`~|\[\]()<>#-])/g, (m, ch) => stash(esc(ch)));
    t = t.replace(/`([^`\n]+)`/g, (m, code) => stash('<code>' + esc(code) + '</code>'));
    t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      const u = safeUrl(url);
      return u ? stash('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">') + label + stash('</a>') : label;
    });
    t = esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/gm, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/gm, '$1<em>$2</em>');
    const lines = t.split('\n').map(function (line) {
      let m;
      if ((m = /^(#{1,3}) (.*)$/.exec(line))) return '<h' + m[1].length + '>' + m[2] + '</h' + m[1].length + '>';
      if ((m = /^-# (.*)$/.exec(line))) return '<small>' + m[1] + '</small>';
      if ((m = /^[-*] (.*)$/.exec(line))) return '<li>' + m[1] + '</li>';
      return line;
    });
    let out = '';
    lines.forEach(function (line, i) { out += line + (i < lines.length - 1 && !/^<(h\d|small|li)>/.test(line) && !/^<(h\d|small|li)>/.test(lines[i + 1]) ? '<br>' : ''); });
    return out.replace(/\uE000(\d+)\uE001/g, (m, i) => kept[+i]);
  }

  // ---- reading a page's head ----
  function attrsOf(text) {
    const a = {}, re = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
    let m;
    while ((m = re.exec(text))) { const k = m[1].toLowerCase(); if (!(k in a)) a[k] = unent(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || ''); }
    return a;
  }
  function read(html, base) {
    html = String(html || '');
    const lower = html.toLowerCase();
    let end = lower.indexOf('</head'); if (end < 0) end = lower.indexOf('<body'); if (end < 0) end = html.length;
    const blank = (m) => ' '.repeat(m.length), embed = { inline: null, href: null };
    // comments and the text of scripts, styles and templates are not tags: blanked, with every offset kept
    let head = html.slice(0, end).replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
    head = head.replace(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/script\s*>|$)/gi, function (m, attrs, body) {
      if (attrsOf(attrs).id === 'discord:component-embed' && embed.inline === null) embed.inline = body.trim();
      return blank(m);
    });
    head = head.replace(/<(style|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, blank);
    const page = { url: base, base: base, metas: [], title: '', description: '', icons: [], oembed: '', canonical: '', embed: embed, headEnd: blen(html.slice(0, end)) };
    const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
    if (t) page.title = unent(t[1]).replace(/\s+/g, ' ').trim();
    const re = /<(meta|link|base)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
    let m, seen = 0, bytes = 0;
    while ((m = re.exec(head))) {
      bytes += blen(html.slice(seen, m.index)); seen = m.index;
      const tag = m[1].toLowerCase(), a = attrsOf(m[2]);
      if (tag === 'base') { if (a.href) page.base = abs(a.href, base) || page.base; continue; }
      if (tag === 'meta') {
        const key = a.name ? a.name : a.property;           // Discord: name if present, otherwise property
        if (key) page.metas.push({ key: key, value: a.content !== undefined ? a.content : a.value || '', at: bytes });
        continue;
      }
      const rel = (a.rel || '').toLowerCase().split(/\s+/), href = abs(a.href, page.base);
      if (!href) continue;
      if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) page.icons.push({ href: href, sizes: a.sizes || '', rel: rel.join(' ') });
      if ((a.type || '').toLowerCase() === 'application/json+oembed' && !page.oembed) page.oembed = href;
      if (rel.includes('canonical') && !page.canonical) page.canonical = href;
      if (rel.includes('discord:component-embed') && !embed.href) embed.href = href;
    }
    page.description = pick(page, ['description']);
    return page;
  }
  // A tag's value by document order: the first that is not empty, or the last written (empty or not).
  function pick(page, keys, which) {
    const all = page.metas.filter((m) => keys.includes(m.key));
    if (which === 'last') return all.length ? all[all.length - 1].value.trim() : '';
    const hit = all.find((m) => m.value.trim());
    return hit ? hit.value.trim() : '';
  }
  // A tag's value by preference: the first key in `keys` that has one.
  function pref(page, keys) { for (const k of keys) { const v = pick(page, [k]); if (v) return v; } return ''; }
  function every(page, keys) { return page.metas.filter((m) => keys.includes(m.key) && m.value.trim()).map((m) => m.value.trim()); }
  function at(page, key) { const m = page.metas.find((x) => x.key === key && x.value.trim()); return m ? m.at : -1; }
  function icon(page) {
    const touch = page.icons.find((i) => /apple-touch-icon/.test(i.rel));
    const size = (i) => parseInt(i.sizes, 10) || 0;
    return touch ? touch.href : page.icons.length ? page.icons.slice().sort((a, b) => size(b) - size(a))[0].href : '';
  }

  // ---- what a media file is, from its first bytes ----
  function sniff(b) {
    const none = { format: '', width: 0, height: 0, animated: false, alpha: false };
    if (!b || b.length < 4) return none;
    const s = (i, n) => { let o = ''; for (let k = i; k < i + n && k < b.length; k++) o += String.fromCharCode(b[k]); return o; };
    const be32 = (i) => (i + 3 < b.length ? ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0 : 0);
    const be16 = (i) => (i + 1 < b.length ? (b[i] << 8) | b[i + 1] : 0), le16 = (i) => (i + 1 < b.length ? b[i] | (b[i + 1] << 8) : 0);
    const le24 = (i) => (i + 2 < b.length ? b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) : 0);
    const find = (word, from) => { outer: for (let i = from || 0; i + word.length <= b.length; i++) { for (let k = 0; k < word.length; k++) if (b[i + k] !== word.charCodeAt(k)) continue outer; return i; } return -1; };
    if (b[0] === 137 && s(1, 3) === 'PNG') {
      let moving = false, clear = b[25] === 4 || b[25] === 6;          // colour types with alpha; a palette (3) has it by a tRNS chunk
      for (let p = 8; p + 8 <= b.length;) { const kind = s(p + 4, 4); if (kind === 'acTL') moving = true; if (kind === 'tRNS') clear = true; if (kind === 'IDAT') break; p += 12 + be32(p); }
      return { format: 'png', width: be32(16), height: be32(20), animated: moving, alpha: clear };
    }
    if (s(0, 4) === 'GIF8') return { format: 'gif', width: le16(6), height: le16(8), animated: find('NETSCAPE2.0') >= 0 || find('ANIMEXTS1.0') >= 0, alpha: false };
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let p = 2; p + 8 < b.length;) {
        if (b[p] !== 0xff) { p++; continue; }
        const mark = b[p + 1];
        if (mark >= 0xc0 && mark <= 0xcf && mark !== 0xc4 && mark !== 0xc8 && mark !== 0xcc) return { format: 'jpeg', width: be16(p + 7), height: be16(p + 5), animated: false, alpha: false };
        p += 2 + be16(p + 2);
      }
      return { format: 'jpeg', width: 0, height: 0, animated: false, alpha: false };
    }
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') {
      const kind = s(12, 4);
      if (kind === 'VP8X') return { format: 'webp', width: 1 + le24(24), height: 1 + le24(27), animated: !!(b[20] & 2), alpha: !!(b[20] & 16) };
      if (kind === 'VP8 ') return { format: 'webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff, animated: false, alpha: false };
      if (kind === 'VP8L') { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { format: 'webp', width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, animated: false, alpha: !!((v >>> 28) & 1) }; }
      return { format: 'webp', width: 0, height: 0, animated: false, alpha: false };
    }
    if (s(4, 4) === 'ftyp') {
      const brands = s(8, Math.max(4, Math.min(be32(0), 64) - 8));
      if (/avi[fs]/.test(brands)) { const i = find('ispe'); return { format: 'avif', width: i < 0 ? 0 : be32(i + 8), height: i < 0 ? 0 : be32(i + 12), animated: /avis/.test(brands), alpha: false }; }
      let w = 0, h = 0;
      for (let i = find('tkhd'); i >= 4 && !w; i = find('tkhd', i + 4)) { const size = be32(i - 4); w = be32(i - 4 + size - 8) >>> 16; h = be32(i - 4 + size - 4) >>> 16; }
      return { format: s(8, 4) === 'qt  ' ? 'mov' : 'mp4', width: w, height: h, animated: true, alpha: false };
    }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { format: 'webm', width: 0, height: 0, animated: true, alpha: false };
    return none;
  }

  // ---- Discord's component embeds: a layout a page hands to Discord, checked by Discord's published rules ----
  function component(text) {
    const out = { ok: false, problems: [], bytes: blen(String(text || '')), tree: null }, say = (p) => out.problems.push(p);
    if (out.bytes > 3000) say('it is ' + out.bytes + ' bytes; Discord reads at most 3,000 bytes');
    let doc; try { doc = JSON.parse(text); } catch (e) { say('it is not JSON: ' + e.message); return out; }
    const obj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
    if (!obj(doc) || !obj(doc.component)) { say('the top must be { "component": a Container }'); return out; }
    if (Object.keys(doc).length > 1) say('nothing may sit beside "component" at the top (found ' + Object.keys(doc).filter((k) => k !== 'component').join(', ') + ')');
    if (doc.component.type !== 17) say('the top component must be a Container (type 17), not type ' + doc.component.type);
    let count = 0, items = 0;
    const media = (m, where) => { if (!obj(m) || !safeUrl(m.url) || m.url.length > 2048) say(where + ' needs media.url, an http or https address of at most 2,048 characters'); };
    const BUTTON = ['id', 'type', 'url', 'style', 'label', 'emoji', 'disabled'];
    (function walk(c, depth) {
      count++;
      if (!obj(c)) return say('a component is not an object');
      const kids = (list) => (Array.isArray(list) ? list : []).forEach((k) => walk(k, depth + 1));
      if (c.type === 17) { if (depth) say('a Container cannot hold another Container'); kids(c.components); }
      else if (c.type === 1) kids(c.components);
      else if (c.type === 2) {
        const extra = Object.keys(c).filter((k) => !BUTTON.includes(k));
        if (extra.length) say('a button may not carry ' + extra.join(', ') + ' (only ' + BUTTON.join(', ') + ')');
        if (c.style !== 5) say('a button must be a link (style 5), not style ' + c.style);
        if (!c.label && !c.emoji) say('a button needs a label, an emoji, or both');
        if (!safeUrl(c.url) || c.url.length > 2048) say('a button needs url, an http or https address of at most 2,048 characters');
      } else if (c.type === 9) { kids(c.components); if (c.accessory) walk(c.accessory, depth + 1); }
      else if (c.type === 10) { if (typeof c.content !== 'string') say('a Text Display needs content'); }
      else if (c.type === 11) media(c.media, 'a Thumbnail');
      else if (c.type === 12) (Array.isArray(c.items) ? c.items : []).forEach(function (it) { items++; media(it && it.media, 'a gallery item'); });
      else if (c.type !== 14) say('type ' + c.type + ' is not one Discord allows in a link preview (1, 2, 9, 10, 11, 12, 14, 17)');
    })(doc.component, 0);
    if (count > 40) say('it has ' + count + ' components; Discord allows 40, the Container included');
    if (items > 10) say('it has ' + items + ' gallery items; Discord allows 10 in the whole preview');
    out.ok = !out.problems.length;
    out.tree = doc.component;
    return out;
  }

  // ---- one platform's card ----
  function resolve(id, page, media, extra) {
    media = media || {}; extra = extra || {};
    const A = (u) => abs(u, page.base || page.url), M = (u) => media[u] || null;
    const c = { layout: 'text', site: '', title: '', description: '', domain: domain(page.url), images: [], video: '', color: '', author: '', date: '', fields: [], animates: false, notes: [] };
    const card = pick(page, ['twitter:card'], 'last').toLowerCase(), type = pick(page, ['og:type'], 'last').toLowerCase();
    const ogImage = A(pref(page, ['og:image'])), anyImage = A(pref(page, ['og:image', 'twitter:image', 'twitter:image:src']));
    const text = (titles, descs) => { c.title = pref(page, titles) || page.title; c.description = descs ? pref(page, descs) : ''; };
    const one = (u, big) => { if (u) { c.images = [u]; c.layout = big ? 'large' : 'small'; } };
    const moving = (u) => !!(M(u) && M(u).animated);

    if (id === 'discord') {
      const t = pick(page, ['og:title', 'twitter:title']), d = pick(page, ['og:description', 'twitter:description']);
      if (t || d) { c.title = t; c.description = d; } else { c.title = page.title; c.description = page.description; }
      c.site = pick(page, ['og:site_name']);
      let images = Array.from(new Set(every(page, ['og:image']).map(A).filter(Boolean)));
      if (!images.length) images = [A(pref(page, ['og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']))].filter(Boolean);
      const o = extra.oembed;
      if (o && typeof o === 'object') {
        if (o.author_name) c.author = String(o.author_name);
        if (o.provider_name) c.site = String(o.provider_name);
        if (!c.title && o.title) c.title = String(o.title);
        if (!images.length && o.thumbnail_url && o.thumbnail_width && o.thumbnail_height) images = [A(String(o.thumbnail_url))].filter(Boolean);
      }
      if (blen(c.title) > 70) { c.title = cut(c.title, 70); c.notes.push('Title trimmed to 70 bytes.'); }
      if (blen(c.description) > 350) { c.description = cut(c.description, 350); c.notes.push('Description trimmed to 350 bytes.'); }
      const video = A(pref(page, ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']));
      const isVideo = type === 'video' || type.indexOf('video.') === 0 || card === 'player';
      c.images = images.slice(0, 4);
      if (images.length > 4) c.notes.push(images.length + ' pictures named; only four are shown.');
      if (extra.component && extra.component.ok) { c.layout = 'component'; c.tree = extra.component.tree; c.notes.push('The page hands Discord its own layout (a component embed); the plain tags are the fallback.'); }
      else if (isVideo && video && images.length) { c.layout = 'video'; c.video = video; c.description = ''; c.images = images.slice(0, 1); }
      else if (card === 'photo' && images.length) { c.layout = 'photo'; c.description = ''; c.images = images.slice(0, 1); }
      else if (images.length > 1) c.layout = 'gallery';
      else if (images.length) c.layout = card === 'summary_large_image' ? 'large' : 'small';
      if (video && !isVideo) c.notes.push('og:video is ignored: og:type is not video and twitter:card is not player.');
      if (isVideo && video && !images.length) c.notes.push('The video is dropped: it needs an og:image as its first frame.');
      const tw = A(pref(page, ['twitter:image', 'twitter:image:src']));
      if (tw && images.length && !images.includes(tw)) c.notes.push('twitter:image differs from og:image; Discord may show it as a second picture.');
      const colour = pick(page, ['theme-color'], 'last');
      if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(colour)) c.color = colour.slice(0, 7);
      else if (colour) c.notes.push('theme-color "' + colour + '" is not #RRGGBB, so there is no accent stripe.');
      const when = pick(page, ['og:pubdate', 'pubdate', 'iso-8601-publish-date'], 'last');
      if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(when)) c.date = when;
      c.animates = c.images.some((u) => moving(u) && !/png/.test((M(u).type || '') + (M(u).format || '')));
      if (c.animates) c.notes.push('The picture is animated: it plays (unless the reader has Reduced Motion on).');
    } else if (id === 'imessage') {
      text(['og:title'], null);
      const v = A(pref(page, ['og:video', 'og:video:url', 'og:video:secure_url']));
      const file = v && (/\.(mp4|m4v|mov)([?#]|$)/i.test(v) || /^video\//.test((M(v) || {}).type || ''));
      if (file) { c.layout = 'video'; c.video = v; c.animates = true; c.images = ogImage ? [ogImage] : []; c.notes.push('The video starts by itself, silent, and repeats.'); }
      else if (ogImage) { one(ogImage, true); if (v) c.notes.push('og:video is not a file Messages can play by itself (only YouTube embeds play, on a tap).'); }
      else if (icon(page)) { one(icon(page), false); c.notes.push('No og:image: the site icon stands in.'); }
      c.notes.push('Messages shows the title and the domain, never the description.');
    } else if (id === 'slack') {
      text(['og:title', 'twitter:title'], ['og:description', 'twitter:description', 'description']);
      c.site = pick(page, ['og:site_name']) || c.domain;
      one(anyImage, card === 'summary_large_image');
      [1, 2].forEach(function (n) { const l = pick(page, ['twitter:label' + n]), v = pick(page, ['twitter:data' + n]); if (l && v) c.fields.push([l, v]); });
      if (page.oembed) c.notes.push('The page offers oEmbed, which Slack asks before these tags.');
      if (moving(anyImage)) c.notes.push('The picture is animated; whether Slack plays it is not documented.');
    } else if (id === 'x') {
      text(['twitter:title', 'og:title'], ['twitter:description', 'og:description']);
      const image = A(pref(page, ['twitter:image', 'twitter:image:src', 'og:image']));
      one(image, card === 'summary_large_image');
      if (!card && !page.metas.some((m) => /^og:/.test(m.key))) { c.layout = 'none'; c.notes.push('No twitter:card and no Open Graph tags: X shows the bare link.'); }
      else if (!card) c.notes.push('No twitter:card: X falls back to the small summary card.');
      else if (card === 'player') c.notes.push('Player cards need X to approve the site; otherwise this is a summary card.');
      if (moving(image)) c.notes.push('The picture is animated; X shows only its first frame.');
    } else if (id === 'whatsapp') {
      text(['og:title'], ['og:description', 'description']);
      const m = M(ogImage);
      if (ogImage && m && m.bytes > 600000) c.notes.push('The picture is ' + kB(m.bytes) + '; over 600 kB WhatsApp shows none.');
      else one(ogImage, !m || !m.width || (m.width >= 300 && m.width / m.height <= 4));
      if (c.layout === 'small') c.notes.push('Under 300 px wide or wider than 4:1: a small square instead of the large card.');
      if (moving(ogImage)) c.notes.push('The picture is animated; WhatsApp shows only its first frame.');
    } else if (id === 'facebook') {
      text(['og:title'], ['og:description', 'description']);
      const m = M(ogImage);
      if (!(m && m.width && (m.width < 200 || m.height < 200))) one(ogImage, !m || !m.width || (m.width >= 600 && m.height >= 315));
      else c.notes.push('The picture is under 200 px: too small for Facebook to use.');
    } else if (id === 'linkedin') {
      text(['og:title'], null); one(ogImage, !(M(ogImage) && M(ogImage).width && M(ogImage).width < 401));
      c.notes.push('LinkedIn shows the title and the domain; the description is not drawn.');
    } else if (id === 'telegram') {
      text(['og:title', 'twitter:title'], ['og:description', 'twitter:description', 'description']);
      c.site = pick(page, ['og:site_name']) || c.domain; one(anyImage, card === 'summary_large_image');
    } else if (id === 'signal') {
      text(['og:title'], ['og:description']); one(ogImage, true);
    } else if (id === 'mastodon') {
      text(['og:title'], ['og:description', 'description']);
      c.site = pick(page, ['og:site_name']) || c.domain; one(ogImage, true);
      c.author = pick(page, ['fediverse:creator']); c.date = pick(page, ['article:published_time']);
    } else if (id === 'bluesky') {
      text(['og:title'], ['og:description', 'description']); one(ogImage, true);
    } else if (id === 'teams') {
      text(['og:title'], ['og:description', 'description']); one(ogImage, false);
    }
    if (id !== 'discord' && id !== 'slack' && c.images.some((u) => M(u) && M(u).alpha)) c.notes.push('The picture is see-through; here its clear parts may be filled in, with white or with black.');
    if (c.layout !== 'component' && !c.title && !c.description && !c.images.length) c.layout = 'none';
    return c;
  }

  // ---- what would go wrong, and where ----
  function checks(page, media, extra) {
    media = media || {}; extra = extra || {};
    const out = [], all = PLATFORMS.map((p) => p.id), say = (level, who, text) => out.push({ level: level, who: who, text: text });
    const raw = pref(page, ['og:image']), image = abs(raw, page.base || page.url), m = media[image] || null;
    const card = pick(page, ['twitter:card'], 'last').toLowerCase(), type = pick(page, ['og:type'], 'last').toLowerCase();
    if (!pick(page, ['og:title'])) say('warn', all, page.title ? 'No og:title: every platform falls back to <title> ("' + cut(page.title, 60) + '").' : 'No og:title and no <title>: there is nothing to show as a name.');
    if (!pref(page, ['og:description', 'description'])) say('warn', ['discord', 'slack', 'x', 'whatsapp', 'facebook', 'telegram', 'mastodon', 'bluesky', 'teams'], 'No description (og:description or <meta name="description">).');
    if (!pick(page, ['og:url'])) say('warn', ['whatsapp', 'facebook'], 'No og:url: WhatsApp asks for it, and Facebook counts shares by it.');
    if (!raw) say('warn', all, 'No og:image: the link unfolds as words only' + (page.icons.length ? ' (Messages uses the site icon).' : '.'));
    else {
      if (!/^https?:\/\//i.test(raw)) say(raw[0] === '/' ? 'warn' : 'bad', all, 'og:image "' + cut(raw, 80) + '" is not a whole address; ' + (raw[0] === '/' ? 'Discord accepts one starting with /, most others do not.' : 'platforms cannot fetch it.'));
      else if (/^http:/i.test(raw)) say('bad', all, 'og:image is http, not https: most platforms refuse it.');
      if (m) {
        if (m.status && (m.status < 200 || m.status > 299)) say('bad', all, 'og:image answers ' + m.status + ': no platform can show it.');
        else {
          if (m.format === '' || (m.type && !/^image\//.test(m.type))) say('bad', all, 'og:image is served as ' + (m.type || 'something that is not a picture') + '.');
          if (m.bytes > 600000) say('bad', ['whatsapp'], 'og:image is ' + kB(m.bytes) + ': WhatsApp shows no picture over 600 kB.');
          if (m.bytes > 5e6) say('bad', ['x', 'linkedin', 'slack'], 'og:image is ' + kB(m.bytes) + ': X, LinkedIn and Slack refuse a picture over 5 MB.');
          if (m.width && (m.width < 600 || m.height < 315)) say('warn', ['facebook', 'linkedin', 'x', 'whatsapp'], 'og:image is ' + m.width + '×' + m.height + ': under 600×315 it is drawn as a small square where a large card was possible.');
          if (m.alpha) say('warn', all.filter((p) => p !== 'discord' && p !== 'slack'), 'og:image is see-through: Discord and Slack show the chat behind it; platforms that remake pictures as JPEG fill the clear parts, with white or with black, so it has to read on both.');
          if (m.animated) say('ok', all, 'og:image is animated: Discord plays it; X, WhatsApp, Facebook and LinkedIn show its first frame.');
          if (m.width && !say.sized) say('ok', all, 'og:image: ' + (m.format || m.type || 'picture') + ', ' + m.width + '×' + m.height + (m.bytes ? ', ' + kB(m.bytes) : '') + '.');
        }
      }
      if (!pick(page, ['og:image:width']) || !pick(page, ['og:image:height'])) say('warn', ['discord', 'facebook', 'linkedin'], 'og:image:width and og:image:height are missing: Discord must fetch the picture to measure it, and a first share elsewhere can come up without it.');
      else if (m && m.width && (+pick(page, ['og:image:width']) !== m.width || +pick(page, ['og:image:height']) !== m.height)) say('warn', all, 'og:image:width/height say ' + pick(page, ['og:image:width']) + '×' + pick(page, ['og:image:height']) + ' but the picture is ' + m.width + '×' + m.height + '.');
      if (!card) say('warn', ['discord', 'slack', 'x', 'telegram'], 'No twitter:card: Discord, Slack, X and Telegram draw the picture small, beside the words. summary_large_image makes it large.');
    }
    const late = ['og:title', 'og:description', 'og:url', 'og:image'].filter((k) => at(page, k) > 300000);
    if (late.length) say('bad', ['whatsapp'], late.join(', ') + ' sit' + (late.length > 1 ? '' : 's') + ' past the first 300 kB of the page: WhatsApp never reads that far.');
    if (blen(pick(page, ['og:title', 'twitter:title'])) > 70) say('warn', ['discord'], 'The title is over 70 bytes: Discord trims it.');
    const video = abs(pref(page, ['og:video', 'og:video:url', 'og:video:secure_url']), page.base || page.url);
    if (video) {
      const v = media[video] || null, isVideo = type === 'video' || type.indexOf('video.') === 0 || card === 'player';
      if (v && v.status && (v.status < 200 || v.status > 299)) say('bad', ['imessage', 'discord'], 'og:video answers ' + v.status + '.');
      if (!isVideo) say('ok', ['discord', 'imessage'], 'og:video without og:type video: Messages plays it by itself; Discord shows the picture (or the page\'s own layout).');
      const ic = media[icon(page)] || null, sum = ((m && m.bytes) || 0) + ((v && v.bytes) || 0) + ((ic && ic.bytes) || 0);
      if (sum > 10e6) say('bad', ['imessage'], 'Icon, picture and video are ' + kB(sum) + ' together: Messages loads at most 10 MB.');
      else if (v && v.bytes) say('ok', ['imessage'], 'Icon, picture and video are ' + kB(sum) + ' together, inside Messages\' 10 MB.');
    }
    if (extra.component) {
      if (extra.component.ok) say('ok', ['discord'], 'Discord component embed: ' + extra.component.bytes + ' of 3,000 bytes, and every part is one Discord allows.');
      else say('bad', ['discord'], 'Discord component embed: ' + extra.component.problems.join('; ') + '. A layout Discord rejects can leave the link with no preview at all.');
    }
    return out;
  }

  return { PLATFORMS: PLATFORMS, CRAWLERS: CRAWLERS, read: read, pick: pick, pref: pref, resolve: resolve, checks: checks, component: component,
    sniff: sniff, esc: esc, safeUrl: safeUrl, abs: abs, md: md, domain: domain, icon: icon, kB: kB };
});
