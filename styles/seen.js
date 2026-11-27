// The site's visit counter, on every page (build.py adds it). When a visitor leaves a page it reports one line to
// /api/seen (.workers/seen): the page, the seconds it was really looked at, how far it was scrolled, the site the
// visitor came from, the window's width, and the labels of the controls they used with a count each.
// It keeps nothing in the visitor's browser, sets no cookie, and never reads what is typed or chosen: a slider is
// "Pitch, 4 times", not its value. It stays silent for a browser that asks not to be tracked, and for the owner's own
// (the one holding the visitors page's key), so Kevin does not count himself.
(function () {
  'use strict';
  try { if (localStorage.getItem('slopswap-visitors.key')) return; } catch (e) { /* no storage: count as a visitor */ }
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || navigator.webdriver || !navigator.sendBeacon) return;

  var view = Array.from(crypto.getRandomValues(new Uint8Array(8)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  var secs = 0, scroll = 0, used = {}, labels = 0, active = Date.now(), sent = -1;

  // a second counts while the page shows (a tool in a hidden tab of the notebook has no size) and the visitor did something in the last minute
  setInterval(function () {
    if (document.visibilityState === 'visible' && document.documentElement.clientWidth > 0 && Date.now() - active < 60000) secs++;
  }, 1000);
  function stir() { active = Date.now(); }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (e) { addEventListener(e, stir, { passive: true, capture: true }); });
  addEventListener('scroll', function () {
    stir();
    var d = document.documentElement, far = Math.round(100 * (scrollY + innerHeight) / Math.max(1, d.scrollHeight));
    if (far > scroll) scroll = Math.min(100, far);
  }, { passive: true, capture: true });

  // what was used: the control's own name (its label, its words, its id), never its value
  function name(el) {
    var lab = el.labels && el.labels[0] ? el.labels[0].textContent : '';
    var t = el.getAttribute('aria-label') || lab || (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? '' : el.textContent) || el.title || el.id || el.name || el.tagName.toLowerCase();
    return t.replace(/\s+/g, ' ').trim().slice(0, 48);
  }
  function note(el) {
    var n = el && name(el); if (!n) return;
    if (!(n in used)) { if (labels >= 40) return; labels++; used[n] = 0; }
    used[n]++;
  }
  addEventListener('click', function (e) { var el = e.target.closest && e.target.closest('button, a, summary, [role=button], [role=tab], input[type=checkbox], input[type=radio]'); if (el) note(el); }, true);
  addEventListener('change', function (e) { var el = e.target; if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio)$/.test(el.type)) note(el); }, true);

  function send() {
    if (secs < 1 || secs === sent) return;
    sent = secs;
    var from = ''; try { from = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { from = ''; }
    navigator.sendBeacon('/api/seen', new Blob([JSON.stringify({ v: view, page: location.pathname, secs: secs, scroll: scroll || Math.min(100, Math.round(100 * innerHeight / Math.max(1, document.documentElement.scrollHeight))),
      ref: from === location.hostname ? '' : from, wide: innerWidth, used: used })], { type: 'text/plain' }));
  }
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); });
  addEventListener('pagehide', send);
})();
