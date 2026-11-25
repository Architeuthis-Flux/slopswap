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

  // What a page holds, as one text, for telling whether it changed. The outline tool stamps its state with the
  // time of every save: that stamp is not a change.
  function sig(page) {
    const keys = {};
    for (const k of Object.keys((page && page.keys) || {}).sort()) {
      let v = page.keys[k];
      if (k === 'v6mech.state' && typeof v === 'string') {
        try { const o = JSON.parse(v); delete o.t; v = JSON.stringify(o); } catch (e) { /* not JSON: compared as it is */ }
      }
      keys[k] = v == null ? null : v;
    }
    return JSON.stringify([(page && page.copper) || null, keys]);
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
  function merge(local, remote, stamp, now) {
    const lp = (local && local.pages) || {}, lg = (local && local.gone) || {};
    const rp = (remote && remote.pages) || {}, gone = Object.assign({}, remote && remote.gone);
    const pages = {}, took = [], kept = [], dropped = [];
    const agreed = (p) => Object.assign({}, p, { s: p.t });
    const free = (base) => { let n = base, i = 2; while (pages[n] || lp[n] || rp[n]) n = base + ' ' + i++; return n; };

    for (const name of new Set(Object.keys(lp).concat(Object.keys(rp)))) {
      const l = lp[name], r = rp[name];
      if (l && r) {
        const here = l.t !== l.s, there = r.t !== l.s;
        if (!there) pages[name] = agreed(l);                          // unchanged there: ours stands (and goes up if it changed)
        else if (!here || sig(l) === sig(r)) {                        // changed there only, or both to the same thing
          pages[name] = agreed(r);
          if (sig(l) !== sig(r)) took.push(name);
        } else {                                                      // both changed: the account's keeps the name, ours is kept beside it
          const as = free(name + ' (this device ' + stamp + ')');
          pages[name] = agreed(r); pages[as] = agreed(l);
          took.push(name); kept.push([name, as]);
        }
      } else if (l) {
        // Not in the account. Deleted elsewhere and untouched here: it goes. New here, changed here since, or
        // simply missing there: it stays and goes up.
        if (gone[name] && l.s != null && l.t === l.s) dropped.push(name);
        else pages[name] = agreed(l);
      } else {
        // Not on this device. Deleted here while the account still has the version that was deleted: it goes
        // there too. Otherwise it is new, or was changed there after the delete: it comes down.
        const d = lg[name];
        if (d && d.s === r.t) gone[name] = { t: now };
        else { pages[name] = agreed(r); took.push(name); }
      }
    }
    for (const name of Object.keys(pages)) delete gone[name];        // a name in use is not a deleted one
    const next = canon({ pages: pages, gone: gone });
    return { pages: pages, remote: next, push: JSON.stringify(next) !== JSON.stringify(canon(remote)), took: took, kept: kept, dropped: dropped };
  }

  return { sig: sig, canon: canon, merge: merge };
});
