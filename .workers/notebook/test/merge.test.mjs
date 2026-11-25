// node .workers/notebook/test/merge.test.mjs   (from the repository's root, or anywhere)
// What two devices and the account must come to, case by case. No network, nothing installed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { merge, sig } = createRequire(import.meta.url)('../../../V6/notebook-sync.js');

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

// the outline tool's own time stamp is not a change; its design is
const st = (t, w) => ({ t: 1, copper: 'v5', keys: { 'v6mech.state': JSON.stringify({ params: { w }, cam: [1], t }) } });
assert.equal(sig(st(111, 3)), sig(st(222, 3))); assert.notEqual(sig(st(111, 3)), sig(st(111, 4)));

console.log('notebook merge: ok');
