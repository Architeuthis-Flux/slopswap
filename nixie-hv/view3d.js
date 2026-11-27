// Nixie HV supply: the 3D preview of the generated board, or of the two stacked boards.
// The lighting, materials, mesh format, camera moves and view buttons are the Jumperless V6 outline viewer's (v6mech):
// three.min.js (r128), OrbitControls.js and render.js beside this file are its files, unchanged, and the code below
// follows its viewer.js. Part bodies and pads are KiCad's own 3D models, packed by prep_models.mjs into nixie-models.js.
// It draws what the page's layout gives it (window.NIXIE.state()) and decides no geometry of its own.
(function (root) {
  'use strict';

  // ---------- placement maths: plain numbers, so check3d.mjs can run the same code under node ----------
  // Frames. Footprint: x right, y down (KiCad), z up from the face the part sits on. Board: the same, origin at the board's
  // corner. Stack: board 1's frame; board 2 lies parts-down a gap above it and opens like a book about their shared long edge.
  // A 3 x 4 matrix is twelve numbers, row by row.
  function variant(V, vk) {                      // how a placed variant turns the footprint: [a, b, c, d], x' = a x + b y, y' = c x + d y
    if (V[vk]) return V[vk];
    var f = V['F' + vk.slice(1)];                // a bottom-side variant is the top-side one with y mirrored first
    return f ? [f[0], -f[1], f[2], -f[3]] : null;
  }
  // footprint -> board. A bottom-side variant mirrors the plan, so the part goes through the board to the other face;
  // outside: a through-hole part mounted from the far face (its pads stay where they are, its body goes through).
  function onBoard(M, ox, oy, T, outside) {
    var under = M[0] * M[3] - M[1] * M[2] < 0 || !!outside;
    return [M[0], M[1], 0, ox, M[2], M[3], 0, oy, 0, 0, under ? -1 : 1, under ? -T : 0];
  }
  // board -> stack. Board 1 (b = 0) is the stack's frame. Board 2 closed is at (x, W - y, G - z); open turns it by `open`
  // radians about the line y = W, z = G / 2, so at pi it lies beside board 1, parts up, at the same level.
  function inStack(b, W, G, open) {
    if (!b) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    var c = Math.cos(open || 0), s = Math.sin(open || 0);
    // closed: y1 = W - y, z1 = G - z.  then  y2 = W + (y1 - W) c + (z1 - G/2) s,  z2 = G/2 - (y1 - W) s + (z1 - G/2) c
    return [1, 0, 0, 0, 0, -c, -s, W + G / 2 * s, 0, s, -c, G / 2 + G / 2 * c];
  }
  function mul(A, B) {                           // A after B
    var o = [], r, c;
    for (r = 0; r < 3; r++) { for (c = 0; c < 3; c++) o[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c]; o[r * 4 + 3] = A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3]; }
    return o;
  }
  function at(A, x, y, z) { return [A[0] * x + A[1] * y + A[2] * z + A[3], A[4] * x + A[5] * y + A[6] * z + A[7], A[8] * x + A[9] * y + A[10] * z + A[11]]; }
  function bytes(s) { if (typeof Buffer !== 'undefined') { var b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } var bin = atob(s), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  // a model's vertices in mm, footprint frame: [{ pad, color, xyz: Float32Array, idx }]
  function decode(m) { return m.groups.map(function (g) { var src = new Int16Array(bytes(g.pos)), xyz = new Float32Array(src.length); for (var i = 0; i < src.length; i++) xyz[i] = src[i] * m.s; return { pad: !!g.pad, color: g.color, xyz: xyz, idx: g.i32 ? new Uint32Array(bytes(g.idx)) : new Uint16Array(bytes(g.idx)) }; }); }
  // what is drawn for one placed record: which board, and the footprint -> board matrix for its pads and for its body
  function pose(r, D, T, stacked) {
    var p = r.it.p, M = r.vkey ? variant(D.variants, r.vkey) : null; if (!M || r.ox == null) return null;
    var th = !!p.f.th && !p.f.edge && !r.both;
    return { brd: r.brd || 0, pads: onBoard(M, r.ox, r.oy, T, false), body: p.fit ? onBoard(M, r.ox, r.oy, T, stacked && th) : null, outside: stacked && th };
  }
  var maths = { variant: variant, onBoard: onBoard, inStack: inStack, mul: mul, at: at, decode: decode, pose: pose };
  if (typeof module === 'object' && module.exports) { module.exports = maths; return; }

  // ---------- the view ----------
  var doc = root.document, wrap = doc.getElementById('v3wrap'), msg = doc.getElementById('v3msg');
  if (!wrap) return;
  var T3, Rn, D, renderer = null, scene, camera, controls, unit = null, g1 = null, geo = {}, lay = null, viewName = 'iso', sized = '', pending = 0, queued = false;
  var RIG = null, S = null, open = 0, cut = null;
  function say(t) { if (msg) { msg.textContent = t || ''; msg.style.display = t ? '' : 'none'; } }
  function draw() { if (!renderer || queued) return; queued = true; root.requestAnimationFrame(function () { queued = false; renderer.render(scene, camera); }); }
  // a 3 x 4 matrix in (x, y, z) as a three.js matrix in the view's axes (x, z up, y)
  function m4(A) { return new T3.Matrix4().set(A[0], A[2], A[1], A[3], A[8], A[10], A[9], A[11], A[4], A[6], A[5], A[7], 0, 0, 0, 1); }
  function hold(o, A) { o.matrixAutoUpdate = false; o.matrix.copy(m4(A)); return o; }
  function hexOf(c) { return (Math.round(Math.max(c[0], 0.045) * 255) << 16) | (Math.round(Math.max(c[1], 0.045) * 255) << 8) | Math.round(Math.max(c[2], 0.05) * 255); }

  function init() {
    T3 = root.THREE; Rn = root.V6Render; D = root.NIXIE_MODELS;
    if (!T3 || !Rn || !D) { say('The 3D view could not load its files.'); return false; }
    try { renderer = new T3.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { renderer = null; }
    if (!renderer) { say('This browser cannot draw the 3D view (no WebGL).'); return false; }
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    renderer.localClippingEnabled = true;
    wrap.insertBefore(renderer.domElement, wrap.firstChild);
    scene = new T3.Scene();
    camera = new T3.PerspectiveCamera(30, 1, 1, 3000);
    controls = new T3.OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true; controls.addEventListener('change', draw);
    Rn.setup(renderer, scene);
    RIG = Rn.RIGS.three; S = { mode: 'real', bg: 'console', ground: 'shadow', shadows: true, exposure: 1, light: 1, sun: 215 };
    for (var k in RIG) if (k !== 'label') S[k] = RIG[k];
    // A plain scroll belongs to the page, so it is kept from OrbitControls; a pinch or Ctrl + scroll zooms the view.
    wrap.addEventListener('wheel', function (ev) { if (!(ev.ctrlKey || ev.metaKey)) ev.stopPropagation(); }, { capture: true, passive: true });
    if (root.ResizeObserver) new root.ResizeObserver(resize).observe(wrap);
    root.addEventListener('resize', resize);
    resize();
    return true;
  }
  function resize() {
    if (!renderer) return;
    var w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw();
  }
  // what is in the scene as it stands now, in the board's own axes (z up)
  function extent() {
    unit.updateMatrixWorld(true);
    var bb = new T3.Box3().setFromObject(unit);
    return { x0: bb.min.x, x1: bb.max.x, y0: bb.min.z, y1: bb.max.z, z0: bb.min.y, z1: bb.max.y };
  }
  // look along a fixed direction and back off until the whole unit fits the viewport (V6's setView)
  function setView(name) {
    if (!camera || !unit) return;
    viewName = name || viewName;
    var box = extent();
    var t = [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2, (box.y0 + box.y1) / 2];
    // a stack opens away from the long edge the two boards share (plan y = W), so its angled view looks in from the other side
    var dir = { iso: lay && lay.stacked ? [-0.42, 0.72, -0.62] : [-0.42, 0.72, 0.62], top: [0, 1, 0.001], under: [-0.25, -0.85, 0.45], side: lay && lay.stacked ? [0, 0.22, -1] : [0, 0.22, 1], end: [-1, 0.22, 0.05] }[viewName] || [-0.42, 0.72, 0.62];
    var ex = viewName === 'under' ? 1.7 : 1;          // the lights are overhead: the underside is shown with the exposure turned up
    if (S.exposure !== ex) { S.exposure = ex; var b = extent(); b.zb = b.z0 - 0.05; Rn.apply(S, b); }
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    var rad = 0.5 * Math.sqrt(Math.pow(box.x1 - box.x0, 2) + Math.pow(box.y1 - box.y0, 2) + Math.pow(box.z1 - box.z0, 2)) + 1.5;
    var half = camera.fov * Math.PI / 360, fit = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
    var dist = rad / Math.sin(fit) * 1.02;
    camera.position.set(t[0] + dir[0] / len * dist, t[1] + dir[1] / len * dist, t[2] + dir[2] / len * dist);
    camera.near = Math.max(0.5, dist / 50); camera.far = dist * 6 + 400; camera.updateProjectionMatrix();
    controls.target.set(t[0], t[1], t[2]); controls.update(); draw();
  }

  // a model's meshes, built once: positions in the view's axes (x, z up, y), so V6's lighting sees the outside of each face
  function meshes(key) {
    if (geo[key]) return geo[key];
    var m = D.models[key]; if (!m) return (geo[key] = []);
    return (geo[key] = decode(m).map(function (g) {
      var out = new Float32Array(g.xyz.length), i;
      for (i = 0; i < out.length; i += 3) { out[i] = g.xyz[i]; out[i + 1] = g.xyz[i + 2]; out[i + 2] = g.xyz[i + 1]; }
      var bg = new T3.BufferGeometry();
      bg.setAttribute('position', new T3.BufferAttribute(out, 3)); bg.setIndex(new T3.BufferAttribute(g.idx, 1));
      bg.computeVertexNormals(); bg.userData.keep = true;
      return { pad: g.pad, geo: bg, color: hexOf(g.color) };
    }));
  }
  function boardMesh(L, W, T, slot) {
    var s = new T3.Shape([[0, 0], [L, 0], [L, W], [0, W]].map(function (q) { return new T3.Vector2(q[0], -q[1]); }));
    if (slot) s.holes.push(new T3.Path([[slot.x, slot.y], [slot.x, slot.y + slot.h], [slot.x + slot.w, slot.y + slot.h], [slot.x + slot.w, slot.y]].map(function (q) { return new T3.Vector2(q[0], -q[1]); })));
    var g = new T3.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, -T, 0);            // view axes: x, z up (top face at 0), plan y
    var m = new T3.Mesh(g, Rn.board('real', '#0e5a3a', { mask: 'green', texture: 'fine' })); m.userData.isBoard = true;
    return m;
  }
  function build() {
    var st = root.NIXIE && root.NIXIE.state ? root.NIXIE.state() : null, pk = st && st.pk;
    if (unit) { unit.traverse(function (o) { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); }); scene.remove(unit); unit = null; g1 = null; }
    if (!pk || pk.fail || !pk.placed.length) { say('Nothing to show in 3D: these parts do not fit the width limit.'); lay = null; draw(); return; }
    say('');
    var T = st.T, W = pk.W, L = pk.L, sk = pk.stack || null, G = sk ? sk.G : 0, g0 = new T3.Group();
    unit = new T3.Group(); unit.add(g0);
    if (sk) { g1 = new T3.Group(); unit.add(g1); g1.add(boardMesh(L, W, T, null)); }
    g0.add(boardMesh(L, W, T, sk && sk.slot));
    var gold = Rn.part('real', 0xd9b441, { metal: 0.9, rough: 0.35 }), tin = Rn.part('real', 0xc5c8cf, { metal: 0.85, rough: 0.35 });
    // a castellated pad is cut off at the board's edge (board 1 never moves, so the cut can stay where it is)
    if (!cut) cut = gold.clone();
    cut.clippingPlanes = [new T3.Plane(new T3.Vector3(1, 0, 0), 0), new T3.Plane(new T3.Vector3(-1, 0, 0), L), new T3.Plane(new T3.Vector3(0, 0, 1), 0), new T3.Plane(new T3.Vector3(0, 0, -1), W)];
    pk.placed.forEach(function (r) {
      var p = r.it.p, q = pose(r, D, T, !!sk); if (!q) return;
      var host = q.brd ? g1 : g0, ms = meshes(p.fpn), body = false;
      ms.forEach(function (e) {
        if (e.pad) {
          host.add(hold(new T3.Mesh(e.geo, p.f.edge ? cut : gold), q.pads));
          if (r.both) g1.add(hold(new T3.Mesh(e.geo, gold), onBoard(variant(D.variants, r.vkey), r.ox, W - r.oy, T, false)));     // the same post, at the mirrored place on board 2
        } else if (q.body) { host.add(hold(new T3.Mesh(e.geo, Rn.part('real', e.color)), q.body)); body = true; }
      });
      if (!body && q.body && p.f.z > 0 && !p.f.th) {              // a fitted part whose model is not in KiCad's library: a plain block of its size
        var bx = new T3.Mesh(new T3.BoxGeometry(p.f.bw, p.f.z, p.f.bh), Rn.part('real', 0x1c1c20)); bx.geometry.translate(0, p.f.z / 2, 0);
        host.add(hold(bx, q.body));
      }
      if (r.both) {                                              // the pin itself stands in board 1 and passes through board 2
        var z0 = -T - 0.7, z1 = G + T + 0.7, pin = new T3.Mesh(new T3.BoxGeometry(0.4, z1 - z0, 0.4), tin);
        pin.position.set(r.ox, (z0 + z1) / 2, r.oy); g0.add(pin);
      }
    });
    scene.add(unit);
    Rn.finish([unit], S); Rn.linear([unit]);
    lay = { W: W, G: G, stacked: !!sk };
    setOpen(open, true);
    var key = [L, W, sk ? 1 : 0].join();
    if (key !== sized) { sized = key; setView(viewName); } else draw();
  }
  function setOpen(deg, quiet) {
    open = deg;
    if (!lay || !unit) return;
    if (g1) hold(g1, inStack(1, lay.W, lay.G, deg * Math.PI / 180));
    var b = extent(); b.zb = b.z0 - 0.05;           // the lights aim at the middle of it, and the shadow falls just under its lowest point
    Rn.apply(S, b);
    if (!quiet) draw();
  }
  function update() { if (!renderer) return; root.clearTimeout(pending); pending = root.setTimeout(build, 60); }

  // ---------- loading: the heavy files are fetched when the panel first comes near the screen ----------
  var me = doc.currentScript ? doc.currentScript.src : '', stamp = me.indexOf('?') >= 0 ? me.slice(me.indexOf('?')) : '', base = me.slice(0, me.lastIndexOf('/') + 1);
  function load(names, done) {
    if (!names.length) return done(true);
    var s = doc.createElement('script'); s.src = base + names[0] + stamp;
    s.onload = function () { load(names.slice(1), done); }; s.onerror = function () { done(false); };
    doc.head.appendChild(s);
  }
  var started = false;
  function start() {
    if (started) return; started = true;
    say('Loading the 3D view…');
    load(['three.min.js', 'OrbitControls.js', 'render.js', 'nixie-models.js'], function (ok) {
      if (!ok || !init()) { if (!ok) say('The 3D view could not load its files.'); return; }
      if (root.NIXIE) root.NIXIE.onchange = update;
      build();
    });
  }
  var bar = doc.getElementById('v3bar');
  if (bar) bar.addEventListener('click', function (ev) { var b = ev.target.closest('button[data-view]'); if (b) setView(b.getAttribute('data-view')); });
  var slider = doc.getElementById('v3open');
  if (slider) slider.addEventListener('input', function () { setOpen(Number(slider.value)); });
  root.NixieView3D = { update: update, setView: setView, setOpen: function (d) { setOpen(d); }, info: function () { return renderer ? { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, open: open, extent: unit ? extent() : null } : null; } };
  if (root.IntersectionObserver) { var io = new root.IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '300px' }); io.observe(wrap); }
  else start();
})(typeof window !== 'undefined' ? window : this);
