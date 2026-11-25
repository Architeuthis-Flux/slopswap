// node test.mjs [address]     the Worker's answers, asked of a running `wrangler dev` (see README.md).
// It reads the test key from .dev.vars, starts from an empty notebook table, and leaves it empty.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = (process.argv[2] || 'http://localhost:8787') + '/api/notebook';
const key = /^NOTEBOOK_KEY=(.+)$/m.exec(readFileSync(new URL('.dev.vars', import.meta.url), 'utf8'))[1].trim();
const wipe = () => execFileSync('wrangler', ['d1', 'execute', 'slopswap-notebook', '--local', '--command', 'DELETE FROM notebook'], { cwd: new URL('.', import.meta.url), stdio: 'ignore' });
const ask = async (method, body, k = key) => {
  const r = await fetch(base, { method, headers: k ? { authorization: 'Bearer ' + k } : {}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
};
const book = (text) => ({ pages: { A: { t: 1, copper: 'v5', keys: { 'v6ce.v4': text } } }, gone: {} });

wipe();
// no key, a wrong key: nothing is said about the notebook
assert.equal((await ask('GET', undefined, '')).status, 401);
assert.equal((await ask('GET', undefined, 'not-the-key-not-the-key-not-the-key')).status, 401);
assert.equal((await ask('PUT', { base: 0, notebook: book('x') }, 'nope')).status, 401);

// an empty account
let r = await ask('GET');
assert.deepEqual([r.status, r.body], [200, { rev: 0, notebook: null }]); assert.equal(r.cache, 'no-store');

// the first write, then what was written
r = await ask('PUT', { base: 0, notebook: book('one') });
assert.deepEqual([r.status, r.body], [200, { rev: 1 }]);
r = await ask('GET');
assert.deepEqual([r.status, r.body], [200, { rev: 1, notebook: book('one') }]);

// a second device that read nothing yet cannot write over it: it is told what is there
r = await ask('PUT', { base: 0, notebook: book('late') });
assert.equal(r.status, 409); assert.deepEqual([r.body.rev, r.body.notebook], [1, book('one')]);

// a write from the rev just read goes in; the same rev used again does not
r = await ask('PUT', { base: 1, notebook: book('two') });
assert.deepEqual([r.status, r.body], [200, { rev: 2 }]);
r = await ask('PUT', { base: 1, notebook: book('stale') });
assert.equal(r.status, 409); assert.equal(r.body.notebook.pages.A.keys['v6ce.v4'], 'two');

// what is not a notebook is refused and changes nothing
for (const bad of ['not json', '[]', { base: -1, notebook: book('x') }, { base: 2 }, { base: 2, notebook: { pages: [] } }, { base: '2', notebook: book('x') }]) {
  assert.equal((await ask('PUT', bad)).status, 400, JSON.stringify(bad));
}
assert.equal((await ask('PUT', { base: 2, notebook: { pages: { big: 'x'.repeat(1600 * 1024) } } })).status, 413);
assert.equal((await ask('POST', { base: 2, notebook: book('x') })).status, 405);
assert.equal((await ask('DELETE')).status, 405);
assert.equal((await ask('GET')).body.rev, 2);

wipe();
console.log('notebook worker: ok');
