// The V6 notebook's sync: how this device's pages and the account's pages become one set, with nothing lost.
// No page code and no network here, so `node .workers/notebook/test/merge.test.mjs` runs it as it is.
//
// A page is { t, s, copper, keys }. t is when it last changed, by the clock of the device that changed it; it is
// used as the version's name, never compared between clocks. s is the t the account had the last time this device
// and the account agreed on the page (missing: the account has never had it from here). So, on this device,
//   changed here  = t differs from s          changed there = the account's t differs from s
// The account keeps { pages: { name: { t, copper, keys } }, gone: { name: { t } } }: gone names what was deleted,
// so a device that still has an untouched copy drops it instead of sending it back.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotebookSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const OWN = 'v6nb.';                               // the notebook's own names in a browser's storage: no tool's, and never a page's

  // What a page's design is, tool by tool, for telling whether it changed. Looking is not changing: where the 3D
  // view stands, how the panels are laid out, which example is open in the routing lab and the time the outline
  // stamps on every save travel with a page but are no part of this. (Otherwise a device that only opens the
  // notebook would send a "new" version, and the other devices would reload for it.) Nor is the outline tool's own
  // revision, which it writes into the design it saves: a newer tool is not a changed design. And a tool with
  // nothing kept counts as a tool the page has never heard of, because the tabs are not the same on every device.
  function design(page) {
    const keys = {};
    for (const k of Object.keys((page && page.keys) || {}).sort()) {
      let v = page.keys[k];
      if (v == null || k.indexOf('lab.ui.') === 0) continue;
      if (k === 'v6mech.state' && typeof v === 'string') {
        try { const p = Object.assign({}, JSON.parse(v).params); delete p.meta; v = JSON.stringify(p); } catch (e) { /* not JSON: compared as it is */ }
      }
      keys[k] = v;
    }
    return keys;
  }
  function sig(page) { return JSON.stringify([(page && page.copper) || null, design(page)]); }
  // Two versions of a page say the same thing: the same copper, and for every tool the same design, or one of the
  // two has never opened that tool on this page (which is no opinion, not a different one).
  function same(a, b) {
    if (((a && a.copper) || null) !== ((b && b.copper) || null)) return false;
    const x = design(a), y = design(b);
    for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) if (x[k] != null && y[k] != null && x[k] !== y[k]) return false;
    return true;
  }

  // A page as read from storage, from a file or from the account. It keeps the state of every tool it carries,
  // whether or not this copy of the notebook has a tab for that tool, so that a device with an older or shorter tab
  // list hands a page on whole. What is kept is text or nothing, under at most 64 names of a sensible length, and
  // never under one of the notebook's own (v6nb.*: its pages and its key for the account live there).
  // coppers: the routing runs this notebook knows, the first being the one a page falls back to.
  function clean(p, coppers) {
    const keys = {};
    let n = 0;
    for (const k of Object.keys((p && p.keys) || {})) {
      if (!k || k.length > 120 || k.indexOf(OWN) === 0 || n >= 64) continue;
      keys[k] = typeof p.keys[k] === 'string' ? p.keys[k] : null; n++;
    }
    const page = { t: Number(p && p.t) || 0, copper: coppers.indexOf(p && p.copper) >= 0 ? p.copper : coppers[0], keys: keys };
    if (p && typeof p.s === 'number') page.s = p.s;
    return page;
  }

  // The account's form of a notebook, in one fixed order, so that two of them can be compared as text.
  function canon(book) {
    const pages = {}, gone = {};
    for (const n of Object.keys((book && book.pages) || {}).sort()) {
      const p = book.pages[n], keys = {};
      for (const k of Object.keys(p.keys || {}).sort()) keys[k] = p.keys[k] == null ? null : p.keys[k];
      pages[n] = { t: p.t, copper: p.copper, keys: keys };
    }
    for (const n of Object.keys((book && book.gone) || {}).sort()) gone[n] = { t: book.gone[n].t };
    return { pages: pages, gone: gone };
  }

  // merge(local, remote, stamp, now)
  //   local  { pages, gone: { name: { s } } }   this device: its pages, and the pages deleted here that the account
  //                                             still had at version s
  //   remote { pages, gone } or null            what the account has now
  //   stamp  a few words for the name of a copy kept after both sides changed a page, e.g. "25 Nov 10:42"
  //   now    a time for the "gone" entries made here
  // Returns { pages, remote, push, took, kept, dropped }: the pages for this device once the account holds
  // `remote` (each with s = t); whether `remote` differs from what the account has and must be sent; the names
  // taken from the account; [name, copy name] for each page both had changed (the account's keeps the name, this
  // device's is kept as the copy); and the names dropped here because they were deleted elsewhere.
  // A page that is the same version on both sides is left alone on both: this device keeps its own view of it and
  // the account is not sent one, so that looking at a page never makes a device write.
  function merge(local, remote, stamp, now) {
    const lp = (local && local.pages) || {}, lg = (local && local.gone) || {};
    const rp = (remote && remote.pages) || {}, gone = Object.assign({}, remote && remote.gone);
    const pages = {}, account = {}, took = [], kept = [], dropped = [];
    const agreed = (p, t) => Object.assign({}, p, { t: t === undefined ? p.t : t, s: t === undefined ? p.t : t });
    const free = (base) => { let n = base, i = 2; while (pages[n] || lp[n] || rp[n]) n = base + ' ' + i++; return n; };

    for (const name of new Set(Object.keys(lp).concat(Object.keys(rp)))) {
      const l = lp[name], r = rp[name];
      if (l && r) {
        const here = l.t !== l.s, there = r.t !== l.s;
        if (!here && !there) { pages[name] = agreed(l); account[name] = r; }             // the same version: each keeps its own view of it
        else if (here && !there) { pages[name] = agreed(l); account[name] = l; }         // changed here only: ours goes up
        else if (!here) { pages[name] = agreed(r); account[name] = r; took.push(name); } // changed there only: theirs comes down
        else if (same(l, r)) {
          // Both, to the same thing. Where one has a tool's state and the other has never opened that tool on this
          // page, the two are put together: what this device lacked comes down, and what the account lacked goes up
          // as a new version. Where both have it, this device keeps its own view.
          const keys = Object.assign({}, l.keys);
          let fromThere = false, fromHere = false;
          for (const k of new Set(Object.keys(l.keys || {}).concat(Object.keys(r.keys || {})))) {
            const a = (l.keys || {})[k], b = (r.keys || {})[k];
            if (a == null && b != null) { keys[k] = b; fromThere = true; } else if (a != null && b == null) fromHere = true;
          }
          const both = Object.assign({}, l, { keys: keys });
          if (fromHere) { pages[name] = agreed(both); account[name] = both; }
          else { pages[name] = agreed(both, r.t); account[name] = r; }
          if (fromThere) took.push(name);
        } else {                                                                         // both changed: the account's keeps the name, ours is kept beside it
          const as = free(name + ' (this device ' + stamp + ')');
          pages[name] = agreed(r); account[name] = r; pages[as] = agreed(l); account[as] = l;
          took.push(name); kept.push([name, as]);
        }
      } else if (l) {
        // Not in the account. Deleted elsewhere and untouched here: it goes. New here, changed here since, or
        // simply missing there: it stays and goes up.
        if (gone[name] && l.s != null && l.t === l.s) dropped.push(name);
        else { pages[name] = agreed(l); account[name] = l; }
      } else {
        // Not on this device. Deleted here while the account still has the version that was deleted: it goes
        // there too. Otherwise it is new, or was changed there after the delete: it comes down.
        const d = lg[name];
        if (d && d.s === r.t) gone[name] = { t: now };
        else { pages[name] = agreed(r); account[name] = r; took.push(name); }
      }
    }
    for (const name of Object.keys(account)) delete gone[name];      // a name in use is not a deleted one
    const next = canon({ pages: account, gone: gone });
    return { pages: pages, remote: next, push: JSON.stringify(next) !== JSON.stringify(canon(remote)), took: took, kept: kept, dropped: dropped };
  }

  return { OWN: OWN, sig: sig, same: same, clean: clean, canon: canon, merge: merge };
});
