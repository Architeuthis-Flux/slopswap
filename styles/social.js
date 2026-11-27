// The social preview maker: on any page of the site, make that page's own preview (the picture a pasted link unfolds
// with) from what the page shows, and publish it. build.py puts this script on every page; it does nothing unless the
// browser holds the site's publishing token (the one the lenticular shirt viewer keeps) or the address ends in #social,
// so visitors never see it. Chrome only: it is Chrome that encodes the frames.
//
// What it photographs: a page's own driver if it has one (window.socialPreview: see the lenticular viewer), else a
// canvas as it moves (the 3D viewer turning), a few of the page's pictures as a slideshow, or a dropped file.
// What it publishes, in one commit through GitHub's API, beside the page: <page>-og.png (the still), <page>-og.webp
// (the loop) and <page>-og.mp4 (the loop as a video, for Messages), with <page>-og.json (how it was made).
// build.py then uses those ahead of the site's card. On the front page and the lenticular viewer it can also publish
// the site's card itself (styles/social-card.png and its two companions).
//
// The parts with no page in them are tested by `node .tools/social.test.mjs`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SocialMaker = api; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.start); else api.start(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 1200, H = 630, LOOP_W = 960, LOOP_H = 504, FRAME_MS = 80, STILL_MOST = 300000;
  const KEY = 'lenticular-shirt-viewer.v1.gh', REPO = 'Architeuthis-Flux/slopswap', BRANCH = 'main';

  // ---- frames into one animated WebP: each still's own picture chunks, wrapped as a frame that replaces the last ----
  function chunks(b) {
    const s = (i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (b.length < 20 || s(0) !== 'RIFF' || s(8) !== 'WEBP') throw new Error('a frame is not a WebP picture');
    const out = [];
    for (let p = 12; p + 8 <= b.length;) { const n = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24); out.push({ id: s(p), all: b.subarray(p, p + 8 + n + (n & 1)), data: b.subarray(p + 8, p + 8 + n) }); p += 8 + n + (n & 1); }
    return out;
  }
  function webpAnim(frames, w, h, ms) {
    if (!frames.length) throw new Error('there is no frame to join');
    const le = (n, bytes) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255), parts = [];
    let alpha = false;
    for (const f of frames) {
      const cs = chunks(f), x = cs.find((c) => c.id === 'VP8X'), l = cs.find((c) => c.id === 'VP8L');
      const keep = cs.filter((c) => c.id === 'ALPH').concat(cs.filter((c) => c.id === 'VP8 ' || c.id === 'VP8L'));
      if (!keep.some((c) => c.id !== 'ALPH')) throw new Error('a frame is not a WebP picture');
      if (cs.some((c) => c.id === 'ALPH') || (x && x.data[0] & 0x10) || (l && (l.data[4] >> 4) & 1)) alpha = true;
      const size = keep.reduce((n, c) => n + c.all.length, 16);
      // where it sits (0, 0), its size, how long it shows, and "do not blend": it replaces what was there
      parts.push(Uint8Array.from([65, 78, 77, 70, ...le(size, 4), 0, 0, 0, 0, 0, 0, ...le(w - 1, 3), ...le(h - 1, 3), ...le(ms, 3), 2]), ...keep.map((c) => c.all));
    }
    const head = Uint8Array.from([86, 80, 56, 88, 10, 0, 0, 0, 2 | (alpha ? 16 : 0), 0, 0, 0, ...le(w - 1, 3), ...le(h - 1, 3), 65, 78, 73, 77, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const body = parts.reduce((n, p) => n + p.length, head.length), out = new Uint8Array(12 + body);
    out.set([82, 73, 70, 70, ...le(4 + body, 4), 87, 69, 66, 80]); out.set(head, 12);
    let at = 12 + head.length;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  // ---- the cut-out: see-through wherever the shot is the same as the bare view, solid once it is `solid` levels away ----
  function cutOut(shot, bare, solid) {
    solid = solid || 6;
    for (let i = 0; i < shot.length; i += 4) {
      const d = Math.max(Math.abs(shot[i] - bare[i]), Math.abs(shot[i + 1] - bare[i + 1]), Math.abs(shot[i + 2] - bare[i + 2]));
      shot[i + 3] = Math.min(shot[i + 3], Math.min(255, Math.floor(d * 255 / solid)));
    }
    return shot;
  }

  // ---- a heavy still in `colours` colours, the last of them see-through: a PNG a third the size ----
  async function palettePng(rgba, w, h, colours) {
    const n = w * h, count = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
    const bin = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    for (let i = 0; i < n; i++) { const o = i * 4; if (rgba[o + 3] < 128) continue; const k = bin(rgba[o], rgba[o + 1], rgba[o + 2]); count[k]++; sr[k] += rgba[o]; sg[k] += rgba[o + 1]; sb[k] += rgba[o + 2]; }
    let boxes = [Array.from(count.keys()).filter((k) => count[k])];
    const axis = (k, a) => (a === 0 ? k >> 10 : a === 1 ? (k >> 5) & 31 : k & 31);
    while (boxes.length < colours - 1) {                      // median cut: split the fullest box across its longest side
      const big = boxes.filter((b) => b.length > 1).sort((p, q) => q.reduce((t, k) => t + count[k], 0) - p.reduce((t, k) => t + count[k], 0))[0];
      if (!big) break;
      const span = [0, 1, 2].map((a) => Math.max(...big.map((k) => axis(k, a))) - Math.min(...big.map((k) => axis(k, a)))), a = span.indexOf(Math.max(...span));
      big.sort((p, q) => axis(p, a) - axis(q, a));
      const half = big.reduce((t, k) => t + count[k], 0) / 2;
      let cut = 0, seen = 0; while (cut < big.length - 1 && seen + count[big[cut]] <= half) seen += count[big[cut++]];
      cut = Math.max(1, cut); boxes = boxes.filter((b) => b !== big).concat([big.slice(0, cut), big.slice(cut)]);
    }
    const pal = boxes.map((b) => { const t = b.reduce((x, k) => x + count[k], 0) || 1; return [b.reduce((x, k) => x + sr[k], 0) / t, b.reduce((x, k) => x + sg[k], 0) / t, b.reduce((x, k) => x + sb[k], 0) / t].map(Math.round); });
    const lut = new Int16Array(32768).fill(-1); boxes.forEach((b, i) => b.forEach((k) => { lut[k] = i; }));
    const near = (k) => { if (lut[k] < 0) { const r = (k >> 10) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4; let best = 0, bd = 1e9; pal.forEach((c, i) => { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }); lut[k] = best; } return lut[k]; };
    const clear = pal.length, rows = new Uint8Array((w + 1) * h), err = new Float32Array((w + 2) * 3 * 2);
    for (let y = 0; y < h; y++) {                              // Floyd-Steinberg: what a colour loses is handed to its neighbours
      const cur = (y & 1) * (w + 2) * 3, nxt = ((y + 1) & 1) * (w + 2) * 3; err.fill(0, nxt, nxt + (w + 2) * 3);
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, e = cur + (x + 1) * 3;
        if (rgba[o + 3] < 128) { rows[y * (w + 1) + 1 + x] = clear; continue; }
        const c = [0, 1, 2].map((j) => Math.max(0, Math.min(255, rgba[o + j] + err[e + j]))), i = near(bin(c[0], c[1], c[2]));
        rows[y * (w + 1) + 1 + x] = i;
        for (let j = 0; j < 3; j++) { const d = c[j] - pal[i][j]; err[e + 3 + j] += d * 7 / 16; err[nxt + x * 3 + j] += d * 3 / 16; err[nxt + (x + 1) * 3 + j] += d * 5 / 16; err[nxt + (x + 2) * 3 + j] += d / 16; }
      }
    }
    const zipped = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const table = new Uint32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const be = (v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    const chunk = (id, data) => { const body = Uint8Array.from([...id].map((ch) => ch.charCodeAt(0)).concat(Array.from(data))); let c = 0xffffffff; for (const v of body) c = table[(c ^ v) & 255] ^ (c >>> 8); return [...be(data.length), ...body, ...be((c ^ 0xffffffff) >>> 0)]; };
    const idat = (() => { const body = new Uint8Array(4 + zipped.length); body.set([73, 68, 65, 84]); body.set(zipped, 4); let c = 0xffffffff; for (const v of body) c = table[(c ^ v) & 255] ^ (c >>> 8); return [be(zipped.length), body, be((c ^ 0xffffffff) >>> 0)]; })();
    const start = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', [...be(w), ...be(h), 8, 3, 0, 0, 0]), ...chunk('PLTE', pal.flat().concat([0, 0, 0])), ...chunk('tRNS', new Array(clear).fill(255).concat([0]))]);
    const end = Uint8Array.from(chunk('IEND', [])), out = new Uint8Array(start.length + 8 + idat[1].length + end.length);
    out.set(start); out.set(idat[0], start.length); out.set(idat[1], start.length + 4); out.set(idat[2], start.length + 4 + idat[1].length); out.set(end, out.length - end.length);
    return out;
  }

  // ---- where a page's preview lives ----
  function target(pathname) {
    let p = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (!p) return { stem: 'styles/social', site: true };
    if (p.endsWith('/')) p += 'index';
    return { stem: p.replace(/\.html$/, '') + '-og', site: false };
  }
  function names(t) {
    return t.site ? { png: 'styles/social-card.png', webp: 'styles/social-sweep.webp', mp4: 'styles/social-sweep.mp4', json: 'styles/social-card.json' }
      : { png: t.stem + '.png', webp: t.stem + '.webp', mp4: t.stem + '.mp4', json: t.stem + '.json' };
  }

  // ---- one commit through GitHub's API: the files as blobs, a tree on top of the branch's, a commit, the branch moved ----
  async function publish(o) {
    const ask = async (path, body, method) => {
      const r = await o.fetch('https://api.github.com/repos/' + o.repo + path, { method: method || (body ? 'POST' : 'GET'), body: body ? JSON.stringify(body) : undefined,
        headers: { Authorization: 'Bearer ' + o.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } });
      const j = await r.json();
      if (!r.ok) throw new Error('GitHub answered ' + r.status + (j && j.message ? ': ' + j.message : ''));
      return j;
    };
    const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
    const head = (await ask('/git/ref/heads/' + o.branch)).object.sha, base = (await ask('/git/commits/' + head)).tree.sha, tree = [];
    for (const f of o.files) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: (await ask('/git/blobs', { content: b64(f.bytes), encoding: 'base64' })).sha });
    const made = (await ask('/git/commits', { message: o.message, tree: (await ask('/git/trees', { base_tree: base, tree: tree })).sha, parents: [head] })).sha;
    await ask('/git/refs/heads/' + o.branch, { sha: made }, 'PATCH');
    return made;
  }

  // ---- the page part ----
  function start() {
    const token = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
    if ((!token() && location.hash !== '#social') || window.top !== window || document.getElementById('social-maker')) return;
    const host = document.createElement('div'); host.id = 'social-maker';
    const dom = host.attachShadow({ mode: 'open' }), $ = (id) => dom.getElementById(id);
    dom.innerHTML = `<style>
      :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483000; font: 13px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #f3f3f5; }
      * { box-sizing: border-box; font: inherit; color: inherit; } [hidden] { display: none !important; }
      button { cursor: pointer; border: 0; padding: 4px 12px; background: #3d3d44; text-transform: uppercase; letter-spacing: .07em; font-size: 12px; } button:hover { background: #4b4b54; }
      button.go { background: #fc0289; color: #27272b; } button:disabled { opacity: .45; cursor: default; }
      #panel { width: min(400px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; display: grid; gap: 8px; padding: 10px; background: #323238; border: 1px solid #4b4b54; box-shadow: 0 8px 30px #000a; }
      h2 { margin: 0; display: flex; justify-content: space-between; align-items: center; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
      label { display: flex; align-items: center; gap: 8px; color: #aaaab5; } label > :last-child { margin-left: auto; }
      input, select { background: #27272b; border: 1px solid #4b4b54; padding: 3px 6px; } input[type=number] { width: 6em; } input[type=range] { flex: 1; padding: 0; } select, input[type=password] { min-width: 0; flex: 1; }
      #stage { width: 100%; height: auto; cursor: grab; background: repeating-conic-gradient(#3a3a40 0 25%, #2c2c31 0 50%) 0 0 / 16px 16px; }
      #pics { display: flex; gap: 4px; overflow-x: auto; } #pics img { height: 48px; opacity: .4; cursor: pointer; } #pics img.on { opacity: 1; outline: 2px solid #fc0289; outline-offset: -2px; }
      #out { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; } #out > * { min-width: 0; } #out img, #out video { width: 100%; background: repeating-conic-gradient(#3a3a40 0 25%, #2c2c31 0 50%) 0 0 / 12px 12px; } #out small, #said { color: #aaaab5; overflow-wrap: anywhere; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    </style>
    <button id="open">Social preview</button>
    <div id="panel" hidden>
      <h2>Social preview <button id="shut" aria-label="Close">×</button></h2>
      <label>From <select id="from"></select></label><input id="file" type="file" accept="image/*,video/*" hidden><div id="pics" hidden></div>
      <div id="knobs"></div>
      <canvas id="stage" width="${W}" height="${H}" title="Drag to move the picture in the frame"></canvas>
      <label>Size <input id="zoom" type="range" min="0.2" max="6" step="0.01" value="1"></label>
      <label>Ground <select id="ground"><option value="clear">see-through</option><option value="#27272b">charcoal</option><option value="#000000">black</option><option value="#ffffff">white</option></select></label>
      <label>Loop, seconds <input id="secs" type="number" min="1" max="8" step="0.5" value="4"></label>
      <label id="backrow"><input id="back" type="checkbox" checked> there and back, so the loop has no jump</label>
      <div class="row"><button id="record" class="go">Make it</button><button id="stillonly">Still only</button></div>
      <div id="out"></div>
      <label id="whererow" hidden>Publish as <select id="where"><option value="page">this page's preview</option><option value="site">the site's card</option></select></label>
      <label id="tokenrow" hidden>GitHub token <input id="token" type="password" autocomplete="off" placeholder="kept in this browser only"></label>
      <div class="row"><button id="publish" class="go" disabled>Publish</button><span id="said"></span></div>
    </div>`;
    document.body.appendChild(host);

    const st = { f: { zoom: 1, x: 0, y: 0 }, src: null, live: null, made: null, busy: false }, stage = $('stage'), sx = stage.getContext('2d');
    const say = (t) => { $('said').textContent = t; }, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), drv = () => window.socialPreview || null;
    const blob = (canvas, type, q) => new Promise((ok) => canvas.toBlob(ok, type, q)), bytes = async (b) => new Uint8Array(await b.arrayBuffer());
    const box = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

    // the frame: ground, then the source at its size (1 fills the height) and place
    function paint(ctx, src, sw, sh, opacity) { const k = ctx.canvas.width / W, s = st.f.zoom * H / sh * k; ctx.globalAlpha = opacity == null ? 1 : opacity; ctx.drawImage(src, (ctx.canvas.width - sw * s) / 2 + st.f.x * k, (ctx.canvas.height - sh * s) / 2 + st.f.y * k, sw * s, sh * s); ctx.globalAlpha = 1; }
    function ground(ctx, solid) { const g = solid || $('ground').value; ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); if (g !== 'clear') { ctx.fillStyle = g; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); } }
    const size = (s) => [s.videoWidth || s.naturalWidth || s.width, s.videoHeight || s.naturalHeight || s.height];
    // a canvas is watched through a video of it (the one way to read a 3D canvas); until its first frame comes, the canvas itself
    const ready = (s) => (s && s === st.live && s.readyState < 2 ? st.raw : s);
    function show(src, opacity, keep) { src = ready(src); if (!keep) ground(sx); if (src) paint(sx, src, ...size(src), opacity); }

    // ---- what can be photographed here ----
    function sources() {
      const from = $('from'); from.textContent = '';
      const add = (v, t) => from.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
      if (drv()) add('driver', drv().name || 'This page');
      st.canvases = Array.from(document.querySelectorAll('canvas')).filter((c) => c.width >= 200 && c.height >= 100 && c.getClientRects().length && !(drv() && drv().canvas() === c));
      st.canvases.forEach((c, i) => add('canvas' + i, 'Canvas ' + (i + 1) + ' (' + c.width + '×' + c.height + '), as it moves'));
      st.pics = Array.from(document.images).filter((i) => i.naturalWidth >= 300 && (i.currentSrc.startsWith(location.origin) || i.currentSrc.startsWith('data:')));
      if (st.pics.length) add('pics', 'Pictures on the page (' + st.pics.length + ')');
      add('file', 'A picture or video file…');
      const pics = $('pics'); pics.textContent = '';
      st.pics.forEach((i, n) => { const t = document.createElement('img'); t.src = i.currentSrc; t.className = n === 0 ? 'on' : ''; t.onclick = () => { t.classList.toggle('on'); choose(); }; pics.append(t); });
      const knobs = $('knobs'); knobs.textContent = '';
      (drv() ? drv().settings || [] : []).forEach(function (k) {
        const l = document.createElement('label'), i = document.createElement('input'); l.textContent = k.label + (k.unit ? ', ' + k.unit : '') + ' '; i.dataset.key = k.key;
        if (k.type === 'check') { i.type = 'checkbox'; i.checked = !!k.value; } else { i.type = 'number'; i.min = k.min; i.max = k.max; i.step = k.step || 1; i.value = k.value; }
        l.append(i); knobs.append(l);
      });
      choose();
    }
    const values = () => Object.fromEntries(Array.from($('knobs').querySelectorAll('input')).map((i) => [i.dataset.key, i.type === 'checkbox' ? i.checked : +i.value]));
    function choose() {
      const v = $('from').value; if (st.live) { st.live.srcObject = null; st.live = null; }
      $('pics').hidden = v !== 'pics'; $('knobs').hidden = v !== 'driver'; $('backrow').hidden = v === 'driver' || v === 'pics';
      st.kind = v.startsWith('canvas') ? 'canvas' : v; st.src = null;
      if (v === 'driver') { st.src = drv().canvas(); if (drv().framing && !st.touched) Object.assign(st.f, drv().framing); }
      else if (st.kind === 'canvas') {
        const vid = document.createElement('video'); vid.muted = true; st.raw = st.canvases[+v.slice(6)]; vid.srcObject = st.raw.captureStream(); vid.play().catch(() => {}); st.live = st.src = vid;
        window.dispatchEvent(new Event('resize'));           // most pages draw again on this, which gives the video its first frame
      }
      else if (v === 'pics') { st.chosen = Array.from($('pics').children).map((t, n) => (t.classList.contains('on') ? st.pics[n] : null)).filter(Boolean); st.src = st.chosen[0] || null; }
      else if (v === 'file') $('file').click();
      $('zoom').value = st.f.zoom; $('ground').querySelector('[value=clear]').disabled = st.kind === 'canvas';
      if (st.kind === 'canvas' && $('ground').value === 'clear') $('ground').value = '#27272b';
    }
    (function tick() { if (!$('panel').hidden && !st.busy && st.src) show(st.src); requestAnimationFrame(tick); })();

    // ---- making the frames ----
    const grab = async () => createImageBitmap(stage);
    function pixels(c) { const t = box(c.width, c.height), x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); return { t: t, x: x, d: x.getImageData(0, 0, c.width, c.height) }; }
    async function driven(still) {                            // the page shows each moment itself; with a bare view too, the print is cut out
      const d = drv(), v = values(), n = Math.round($('secs').value * 1000 / FRAME_MS), clear = $('ground').value === 'clear' && !!d.bare, frames = new Array(n);
      if (d.begin) await d.begin(v);
      const one = async (showIt) => {
        await showIt(); if (!clear) { show(d.canvas()); return grab(); }
        const a = pixels(d.canvas()); await d.bare(true); await showIt(); const b = pixels(d.canvas()); await d.bare(false);
        cutOut(a.d.data, b.d.data); a.x.putImageData(a.d, 0, 0); show(a.t); return grab();
      };
      try {
        const first = await one(() => d.still(v));
        for (let k = 0; !still && k < n; k++) { const twin = d.mirror && k > n / 2 ? frames[n - k] : null; frames[k] = twin || await one(() => d.frame(k / n, v)); say('frame ' + (k + 1) + ' of ' + n); }
        return { still: first, frames: still ? [] : frames, settings: v };
      } finally { if (d.end) await d.end(); }
    }
    async function moving(still) {                            // a canvas or a video, sampled as it plays
      const n = Math.round($('secs').value * 1000 / FRAME_MS), frames = [];
      if (st.src.tagName === 'VIDEO' && !st.src.srcObject) { st.src.currentTime = 0; await st.src.play().catch(() => {}); }
      for (let k = 0; k < (still ? 1 : n); k++) { show(st.src); frames.push(await grab()); say('frame ' + (k + 1) + ' of ' + n); if (!still) await wait(FRAME_MS); }
      const loop = $('back').checked && frames.length > 2 ? frames.concat(frames.slice(1, -1).reverse()) : frames;
      return { still: frames[0], frames: still ? [] : loop };
    }
    async function slides(still) {                            // the chosen pictures in turn, each fading into the next
      const list = st.kind === 'pics' ? st.chosen : [st.src], n = Math.round($('secs').value * 1000 / FRAME_MS), each = Math.max(4, Math.floor(n / list.length)), fade = Math.min(5, each - 2), frames = [];
      if (!list.length || !list[0]) throw new Error('choose a picture first');
      for (let k = 0; k < (still || list.length < 2 ? 1 : each * list.length); k++) {
        const i = Math.floor(k / each), into = k % each - (each - fade);
        show(list[i]); if (into >= 0) show(list[(i + 1) % list.length], (into + 1) / (fade + 1), true);
        frames.push(await grab());
      }
      return { still: frames[0], frames: frames.length > 1 ? frames : [] };
    }
    async function make(still) {
      if (st.busy || !st.src) return; st.busy = true; $('record').disabled = $('stillonly').disabled = $('publish').disabled = true; say('making…');
      try {
        const got = await (st.kind === 'driver' ? driven(still) : st.kind === 'canvas' || st.src.tagName === 'VIDEO' ? moving(still) : slides(still));
        const full = box(W, H), fx = full.getContext('2d', { willReadFrequently: true }), small = box(LOOP_W, LOOP_H), mx = small.getContext('2d'), seeThrough = $('ground').value === 'clear';
        fx.drawImage(got.still, 0, 0);
        let png = await bytes(await blob(full, 'image/png'));
        if (png.length > STILL_MOST) png = await palettePng(fx.getImageData(0, 0, W, H).data, W, H, 256);
        const made = { png: png, settings: got.settings || null }, parts = [];
        for (const f of got.frames) { mx.clearRect(0, 0, LOOP_W, LOOP_H); mx.drawImage(f, 0, 0, LOOP_W, LOOP_H); parts.push(await bytes(await blob(small, 'image/webp', 0.72))); }
        if (parts.length) made.webp = webpAnim(parts, LOOP_W, LOOP_H, FRAME_MS);
        const kind = ['video/mp4;codecs=avc1.640028', 'video/mp4'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
        if (parts.length && kind) {                           // the loop once more, played into a recorder: a video has no see-through, so on charcoal
          say('recording the video…');
          const rec = new MediaRecorder(full.captureStream(25), { mimeType: kind, videoBitsPerSecond: 3e6 }), got2 = []; rec.ondataavailable = (e) => got2.push(e.data);
          const done = new Promise((ok) => { rec.onstop = ok; }); rec.start();
          for (const f of got.frames) { ground(fx, seeThrough ? '#27272b' : $('ground').value); fx.drawImage(f, 0, 0); await wait(FRAME_MS); }
          rec.stop(); await done; made.mp4 = await bytes(new Blob(got2, { type: 'video/mp4' }));
        }
        st.made = made; results();
        say('made: still ' + kB(made.png) + (made.webp ? ', loop ' + kB(made.webp) : '') + (made.mp4 ? ', video ' + kB(made.mp4) : '') + (made.png.length > 600000 ? '. The still is over 600 kB: WhatsApp will show none.' : ''));
      } catch (e) { say('could not make it: ' + e.message); } finally { st.busy = false; $('record').disabled = $('stillonly').disabled = false; $('publish').disabled = !st.made; }
    }
    const kB = (b) => (b.length >= 1e6 ? (b.length / 1e6).toFixed(1) + ' MB' : Math.round(b.length / 1000) + ' kB');
    function results() {
      const out = $('out'), m = st.made; out.textContent = '';
      const cell = (node, text) => { const d = document.createElement('div'), s = document.createElement('small'); s.textContent = text; d.append(node, s); out.append(d); };
      const url = (b, type) => URL.createObjectURL(new Blob([b], { type: type }));
      cell(Object.assign(new Image(), { src: url(m.png, 'image/png') }), 'still, ' + kB(m.png));
      if (m.webp) cell(Object.assign(new Image(), { src: url(m.webp, 'image/webp') }), 'loop, ' + kB(m.webp));
      if (m.mp4) cell(Object.assign(document.createElement('video'), { src: url(m.mp4, 'video/mp4'), muted: true, loop: true, autoplay: true, playsInline: true }), 'video, ' + kB(m.mp4));
    }
    async function send() {
      const typed = $('token').value.trim(); if (typed) { try { localStorage.setItem(KEY, typed); } catch (e) { /* kept for this visit only */ } }
      const tok = typed || token(); if (!tok) { $('tokenrow').hidden = false; return say('paste a GitHub token that may write to ' + REPO); }
      const here = target(location.pathname), t = $('where').value === 'site' ? { stem: 'styles/social', site: true } : here, n = names(t), m = st.made;
      const how = { made: new Date().toISOString(), page: location.pathname, from: st.kind, seconds: +$('secs').value, ground: $('ground').value, framing: st.f, settings: m.settings };
      const files = [{ path: n.png, bytes: m.png }, { path: n.json, bytes: new TextEncoder().encode(JSON.stringify(how, null, 1) + '\n') }];
      if (m.webp) files.push({ path: n.webp, bytes: m.webp }); if (m.mp4) files.push({ path: n.mp4, bytes: m.mp4 });
      $('publish').disabled = true; say('publishing ' + files.length + ' files…');
      try {
        const sha = await publish({ repo: REPO, branch: BRANCH, token: tok, fetch: (u, i) => fetch(u, i), files: files,
          message: (t.site ? 'Social card' : here.stem.split('/')[0] + ': social preview for ' + location.pathname) + ', made on the page' });
        say('published as ' + sha.slice(0, 7) + '. The site rebuilds in about a minute.');
      } catch (e) { say('not published: ' + e.message); } finally { $('publish').disabled = false; }
    }

    // ---- the controls ----
    $('open').onclick = () => { $('open').hidden = true; $('panel').hidden = false; $('tokenrow').hidden = !!token(); const t = target(location.pathname); $('whererow').hidden = !(drv() && drv().site); if (t.site) $('where').value = 'site'; sources(); };
    $('shut').onclick = () => { $('panel').hidden = true; $('open').hidden = false; if (st.live) { st.live.srcObject = null; st.live = null; } };
    $('from').onchange = choose; $('record').onclick = () => make(false); $('stillonly').onclick = () => make(true); $('publish').onclick = send;
    $('zoom').oninput = () => { st.f.zoom = +$('zoom').value; st.touched = true; };
    $('file').onchange = function () {
      const f = this.files[0]; if (!f) return; const u = URL.createObjectURL(f);
      if (f.type.startsWith('video/')) { const v = document.createElement('video'); v.muted = true; v.loop = true; v.src = u; v.play().catch(() => {}); st.src = v; } else { const i = new Image(); i.onload = () => { st.src = i; }; i.src = u; }
    };
    let drag = null;
    stage.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, fx: st.f.x, fy: st.f.y }; stage.setPointerCapture(e.pointerId); };
    stage.onpointermove = (e) => { if (!drag) return; const k = W / stage.clientWidth; st.f.x = Math.round(drag.fx + (e.clientX - drag.x) * k); st.f.y = Math.round(drag.fy + (e.clientY - drag.y) * k); st.touched = true; };
    stage.onpointerup = () => { drag = null; };
    return dom;
  }

  return { webpAnim: webpAnim, cutOut: cutOut, palettePng: palettePng, target: target, names: names, publish: publish, start: start };
});
