/* Password lock for this folder. The private files here are AES-GCM ciphertext (*.enc, made by lock.mjs).
   The key is derived from the password in the browser and kept in memory only: nothing is stored, because
   other pages on this hostname could read storage. Reloading the page asks again. */
(function () {
  'use strict';
  var PROBE = 'map-cells';                       // the smallest locked file: decrypting it checks the password
  var enc = new TextEncoder(), dec = new TextDecoder();
  function bytes(b64) { var bin = atob(b64), u = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function blob(name) {
    return fetch(name + '.enc', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(name + ' ' + r.status); return r.json(); });
  }
  function open(key, b) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(b.iv) }, key, bytes(b.ct)); }

  var L = { key: null, salt: null }, done;
  L.ready = new Promise(function (res) { done = res; });

  // Resolves when the password is right; rejects with OperationError when it is wrong.
  L.unlock = function (pass) {
    return blob(PROBE).then(function (b) {
      return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(b.salt), iterations: b.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      }).then(function (key) {
        return open(key, b).then(function () { L.key = key; L.salt = b.salt; done(L); return true; });
      });
    });
  };

  // The text of one locked file, e.g. read('map-pins').
  L.read = function (name) {
    return blob(name).then(function (b) {
      if (b.salt !== L.salt) throw new Error('This file was locked in a different run. Lock all files again.');
      return open(L.key, b);
    }).then(function (buf) { return dec.decode(buf); });
  };

  // A password form inside host. overlay: cover the page (for the map opened on its own).
  L.form = function (host, overlay) {
    if (!document.getElementById('chiplock-css')) {
      var s = document.createElement('style'); s.id = 'chiplock-css';
      s.textContent = '.chiplock div{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;max-width:26rem}' +
        '.chiplock label{flex-basis:100%;font-weight:600}' +
        '.chiplock input[type=password]{flex:1 1 12rem;min-width:0;font:inherit;font-size:16px;padding:.5rem .6rem;border:1px solid #8a8f98;border-radius:6px;background:#fff;color:#111}' +
        '.chiplock button{font:inherit;font-size:16px;padding:.5rem .9rem;border:0;border-radius:6px;background:#2f3fbf;color:#fff;cursor:pointer}' +
        '.chiplock button:disabled{opacity:.6}' +
        '.chiplock p{flex-basis:100%;margin:0;min-height:1.3em;font-size:.9em}' +
        '.chiplock-overlay{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(23,32,43,.55);padding:16px}' +
        '.chiplock-overlay div{background:#fff;color:#17202b;padding:16px;border-radius:10px}';
      document.head.appendChild(s);
    }
    var f = document.createElement('form');
    f.className = 'chiplock' + (overlay ? ' chiplock-overlay' : '');
    f.innerHTML = '<div><label for="chiplock-pw">Password</label>' +
      '<input type="text" name="username" autocomplete="username" value="monterey-chip-beds" hidden>' +
      '<input id="chiplock-pw" type="password" name="password" autocomplete="current-password" required>' +
      '<button type="submit">Unlock</button><p role="alert"></p></div>';
    var input = f.querySelector('#chiplock-pw'), msg = f.querySelector('p'), btn = f.querySelector('button');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true; msg.textContent = 'Checking…';
      L.unlock(input.value).then(function () { f.remove(); }, function (err) {
        btn.disabled = false;
        msg.textContent = err && err.name === 'OperationError' ? 'Wrong password.' : 'The locked files did not load. Reload to try again.';
        input.select();
      });
    });
    host.appendChild(f);
    input.focus();
  };

  window.ChipLock = L;
})();
