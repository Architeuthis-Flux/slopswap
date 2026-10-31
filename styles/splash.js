/* slopswap · DDJ splash: the Dirty Deeds Jumperless artwork with the newest pages' names in the eye boxes.
   Usage, in a folder's index.html:
     <div class="splash" data-svg="../styles/ddj-splash.svg" data-recent="recent.json"></div>
     <script src="../styles/splash.js"></script>
   recent.json is written by build.py (newest pages first). Adapted from the shop's
   architeuthis-flux-nav section; one deliberate difference: labels show at rest, not on hover. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  // figure group → its built-in tilted eye-box rect, left to right; newest page goes first
  var FIGURES = [['JacketGuy', 'rec'], ['RedLady', 'rec1'], ['Chick', 'chickrec'], ['Cop', 'rec2'],
                 ['Child', 'rec3'], ['OldLady', 'rec5'], ['ShirtGuy', 'rec4'], ['Dog', 'rec6']];

  document.querySelectorAll('.splash[data-svg]').forEach(init);

  function init(host) {
    var img = document.createElement('img');
    img.src = host.dataset.svg; img.alt = 'Jumperless'; img.className = 'splash-img';
    host.appendChild(img);
    Promise.all([
      fetch(host.dataset.svg).then(function (r) { return r.text(); }),
      fetch(host.dataset.recent || 'recent.json').then(function (r) { return r.json(); })
    ]).then(function (res) {
      var svg = new DOMParser().parseFromString(res[0], 'image/svg+xml').documentElement;
      if (svg.nodeName !== 'svg') throw new Error('not an svg');
      svg = document.importNode(svg, true);
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Jumperless: the newest pages');
      host.replaceChild(svg, img);
      label(svg, res[1]);
      newestList(host, res[1]);
    }).catch(function (e) { console.warn('splash: leaving the static image', e); });
  }

  function newestList(host, pages) {
    var ol = document.createElement('ol');
    ol.className = 'splash-list';
    pages.slice(0, FIGURES.length).forEach(function (p) {
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = p.href; a.textContent = p.title; li.appendChild(a); ol.appendChild(li);
    });
    host.insertAdjacentElement('afterend', ol);
  }

  function label(svg, pages) {
    var defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
    var grad = document.createElementNS(NS, 'linearGradient');
    grad.id = 'jl-rainbow';
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('x2', '300'); grad.setAttribute('y2', '0');
    grad.setAttribute('spreadMethod', 'repeat');
    var cs = getComputedStyle(document.documentElement);
    for (var i = 1; i <= 10; i++) {
      var st = document.createElementNS(NS, 'stop');
      st.setAttribute('offset', ((i - 1) / 9).toFixed(3));
      st.setAttribute('stop-color', cs.getPropertyValue('--r' + i).trim() || '#fff');
      grad.appendChild(st);
    }
    var anim = document.createElementNS(NS, 'animateTransform');
    anim.setAttribute('attributeName', 'gradientTransform'); anim.setAttribute('type', 'translate');
    anim.setAttribute('from', '0 0'); anim.setAttribute('to', '300 0'); anim.setAttribute('dur', '8s');
    anim.setAttribute('repeatCount', 'indefinite');
    grad.appendChild(anim);
    defs.appendChild(grad);

    // Chick's box overlaps Cop's; draw Chick on top, as the shop does
    var chick = svg.getElementById('Chick'), cop = svg.getElementById('Cop');
    if (chick && cop && chick.parentNode === cop.parentNode) cop.parentNode.insertBefore(chick, cop.nextSibling);

    FIGURES.forEach(function (f, i) {
      var g = svg.getElementById(f[0]), rect = svg.getElementById(f[1]), page = pages[i];
      if (!g || !rect || !page) return;
      // the baked-in JUMPERLESS bar is the widest image in the group; our label replaces it
      var imgs = [].slice.call(g.querySelectorAll('image'));
      if (imgs.length > 1) {
        imgs.sort(function (a, b) { return b.getAttribute('width') / b.getAttribute('height') - a.getAttribute('width') / a.getAttribute('height'); });
        imgs[0].style.display = 'none';
      }
      var x = +rect.getAttribute('x'), y = +rect.getAttribute('y'), w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
      var wrap = document.createElementNS(NS, 'g');
      wrap.setAttribute('class', 'splash-label');
      if (rect.getAttribute('transform')) wrap.setAttribute('transform', rect.getAttribute('transform'));
      var bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('x', x); bg.setAttribute('y', y); bg.setAttribute('width', w); bg.setAttribute('height', h);
      bg.setAttribute('rx', '2'); bg.setAttribute('fill', '#000');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x + w / 2); t.setAttribute('y', y + h / 2);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('fill', 'url(#jl-rainbow)');
      wrap.appendChild(bg); wrap.appendChild(t); g.appendChild(wrap);

      var a = document.createElementNS(NS, 'a');
      a.setAttribute('href', page.href); a.setAttribute('class', 'splash-hot');
      g.parentNode.insertBefore(a, g); a.appendChild(g);
      var title = document.createElementNS(NS, 'title'); title.textContent = page.title; a.appendChild(title);

      function fit() {
        var pad = 6, maxW = w * 1.45, size = Math.min(h * 0.7, 17), label = page.short || page.title;
        t.textContent = label; t.setAttribute('font-size', size);
        var len = t.getComputedTextLength();
        while (len > maxW - 2 * pad && size > 9) { size -= 0.5; t.setAttribute('font-size', size); len = t.getComputedTextLength(); }
        while (len > maxW - 2 * pad && label.length > 4) { label = label.slice(0, -2).replace(/[\s·:,-]+$/, '') + '…'; t.textContent = label; len = t.getComputedTextLength(); }
        var bw = Math.max(w, len + 2 * pad);
        bg.setAttribute('x', x + w / 2 - bw / 2); bg.setAttribute('width', bw);
      }
      fit();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    });
  }
})();
