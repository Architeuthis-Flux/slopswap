// Jumperless V6 outline tool - how the 3D view is lit and painted. No geometry is decided here: it only dresses what
// V6Geo.resolve() returned. What is drawn rather than read from a file (the gold lands on the face board, the column
// numbers, the picture on the screen, the LEDs) is listed in the README under "Not verified".
(function (root) {
  'use strict';
  var T = root.THREE;
  if (!T) { root.V6Render = null; return; }

  var MASK = { black: '#17171a', white: '#dcd9d0', green: '#0e5a3a', purple: '#3b1f66', blue: '#123f7d', red: '#8c1d1d' };
  var SILK = { white: '#f2f2ee', black: '#111113', yellow: '#e8d44d' };
  var FINISH = { enig: ['#d9b441', '#8a6a1a'], hasl: ['#cfd3d8', '#7c8187'] };
  var SHELL = { black: 0x1c1d20, white: 0xe4e2dc, clear: 0xc9d2da };
  var BG = { console: '#27272b', deep: '#1b1b1e', studio: 'tex', slate: 'tex', blueprint: 'tex', dusk: 'tex', rainbow: 'tex', paper: '#dfe3e6', white: '#ffffff', custom: 'custom', clear: null };
  // Lighting rigs: a main light (shadows, turned by Light from), a second light from the far side, a back light low behind,
  // and the sky. Picking one copies these into the view settings, where each can then be changed.
  var RIGS = {
    studio: { label: 'Studio', keyColor: '#ffffff', keyLevel: 1, fillColor: '#ffffff', fillLevel: 1, rimColor: '#ffffff', rimLevel: 0, skyColor: '#ffffff', ambLevel: 1 },
    bench: { label: 'Bench lamp', keyColor: '#ffdcae', keyLevel: 1.25, fillColor: '#b9ccff', fillLevel: 0.4, rimColor: '#ffffff', rimLevel: 0, skyColor: '#ffe9cf', ambLevel: 0.5 },
    soft: { label: 'Overcast', keyColor: '#ffffff', keyLevel: 0.4, fillColor: '#ffffff', fillLevel: 1.4, rimColor: '#ffffff', rimLevel: 0, skyColor: '#f4f7ff', ambLevel: 1.6 },
    three: { label: 'Three lights', keyColor: '#fff1dc', keyLevel: 1.05, fillColor: '#d9e5ff', fillLevel: 1.1, rimColor: '#ffffff', rimLevel: 1.3, skyColor: '#ffffff', ambLevel: 0.75 },
    neon: { label: 'Pink and cyan', keyColor: '#fc0289', keyLevel: 0.95, fillColor: '#00fced', fillLevel: 2.2, rimColor: '#7647f2', rimLevel: 1.6, skyColor: '#55557a', ambLevel: 0.45 },
    dusk: { label: 'Dusk', keyColor: '#ffab66', keyLevel: 1.2, fillColor: '#5b7cff', fillLevel: 1.2, rimColor: '#ff5aa0', rimLevel: 0.8, skyColor: '#9aa6d8', ambLevel: 0.55 }
  };
  var RAINBOW = ['#f03060', '#f12fbf', '#c728f8', '#7647f2', '#5174ed', '#50beeb', '#68f4d7', '#70f899', '#7af85c', '#c0f848', '#e8cb40', '#e86828'];      // Jumperless's own, from the site theme
  function hex(c) { return typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16); }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; }
  function tex(c) { var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; t.minFilter = T.LinearMipmapLinearFilter; t.needsUpdate = true; return t; }

  var R = { renderer: null, scene: null, lights: {}, env: null, ground: null, bgTex: null, cache: {}, mats: {} };

  // a small lit room, rendered once into an environment map, so metal and gloss have something to reflect
  function makeEnv(renderer) {
    try {
      var s = new T.Scene(), box = new T.Mesh(new T.BoxGeometry(40, 24, 40), new T.MeshBasicMaterial({ color: 0x1c1c20, side: T.BackSide })); s.add(box);
      function panel(w, h, x, y, z, rx, ry, c) { var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); s.add(m); }
      panel(13, 8, -3, 11.5, 2, Math.PI / 2, 0, 0xffffff);          // ceiling soft box
      panel(8, 6, -19.5, 4, 4, 0, Math.PI / 2, 0x9db8e8);          // cool window, left
      panel(5, 8, 19.5, 3, -6, 0, Math.PI / 2, 0xffc890);          // warm lamp, right
      panel(14, 2.5, 0, 0, -19.5, 0, 0, 0x6a6f79);                   // low strip, back
      var floor = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshBasicMaterial({ color: 0x0e0e10 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -11.9; s.add(floor);
      var pm = new T.PMREMGenerator(renderer), rt = pm.fromScene(s, 0.03);
      pm.dispose(); return rt.texture;
    } catch (e) { return null; }
  }

  function setup(renderer, scene) {
    R.renderer = renderer; R.scene = scene;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    var L = R.lights;
    L.hemi = new T.HemisphereLight(0xffffff, 0x8c9299, 0.95); scene.add(L.hemi);
    L.key = new T.DirectionalLight(0xffffff, 0.75); L.key.position.set(-70, 190, 110);
    L.key.shadow.mapSize.set(2048, 2048); L.key.shadow.bias = -0.0006; L.key.shadow.normalBias = 0.05; L.key.shadow.radius = 4;
    var sc = L.key.shadow.camera; sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 10; sc.far = 600;
    scene.add(L.key); scene.add(L.key.target);
    L.fill = new T.DirectionalLight(0xffffff, 0.3); L.fill.position.set(160, 60, -120); scene.add(L.fill);
    L.rim = new T.DirectionalLight(0xffffff, 0); scene.add(L.rim); scene.add(L.rim.target);
    R.env = makeEnv(renderer);
    R.ground = new T.Group(); scene.add(R.ground);
  }

  // a small repeatable random source, so a texture is the same picture every time
  function rng(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var texCache = {};
  // backdrops that are a picture behind everything (they do not turn with the view)
  function bgTexture(kind) {
    if (texCache['bg:' + kind]) return texCache['bg:' + kind];
    var c = canvas(512, 512), g = c.getContext('2d'), gr, i;
    if (kind === 'blueprint') {
      g.fillStyle = '#0f2f5e'; g.fillRect(0, 0, 512, 512);
      for (i = 0; i <= 512; i += 16) { g.strokeStyle = i % 64 === 0 ? 'rgba(170,205,255,0.30)' : 'rgba(170,205,255,0.11)'; g.lineWidth = 1; g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 512); g.moveTo(0, i + 0.5); g.lineTo(512, i + 0.5); g.stroke(); }
    } else if (kind === 'dusk') {
      gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#15123a'); gr.addColorStop(0.42, '#4a2466'); gr.addColorStop(0.66, '#c95f55'); gr.addColorStop(0.74, '#f0a35a'); gr.addColorStop(0.8, '#3a2338'); gr.addColorStop(1, '#161019');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    } else if (kind === 'rainbow') {
      g.fillStyle = '#19191c'; g.fillRect(0, 0, 512, 512);
      gr = g.createLinearGradient(0, 0, 512, 0); RAINBOW.forEach(function (col, j) { gr.addColorStop(j / (RAINBOW.length - 1), col); });
      g.fillStyle = gr; g.globalAlpha = 0.55; g.fillRect(0, 300, 512, 6); g.globalAlpha = 1;
      var fade = g.createLinearGradient(0, 120, 0, 512); fade.addColorStop(0, 'rgba(25,25,28,0)'); fade.addColorStop(0.36, 'rgba(25,25,28,0)'); fade.addColorStop(1, 'rgba(25,25,28,1)');
      g.fillStyle = gr; g.globalAlpha = 0.16; g.fillRect(0, 150, 512, 362); g.globalAlpha = 1; g.fillStyle = fade; g.fillRect(0, 306, 512, 206);
    } else if (kind === 'slate') {
      gr = g.createRadialGradient(256, 230, 20, 256, 256, 380); gr.addColorStop(0, '#454852'); gr.addColorStop(0.6, '#26272c'); gr.addColorStop(1, '#101013');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    } else {                                       // studio: a soft fade, lighter at the top
      gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#4a4b52'); gr.addColorStop(0.55, '#2c2c31'); gr.addColorStop(1, '#17171a');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    }
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return (texCache['bg:' + kind] = t);
  }
  function tile(c, mm, total) { var t = tex(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(total / mm, total / mm); return t; }
  // surfaces to stand the unit on. mat: a cutting mat, 10 mm squares. wood: a bench top. steel: a brushed plate.
  function groundTexture(kind) {
    if (texCache['g:' + kind]) return texCache['g:' + kind];
    var c = canvas(512, 512), g = c.getContext('2d'), r = rng(kind.length * 977 + 5), i, y;
    if (kind === 'mat') {
      g.fillStyle = '#1f4a3c'; g.fillRect(0, 0, 512, 512);
      for (i = 0; i < 1600; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.02 + r() * 0.03) + ')'; g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2); }
      for (i = 0; i <= 5; i++) { var q = i * 102.4; g.strokeStyle = i === 0 || i === 5 ? 'rgba(235,245,225,0.75)' : 'rgba(235,245,225,0.36)'; g.lineWidth = i === 0 || i === 5 ? 3 : 1.4; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, 512); g.moveTo(0, q); g.lineTo(512, q); g.stroke(); }
      return (texCache['g:' + kind] = tile(c, 50, 700));
    }
    if (kind === 'wood') {
      g.fillStyle = '#8b6a45'; g.fillRect(0, 0, 512, 512);
      for (i = 0; i < 520; i++) { y = r() * 512; var a = 2 + r() * 5, ph = r() * 6.3, wl = 140 + r() * 260; g.strokeStyle = 'rgba(' + (r() > 0.35 ? '58,36,16' : '214,176,128') + ',' + (0.05 + r() * 0.13) + ')'; g.lineWidth = 0.6 + r() * 1.8; g.beginPath();
        var cyc = 1 + Math.floor(wl / 140); for (var x = 0; x <= 512; x += 16) { var yy = y + Math.sin(x / 512 * 6.2832 * cyc + ph) * a; if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy); } g.stroke(); }
      [0, 256].forEach(function (s) { g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(0, s, 512, 2); g.fillStyle = 'rgba(255,235,200,0.10)'; g.fillRect(0, s + 2, 512, 1.5); });
      return (texCache['g:' + kind] = tile(c, 180, 700));
    }
    g.fillStyle = '#9da2a8'; g.fillRect(0, 0, 512, 512);                                                    // steel: fine lines one way
    for (i = 0; i < 2600; i++) { y = r() * 512; g.strokeStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '40,44,50') + ',' + (0.03 + r() * 0.09) + ')'; g.lineWidth = 0.5 + r(); g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    return (texCache['g:' + kind] = tile(c, 120, 700));
  }
  // What a board's face is made of, repeated in millimetres (an extruded board's texture coordinates are its plan in mm).
  // fine: the slight orange peel of soldermask. weave: the glass cloth showing through. traces: tracks and vias under the mask.
  function boardTexture(kind, maskHex) {
    var key = 'b:' + kind + ':' + (kind === 'traces' ? maskHex : ''); if (texCache[key]) return texCache[key];
    var c = canvas(512, 512), g = c.getContext('2d'), r = rng(kind.length * 131 + 7), i, out = {};
    if (kind === 'fine') {
      var im = g.createImageData(512, 512); for (i = 0; i < im.data.length; i += 4) { var v = 110 + r() * 60; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0);
      out.bump = tile(c, 9, 1); out.bumpScale = 0.012; out.rough = 0.6;
    } else if (kind === 'weave') {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
      for (i = 0; i < 16; i++) for (var j = 0; j < 16; j++) { var over = (i + j) % 2 === 0; g.fillStyle = over ? '#b4b4b4' : '#5c5c5c'; g.fillRect(i * 32 + 2, j * 32 + 2, 28, 28); g.fillStyle = over ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'; if (over) g.fillRect(i * 32 + 2, j * 32 + 12, 28, 8); else g.fillRect(i * 32 + 12, j * 32 + 2, 8, 28); }
      out.bump = tile(c, 6.4, 1); out.bumpScale = 0.02; out.rough = 0.66;
    } else {                                           // traces: 51.2 mm of made-up routing at 10 px a mm, drawn so the tile joins itself
      var base = new T.Color(maskHex), cu = new T.Color('#c07a3a'), lit = base.clone().lerp(cu, 0.2).lerp(new T.Color('#ffffff'), 0.05), c2 = canvas(512, 512), g2 = c2.getContext('2d');
      g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 512, 512); g2.fillStyle = '#6a6a6a'; g2.fillRect(0, 0, 512, 512);
      var draw = function (fn) { for (var ox = -512; ox <= 512; ox += 512) for (var oy = -512; oy <= 512; oy += 512) { [g, g2].forEach(function (cx, n) { cx.save(); cx.translate(ox, oy); cx.strokeStyle = cx.fillStyle = n ? '#b8b8b8' : '#' + lit.getHexString(); fn(cx, n); cx.restore(); }); } };
      for (i = 0; i < 64; i++) (function () {
        var x = r() * 512, y = r() * 512, w = [2, 2, 2.5, 3, 4, 6][Math.floor(r() * 6)], pts = [[x, y]], dir = Math.floor(r() * 8), n = 2 + Math.floor(r() * 4), k;
        for (k = 0; k < n; k++) { var len = 20 + r() * 130, a = dir * Math.PI / 4; x += Math.cos(a) * len; y += Math.sin(a) * len; pts.push([x, y]); dir = (dir + (r() > 0.5 ? 1 : 7)) % 8; }
        draw(function (cx) { cx.lineWidth = w; cx.lineJoin = 'round'; cx.lineCap = 'round'; cx.beginPath(); pts.forEach(function (q, m) { if (m) cx.lineTo(q[0], q[1]); else cx.moveTo(q[0], q[1]); }); cx.stroke();
          [pts[0], pts[pts.length - 1]].forEach(function (q) { cx.beginPath(); cx.arc(q[0], q[1], 3.2, 0, 6.3); cx.fill(); }); });
      })();
      for (i = 0; i < 5; i++) (function () { var x = r() * 512, y = r() * 512, w = 30 + r() * 70, h = 30 + r() * 60; draw(function (cx) { cx.globalAlpha = 0.85; cx.fillRect(x, y, w, h); cx.globalAlpha = 1; }); })();
      out.map = tile(c, 51.2, 1); out.bump = tile(c2, 51.2, 1); out.bump.encoding = T.LinearEncoding; out.bumpScale = 0.02; out.rough = 0.52;
    }
    if (out.bump) out.bump.encoding = T.LinearEncoding;
    return (texCache[key] = out);
  }
  function shellTexture() {                         // a printed shell: 0.24 mm layers up the walls
    if (texCache.shell) return texCache.shell;
    var c = canvas(8, 64), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#404040'); gr.addColorStop(0.5, '#c8c8c8'); gr.addColorStop(1, '#404040'); g.fillStyle = gr; g.fillRect(0, 0, 8, 64);
    var t = tex(c); t.encoding = T.LinearEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(0.1, 1 / 0.24); return (texCache.shell = t);
  }

  // S: { mode, bg, ground, shadows, exposure, light, sun } ; box: { x0, x1, y0, y1, zb } the unit's extent in plan and its underside
  function apply(S, box) {
    var r = R.renderer, sc = R.scene, L = R.lights, real = S.mode === 'real';
    r.toneMapping = real ? T.ACESFilmicToneMapping : T.NoToneMapping;
    r.toneMappingExposure = real ? (S.exposure || 1) : 1;
    sc.environment = real ? R.env : null;
    var k = S.light != null ? S.light : 1;
    // the rig colours the lights only in the Real drawing; the flat ones stay white so a layer's colour is its colour
    var num = function (v, d) { return v != null && !isNaN(+v) ? +v : d; }, col = function (light, c) { light.color.set(real && c ? c : '#ffffff').convertSRGBToLinear(); };
    col(L.key, S.keyColor); col(L.fill, S.fillColor); col(L.rim, S.rimColor); col(L.hemi, S.skyColor);
    L.hemi.intensity = (real ? 0.55 * num(S.ambLevel, 1) : 1.0) * k; L.key.intensity = (real ? 1.9 * num(S.keyLevel, 1) : 1.0) * k; L.fill.intensity = 0.45 * (real ? num(S.fillLevel, 1) : 1) * k;
    L.rim.intensity = real ? 1.1 * num(S.rimLevel, 0) * k : 0;
    var az = ((S.sun != null ? S.sun : 215) * Math.PI) / 180, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    L.key.position.set(cx + Math.sin(az) * 120, 190, cy + Math.cos(az) * 120); L.key.target.position.set(cx, 0, cy); L.key.target.updateMatrixWorld();
    L.key.castShadow = real && S.shadows !== false;
    L.rim.position.set(cx - Math.sin(az) * 150, 55, cy - Math.cos(az) * 150); L.rim.target.position.set(cx, 0, cy); L.rim.target.updateMatrixWorld();
    var bg = BG[S.bg] !== undefined ? BG[S.bg] : BG.console;
    if (S.mode === 'lines' && S.bg !== 'clear' && S.bg !== 'paper' && S.bg !== 'white') bg = BG.deep;
    if (bg === null) { sc.background = null; r.setClearColor(0x000000, 0); }
    else if (bg === 'tex') { sc.background = bgTexture(S.bg); }
    else if (bg === 'custom') { sc.background = new T.Color(S.bgColor || '#27272b').convertSRGBToLinear(); }
    else { sc.background = new T.Color(bg); }
    // the bench: a shadow catcher, or a 0.1 inch grid that lines up with the breadboard's holes
    var G = R.ground; while (G.children.length) { var c = G.children.pop(); if (c.geometry) c.geometry.dispose(); }
    var z = box.zb - (S.ground === 'grid' ? 0.02 : 0.02), light = S.bg === 'paper' || S.bg === 'white';
    if ((S.ground === 'mat' || S.ground === 'wood' || S.ground === 'steel') && S.mode !== 'lines') {
      // a real surface under the unit: 700 mm square, its picture repeated, taking the shadow itself
      var gt = groundTexture(S.ground), gm = new T.Mesh(new T.PlaneGeometry(700, 700), new T.MeshStandardMaterial({ map: gt, roughness: S.ground === 'steel' ? 0.38 : S.ground === 'wood' ? 0.62 : 0.92, metalness: S.ground === 'steel' ? 0.75 : 0, envMapIntensity: S.ground === 'steel' ? 0.6 : 0.25 }));
      gm.rotation.x = -Math.PI / 2; gm.position.set(cx, z, cy); gm.receiveShadow = true; G.add(gm);
    }
    if (S.ground === 'shadow' && real && S.shadows !== false) {
      var pl = new T.Mesh(new T.PlaneGeometry(900, 900), new T.ShadowMaterial({ opacity: light ? 0.22 : 0.42 })); pl.rotation.x = -Math.PI / 2; pl.position.set(cx, z, cy); pl.receiveShadow = true; G.add(pl);
    } else if (S.ground === 'grid') {
      var p = 2.54, n0 = Math.floor((box.x0 - 30) / p), n1 = Math.ceil((box.x1 + 30) / p), m0 = Math.floor((box.y0 - 30) / p), m1 = Math.ceil((box.y1 + 30) / p), a = [], b = [], i;
      for (i = n0; i <= n1; i++) (i % 10 === 0 ? b : a).push(i * p, z, m0 * p, i * p, z, m1 * p);
      for (i = m0; i <= m1; i++) (i % 10 === 0 ? b : a).push(n0 * p, z, i * p, n1 * p, z, i * p);
      [[a, 0.16], [b, 0.4]].forEach(function (q) { var ge = new T.BufferGeometry(); ge.setAttribute('position', new T.Float32BufferAttribute(q[0], 3)); G.add(new T.LineSegments(ge, new T.LineBasicMaterial({ color: light ? 0x30333a : 0xaaaab5, transparent: true, opacity: q[1] }))); });
      if (real && S.shadows !== false) { var p2 = new T.Mesh(new T.PlaneGeometry(900, 900), new T.ShadowMaterial({ opacity: light ? 0.2 : 0.36 })); p2.rotation.x = -Math.PI / 2; p2.position.set(cx, z - 0.01, cy); p2.receiveShadow = true; G.add(p2); }
    }
  }

  // ---------- materials ----------
  function std(key, make) { if (!R.mats[key]) R.mats[key] = make(); return R.mats[key]; }
  function plain(color, o) {
    o = o || {};
    var key = 'p:' + color + ':' + (o.opacity || 1) + ':' + (o.metal || 0) + ':' + (o.rough != null ? o.rough : '') + ':' + (o.side || 0);
    return std(key, function () { return new T.MeshStandardMaterial({ color: color, roughness: o.rough != null ? o.rough : 0.7, metalness: o.metal || 0.05, transparent: (o.opacity || 1) < 1, opacity: o.opacity || 1, depthWrite: (o.opacity || 1) >= 1, side: o.side ? T.DoubleSide : T.FrontSide }); });
  }
  // a board: [faces, cut edge]. real = soldermask gloss over the faces and bare FR4 on the edge; otherwise the layer's flat colour
  function board(mode, layerColor, look) {
    if (mode !== 'real') return plain(hex(layerColor), { rough: 0.75 });
    var mk = MASK[look.mask] || MASK.black, tx = look.texture && look.texture !== 'smooth' ? look.texture : '', key = 'b:' + mk + ':' + (look.plated ? look.finish || 'enig' : '') + ':' + tx;
    return std(key, function () {
      var face = new T.MeshPhysicalMaterial({ color: hex(mk), roughness: 0.5, metalness: 0.0, clearcoat: 0.2, clearcoatRoughness: 0.4, envMapIntensity: 0.35 });
      if (tx) { var bt = boardTexture(tx, mk); if (bt.map) { face.map = bt.map; face.color.set(0xffffff); } face.bumpMap = bt.bump; face.bumpScale = bt.bumpScale; face.roughness = bt.rough; }
      // the cut edge: bare FR4. On the face board (plated: true) it is mostly hole wall, so it is drawn as plating instead.
      var edge = look.plated ? new T.MeshStandardMaterial({ color: hex((FINISH[look.finish] || FINISH.enig)[1]), roughness: 0.5, metalness: 0.7, envMapIntensity: 0.5 }) : new T.MeshStandardMaterial({ color: look.mask === 'white' ? 0xa89f7c : 0x5f5738, roughness: 0.9, metalness: 0 });
      return [face, edge];
    });
  }
  function shell(mode, look) {
    var k = look.shell || 'black';
    if (mode !== 'real') return plain(0x26282c, { rough: 0.9 });
    var printed = look.shellTex === 'printed';
    return std('s:' + k + (printed ? ':p' : ''), function () {
      var m = k === 'clear' ? new T.MeshPhysicalMaterial({ color: SHELL.clear, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 0.4 }) : new T.MeshStandardMaterial({ color: SHELL[k] || SHELL.black, roughness: 0.62, metalness: 0.02 });
      if (printed) { m.bumpMap = shellTexture(); m.bumpScale = 0.03; m.roughness = k === 'clear' ? 0.4 : 0.72; }
      return m;
    });
  }
  function part(mode, color, o) {
    o = o || {};
    if (mode !== 'real') return plain(color, o);
    var c = new T.Color(color), lum = Math.max(c.r, c.g, c.b), metal = o.metal != null ? o.metal : (lum > 0.6 ? 0.85 : 0.1);
    return std('q:' + color + ':' + metal + ':' + (o.rough != null ? o.rough : ''), function () { return new T.MeshStandardMaterial({ color: color, roughness: o.rough != null ? o.rough : (metal > 0.5 ? 0.28 : 0.55), metalness: metal, envMapIntensity: metal > 0.5 ? 1.0 : 0.6 }); });
  }

  // ---------- painted faces ----------
  function decalMesh(texture, x0, y0, x1, y1, z, o) {
    o = o || {};
    var g = new T.PlaneGeometry(x1 - x0, y1 - y0); g.rotateX(-Math.PI / 2);
    var m = new T.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: o.alphaTest != null ? o.alphaTest : 0.02, roughness: o.rough != null ? o.rough : 0.4, metalness: o.metal || 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (o.emissiveMap) { m.emissiveMap = o.emissiveMap; m.emissive = new T.Color(0xffffff); m.emissiveIntensity = o.emissive || 1; }
    var mesh = new T.Mesh(g, m); mesh.position.set((x0 + x1) / 2, z, (y0 + y1) / 2); mesh.userData.decal = true; mesh.renderOrder = 2; return mesh;
  }
  function ledColor(mode, x, y, face) {
    if (mode === 'rainbow') return RAINBOW[Math.max(0, Math.min(11, Math.floor((x / 78.74) * 12)))];
    if (mode === 'rails') { var top = y < 9, bot = y > 46; if (top || bot) return (y < 5 || (bot && y < 50.5)) ? '#ff3b30' : '#3aa0ff'; return null; }
    if (mode === 'probe') { var d = Math.hypot(x - 40.64, y - 23.9); return d < 9 ? (d < 3 ? '#ffffff' : d < 6 ? '#fc0289' : '#7a1d6a') : null; }
    return null;
  }
  // the Wiiig face board, from the same hole list as the geometry. px per mm = s.
  function faceDecal(face, look, z) {
    if (!face || !face.holes) return null;
    var key = 'face:' + (look.face_mask || 'black') + ':' + (look.finish || 'enig') + ':' + (look.silk || 'white') + ':' + (look.leds || 'off') + ':' + face.holes.length + ':' + face.y0;
    var e = R.cache[key];
    if (!e) {
      var s = 24, xs = face.pts.map(function (q) { return q[0]; }), ys = face.pts.map(function (q) { return q[1]; });
      var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
      var c = canvas((x1 - x0) * s, (y1 - y0) * s), g = c.getContext('2d'), gold = FINISH[look.finish] || FINISH.enig, mask = MASK[look.face_mask] || MASK.black;
      var em = look.leds && look.leds !== 'off' ? canvas(c.width / 2, c.height / 2) : null, ge = em && em.getContext('2d');
      if (ge) { ge.fillStyle = '#000'; ge.fillRect(0, 0, em.width, em.height); }
      function X(x) { return (x - x0) * s; } function Y(y) { return (y - y0) * s; }
      g.beginPath(); face.pts.forEach(function (q, i) { if (i) g.lineTo(X(q[0]), Y(q[1])); else g.moveTo(X(q[0]), Y(q[1])); }); g.closePath(); g.fillStyle = mask; g.fill();
      // column numbers in the two clear bands between the rails and the rows (drawn, not from a file)
      var big = face.holes.filter(function (h) { return h[2] > 1.5; }), rows = []; big.forEach(function (h) { if (rows.indexOf(h[1]) < 0) rows.push(h[1]); }); rows.sort(function (a, b) { return a - b; });
      var bands = []; for (var i = 1; i < rows.length; i++) if (rows[i] - rows[i - 1] > 5) bands.push((rows[i] + rows[i - 1]) / 2);
      g.fillStyle = SILK[look.silk] || SILK.white; g.font = '600 ' + Math.round(1.5 * s) + 'px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      bands.forEach(function (by) { for (var k = 1; k <= 30; k++) if (k === 1 || k % 5 === 0) g.fillText(String(k), X(k * 2.54), Y(by)); });
      face.holes.forEach(function (h) {
        var cx = X(h[0]), cy = Y(h[1]), rt = h[2] / 2 * s, rb = h[3] / 2 * s, csk = h[2] > h[3] + 0.05;
        g.beginPath(); g.arc(cx, cy, rt + (csk ? 0.26 : 0.19) * s, 0, 6.2832); g.fillStyle = gold[0]; g.fill();          // the gold land
        if (csk) { var gr = g.createRadialGradient(cx, cy, rb, cx, cy, rt); gr.addColorStop(0, gold[1]); gr.addColorStop(1, gold[0]); g.beginPath(); g.arc(cx, cy, rt, 0, 6.2832); g.fillStyle = gr; g.fill(); }
        g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx, cy, rb, 0, 6.2832); g.fill(); g.globalCompositeOperation = 'source-over';
        if (ge && csk) { var col = ledColor(look.leds, h[0], h[1]); if (col) { var ex = cx / 2, ey = cy / 2, rr = 1.25 * s / 2, eg = ge.createRadialGradient(ex, ey, 0, ex, ey, rr); eg.addColorStop(0, col); eg.addColorStop(0.45, col); eg.addColorStop(1, 'rgba(0,0,0,0)'); ge.fillStyle = eg; ge.beginPath(); ge.arc(ex, ey, rr, 0, 6.2832); ge.fill(); } }
      });
      e = R.cache[key] = { map: tex(c), em: em ? tex(em) : null, box: [x0, y0, x1, y1] };
    }
    return decalMesh(e.map, e.box[0], e.box[1], e.box[2], e.box[3], z, { alphaTest: 0.5, rough: 0.38, metal: 0.25, emissiveMap: e.em, emissive: 1.6 });
  }
  // gold lands with their holes, painted on a board that is drawn solid (the 2 x 35 card-edge holes of the wig's bottom board)
  function padsDecal(holes, look, z) {
    var key = 'pads:' + holes.length + ':' + holes[0][0] + ':' + holes[0][1] + ':' + (look.finish || 'enig'), e = R.cache[key];
    if (!e) {
      var s = 28, xs = holes.map(function (h) { return h[0]; }), ys = holes.map(function (h) { return h[1]; });
      var x0 = Math.min.apply(0, xs) - 1, x1 = Math.max.apply(0, xs) + 1, y0 = Math.min.apply(0, ys) - 1, y1 = Math.max.apply(0, ys) + 1;
      var c = canvas((x1 - x0) * s, (y1 - y0) * s), g = c.getContext('2d'), gold = FINISH[look.finish] || FINISH.enig;
      holes.forEach(function (h) { var cx = (h[0] - x0) * s, cy = (h[1] - y0) * s; g.beginPath(); g.arc(cx, cy, (h[2] / 2 + 0.19) * s, 0, 6.2832); g.fillStyle = gold[0]; g.fill(); g.beginPath(); g.arc(cx, cy, h[3] / 2 * s, 0, 6.2832); g.fillStyle = '#0a0a0b'; g.fill(); });
      e = R.cache[key] = { map: tex(c), box: [x0, y0, x1, y1] };
    }
    return decalMesh(e.map, e.box[0], e.box[1], e.box[2], e.box[3], z, { alphaTest: 0.5, rough: 0.38, metal: 0.25 });
  }
  // the bare shell's top: the 16 x 30 square holes with a glint of the clip in each (when there is no face board)
  function shellDecal(wig, look, z) {
    var key = 'shell:' + (look.shell || 'black') + ':' + (look.leds || 'off');
    var e = R.cache[key], sh = wig.shell;
    if (!e) {
      var s = 20, c = canvas(sh.w * s, sh.h * s), g = c.getContext('2d'), dark = look.shell === 'white' ? '#55565a' : '#050506';
      wig.cols.forEach(function (cx) { wig.rows.forEach(function (cy) {
        var x = (cx - sh.x0) * s, y = (cy - sh.y0) * s, h = 1.0 * s, col = ledColor(look.leds, cx, cy);
        g.fillStyle = dark; g.fillRect(x - h, y - h, 2 * h, 2 * h);
        g.fillStyle = col || '#7d6a35'; g.globalAlpha = col ? 0.95 : 0.55; g.fillRect(x - h * 0.28, y - h * 0.8, h * 0.56, h * 1.6); g.globalAlpha = 1;
      }); });
      e = R.cache[key] = { map: tex(c) };
    }
    return decalMesh(e.map, sh.x0, sh.y0, sh.x0 + sh.w, sh.y0 + sh.h, z, { rough: 0.6 });
  }
  // silkscreen on a board's top face: an outline and a name for each part that sits on it
  function boardDecal(L, parts, box, look) {
    var mine = parts.filter(function (p) { return !p.system && p.mountLayer === L.id && !p.bottom && p.bodies.length; });
    if (!mine.length) return null;
    var s = 10, c = canvas((box.x1 - box.x0) * s, (box.y1 - box.y0) * s), g = c.getContext('2d');
    g.strokeStyle = g.fillStyle = SILK[look.silk] || SILK.white; g.lineWidth = 0.15 * s; g.lineJoin = 'round';
    g.font = '600 ' + Math.round(1.25 * s) + 'px "Archivo Narrow", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    mine.forEach(function (p) {
      var b = p.bodies[0].pts, ymax = -1e9, xa = 0;
      g.beginPath(); b.forEach(function (q, i) { var x = (q[0] - box.x0) * s, y = (q[1] - box.y0) * s; if (i) g.lineTo(x, y); else g.moveTo(x, y); ymax = Math.max(ymax, q[1]); xa += q[0] / b.length; }); g.closePath(); g.stroke();
      g.fillText(String(p.id).toUpperCase(), (xa - box.x0) * s, (ymax + 0.35 - box.y0) * s);
    });
    var t = tex(c);
    return decalMesh(t, box.x0, box.y0, box.x1, box.y1, L.z1 + 0.012, { rough: 0.9 });
  }
  // a lit screen: a made-up picture in the display's active area, so it reads as a display
  function screenMesh(p, scr, z) {
    var key = 'scr:' + scr.w + 'x' + scr.h, e = R.cache[key];
    if (!e) {
      var s = 16, c = canvas(scr.w * s, scr.h * s), g = c.getContext('2d'), W = c.width, H = c.height;
      g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#2a2a30'; g.lineWidth = 1; for (var i = 1; i < 8; i++) { g.beginPath(); g.moveTo(0, H * i / 8); g.lineTo(W, H * i / 8); g.stroke(); }
      for (i = 1; i < 4; i++) { g.beginPath(); g.moveTo(W * i / 4, 0); g.lineTo(W * i / 4, H); g.stroke(); }
      function trace(col, f, ph, amp, mid) { g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.12); g.beginPath(); for (var y = 0; y <= H; y += 2) { var x = W * mid + Math.sin(y / H * 6.2832 * f + ph) * W * amp; if (y) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
      trace('#00fced', 3, 0.4, 0.16, 0.32); trace('#fc0289', 5, 1.2, 0.1, 0.7);
      g.fillStyle = '#f3f3f5'; g.font = '600 ' + Math.round(s * 1.5) + 'px "Archivo Narrow", "Arial Narrow", sans-serif'; g.save(); g.translate(W - s * 0.6, s * 0.8); g.rotate(Math.PI / 2); g.fillText('V6  ROW 14  3.30 V', 0, 0); g.restore();
      e = R.cache[key] = { map: tex(c) };
    }
    var ge = new T.PlaneGeometry(scr.w, scr.h); ge.rotateX(-Math.PI / 2);
    var m = new T.Mesh(ge, new T.MeshBasicMaterial({ map: e.map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    var grp = new T.Group(); grp.position.set(p.x, z, p.y); grp.rotation.y = p.rot * Math.PI / 180; m.position.set(0, 0, scr.cy); grp.add(m); m.userData.decal = true; m.userData.noLines = true; return grp;
  }

  // ---------- after the scene is built: dress it for the chosen way of looking ----------
  var xray = {}, hidden = null, lineMats = {};
  // the frame's boards drawn part see-through (Board opacity): a copy of each material, kept per opacity
  var fadeCache = {};
  function faded(m, op) {
    if (Array.isArray(m)) return m.map(function (x) { return faded(x, op); });
    var key = m.uuid + ':' + op;
    if (!fadeCache[key]) { var c = m.clone(); c.transparent = true; c.opacity = (m.opacity != null ? m.opacity : 1) * op; c.depthWrite = op > 0.85; fadeCache[key] = c; }
    return fadeCache[key];
  }
  function finish(groups, S) {
    var mode = S.mode;
    if (!hidden) hidden = new T.MeshBasicMaterial({ visible: false });
    var bo = S.boardOpacity != null ? Math.max(0.05, Math.min(1, Math.round(S.boardOpacity * 20) / 20)) : 1, fadeBoards = bo < 0.999 && (mode === 'real' || mode === 'tech');
    groups.forEach(function (grp) { grp.traverse(function (o) {
      if (fadeBoards && o.isMesh && o.userData.isBoard) o.material = faded(o.material, bo);
      if (o.isLineSegments && o.userData.edge) { o.visible = mode !== 'real' || S.edges === true; if (mode === 'lines') { var lc = o.userData.lineColor || 0xf3f3f5; o.material = lineMats[lc] || (lineMats[lc] = new T.LineBasicMaterial({ color: lc })); } return; }
      if (!o.isMesh) return;
      if (o.userData.decal) { o.visible = mode === 'real'; return; }
      o.castShadow = o.receiveShadow = mode === 'real' && !o.material.transparent;
      if (mode === 'xray') {
        var src = Array.isArray(o.material) ? o.material[0] : o.material, c = src.color ? src.color.getHex() : 0x999999;
        if (!xray[c]) { xray[c] = new T.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.9, side: T.DoubleSide }); xray[c].userData.lin = !!src.userData.lin; }
        o.material = xray[c];
      } else if (mode === 'lines') {
        if (!o.userData.hasEdges && o.geometry && !o.userData.noLines) {
          var eg = o.geometry.userData.edges || (o.geometry.userData.edges = new T.EdgesGeometry(o.geometry, 32));
          var src2 = Array.isArray(o.material) ? o.material[0] : o.material, lc2 = o.userData.lineColor || (src2.color && src2.color.getHex() > 0x303030 ? src2.color.getHex() : 0xaaaab5);
          var ls = new T.LineSegments(eg, lineMats[lc2] || (lineMats[lc2] = new T.LineBasicMaterial({ color: lc2 }))); ls.userData.edge = true; ls.userData.extra = true; o.add(ls); o.userData.hasEdges = true;
        }
        o.material = hidden;
      }
    }); });
  }
  // three r128 takes a material's colour as linear light, while every colour in this tool is written the way a screen shows it
  // (sRGB). Each material is converted once, the first time it is seen, so black soldermask is black and not grey.
  function linear(groups) {
    groups.forEach(function (grp) { if (grp) grp.traverse(function (o) { if (!o.material) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
      if (m.userData.lin || !m.color) return; m.userData.lin = true; if (!m.map || !m.userData.keepWhite) m.color.convertSRGBToLinear();
    }); }); });
  }
  function refreshMaterials(scene) { scene.traverse(function (o) { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); }); }
  function png(renderer, scene, camera, scale) {
    var el = renderer.domElement, w = el.width, h = el.height, pr = renderer.getPixelRatio();
    try { if (scale && scale !== 1) { renderer.setPixelRatio(pr * scale); renderer.setSize(el.clientWidth, el.clientHeight, false); } renderer.render(scene, camera); var url = el.toDataURL('image/png'); return url; }
    finally { if (scale && scale !== 1) { renderer.setPixelRatio(pr); renderer.setSize(el.clientWidth, el.clientHeight, false); renderer.render(scene, camera); } }
  }

  root.V6Render = { setup: setup, apply: apply, plain: plain, board: board, shell: shell, part: part, faceDecal: faceDecal, padsDecal: padsDecal, shellDecal: shellDecal, boardDecal: boardDecal, screenMesh: screenMesh, finish: finish, linear: linear, refreshMaterials: refreshMaterials, png: png,
    MASK: MASK, SILK: SILK, FINISH: FINISH, RAINBOW: RAINBOW, BG: BG, RIGS: RIGS, clearCache: function () { R.cache = {}; } };
})(typeof self !== 'undefined' ? self : this);
