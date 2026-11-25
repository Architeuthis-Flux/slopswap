// node .workers/notebook/test/merge.test.mjs   (from the repository's root, or anywhere)
// What two devices and the account must come to, case by case. No network, nothing installed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { merge, sig, same } = createRequire(import.meta.url)('../../../V6/notebook-sync.js');

const page = (t, text, s) => ({ t, ...(s === undefined ? {} : { s }), copper: 'v5', keys: { 'v6ce.v4': text } });
const names = (o) => Object.keys(o).sort();
const run = (local, remote) => merge({ pages: {}, gone: {}, ...local }, remote, 'STAMP', 99);

// a device that has never synced, and an empty account: everything goes up, and the device then agrees with it
let m = run({ pages: { A: page(1, 'a') } }, null);
assert.equal(m.push, true); assert.deepEqual(names(m.remote.pages), ['A']); assert.equal(m.pages.A.s, 1);

// nothing changed anywhere: nothing is sent
m = run({ pages: { A: page(1, 'a', 1) } }, { pages: { A: page(1, 'a') }, gone: {} });
assert.equal(m.push, false); assert.deepEqual([m.took, m.kept, m.dropped], [[], [], []]);

// changed here only: ours goes up
m = run({ pages: { A: page(5, 'mine', 1) } }, { pages: { A: page(1, 'a') }, gone: {} });
assert.equal(m.push, true); assert.equal(m.remote.pages.A.keys['v6ce.v4'], 'mine'); assert.deepEqual(m.took, []);

// changed there only (the Mac left open, the phone edited): theirs comes down, nothing is sent, whatever the clocks say
m = run({ pages: { A: page(1000, 'old', 1000) } }, { pages: { A: page(7, 'theirs') }, gone: {} });
assert.equal(m.push, false); assert.equal(m.pages.A.keys['v6ce.v4'], 'theirs'); assert.equal(m.pages.A.s, 7); assert.deepEqual(m.took, ['A']);

// changed on both: the account's keeps the name, this device's is kept beside it, and neither is lost
m = run({ pages: { A: page(5, 'mine', 1) } }, { pages: { A: page(7, 'theirs') }, gone: {} });
assert.deepEqual(m.kept, [['A', 'A (this device STAMP)']]);
assert.equal(m.pages.A.keys['v6ce.v4'], 'theirs'); assert.equal(m.pages['A (this device STAMP)'].keys['v6ce.v4'], 'mine');
assert.equal(m.push, true); assert.deepEqual(names(m.remote.pages), ['A', 'A (this device STAMP)']);

// a new device whose first page has the name of one in the account: the same rule, so its page is kept beside
m = run({ pages: { 'Page 1': page(50, 'fresh') } }, { pages: { 'Page 1': page(7, 'work') }, gone: {} });
assert.equal(m.pages['Page 1'].keys['v6ce.v4'], 'work'); assert.equal(m.kept.length, 1);

// both changed to the very same thing: no copy
m = run({ pages: { A: page(5, 'same', 1) } }, { pages: { A: page(7, 'same') }, gone: {} });
assert.deepEqual([m.kept, m.took], [[], []]); assert.equal(m.pages.A.s, 7); assert.equal(m.push, false);

// deleted here: it goes from the account, and the account remembers that it went
m = run({ pages: {}, gone: { A: { s: 1 } } }, { pages: { A: page(1, 'a'), B: page(2, 'b') }, gone: {} });
assert.deepEqual(names(m.remote.pages), ['B']); assert.deepEqual(m.remote.gone, { A: { t: 99 } }); assert.equal(m.push, true);

// deleted here, but changed there since: it comes back down
m = run({ pages: {}, gone: { A: { s: 1 } } }, { pages: { A: page(8, 'newer') }, gone: {} });
assert.deepEqual(m.took, ['A']); assert.deepEqual(m.remote.gone, {});

// deleted elsewhere, untouched here: it goes here too
m = run({ pages: { A: page(1, 'a', 1), B: page(2, 'b', 2) } }, { pages: { B: page(2, 'b') }, gone: { A: { t: 9 } } });
assert.deepEqual(m.dropped, ['A']); assert.deepEqual(names(m.pages), ['B']); assert.equal(m.push, false);

// deleted elsewhere, but changed here since: ours stays and goes back up
m = run({ pages: { A: page(5, 'mine', 1) } }, { pages: {}, gone: { A: { t: 9 } } });
assert.deepEqual(m.dropped, []); assert.deepEqual(names(m.remote.pages), ['A']); assert.deepEqual(m.remote.gone, {});

// the account was emptied (no page, no word that it was deleted): what this device has goes up again
m = run({ pages: { A: page(1, 'a', 1) } }, { pages: {}, gone: {} });
assert.deepEqual(names(m.remote.pages), ['A']); assert.equal(m.push, true);

// a page new in the account comes down beside this device's own
m = run({ pages: { A: page(1, 'a', 1) } }, { pages: { A: page(1, 'a'), C: page(3, 'c') }, gone: {} });
assert.deepEqual(names(m.pages), ['A', 'C']); assert.deepEqual(m.took, ['C']); assert.equal(m.push, false);

// looking is not changing: the outline's time stamp, its camera and panels, and which example the routing lab has
// open are no part of a page's design; the design is
const st = (v, w, cam, s) => ({ t: v, ...(s === undefined ? {} : { s }), copper: 'v5',
  keys: { 'v6mech.state': JSON.stringify({ params: { w }, ui: { dock: cam }, cam: [cam], t: cam * 7 }), 'lab.ui.v1:/V6/x.html': '{"selected":' + cam + '}' } });
assert.equal(sig(st(1, 3, 1)), sig(st(1, 3, 2))); assert.notEqual(sig(st(1, 3, 1)), sig(st(1, 4, 1)));

// so a device that only looked (the same version, another camera) sends nothing and keeps its own view
m = run({ pages: { A: st(5, 3, 2, 5) } }, { pages: { A: st(5, 3, 1) }, gone: {} });
assert.equal(m.push, false); assert.deepEqual(m.took, []); assert.equal(JSON.parse(m.pages.A.keys['v6mech.state']).cam[0], 2);

// and a page that really changed takes its view along
m = run({ pages: { A: st(9, 4, 2, 5) } }, { pages: { A: st(5, 3, 1) }, gone: {} });
assert.equal(m.push, true); assert.equal(JSON.parse(m.remote.pages.A.keys['v6mech.state']).cam[0], 2);

// a tool never opened on a page is no opinion: a new device that has only seen the outline does not get a copy of
// a page whose outline is the same, and it takes the account's page, which knows the cost explorer too
const two = (t, outline, cost, s) => ({ t, ...(s === undefined ? {} : { s }), copper: 'v5', keys: { 'v6mech.state': JSON.stringify({ params: outline }), 'v6ce.v4': cost } });
m = run({ pages: { 'Page 1': two(50, { w: 1 }, null) } }, { pages: { 'Page 1': two(7, { w: 1 }, 'priced') }, gone: {} });
assert.deepEqual(m.kept, []); assert.equal(m.pages['Page 1'].keys['v6ce.v4'], 'priced'); assert.equal(m.push, false);
assert.deepEqual(m.took, ['Page 1']);                       // so the open tools are given what came down, and cannot send the page back without it
assert.equal(m.pages['Page 1'].s, 7);
// each knows a tool the other does not: the two are put together, and that goes up as a new version
const lab = (t, outline, ui, s) => ({ t, ...(s === undefined ? {} : { s }), copper: 'v5', keys: { 'v6mech.state': outline, 'v6ce.v4': ui } });
m = run({ pages: { A: lab(50, null, 'priced') } }, { pages: { A: lab(7, JSON.stringify({ params: { w: 2 } }), null) }, gone: {} });
assert.deepEqual([m.kept, m.took], [[], ['A']]); assert.equal(m.push, true);
assert.deepEqual(m.remote.pages.A.keys, { 'v6ce.v4': 'priced', 'v6mech.state': JSON.stringify({ params: { w: 2 } }) });
assert.deepEqual(m.pages.A.keys, m.remote.pages.A.keys);
assert.equal(same(two(1, { w: 1 }, null), two(2, { w: 1 }, 'priced')), true); assert.equal(same(two(1, { w: 1 }, 'a'), two(2, { w: 1 }, 'b')), false);

console.log('notebook merge: ok');
