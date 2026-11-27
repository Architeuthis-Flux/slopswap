// node .workers/seen/test/seen.test.mjs     the visit counter (.workers/seen), asked as Cloudflare would ask it, with
// Node's own SQLite standing in for D1. No network, nothing installed.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { clean, report } from '../src/index.js';

// ---- what a page may report ----
const good = { v: 'a1b2c3d4e5f60718', page: '/V6/notebook.html?x=1#y', secs: 42, scroll: 80, ref: 'discord.com', wide: 1512, used: { ' Sweep ': 3, 'Pitch\n slider': 1 } };
assert.deepEqual(clean(good), { view: 'a1b2c3d4e5f60718', page: '/V6/notebook.html', secs: 42, scroll: 80, ref: 'discord.com', wide: 1500, used: { Sweep: 3, 'Pitch slider': 1 } });
assert.equal(clean({ ...good, secs: 99999 }).secs, 14400); assert.equal(clean({ ...good, scroll: 250 }).scroll, 100);
assert.equal(clean({ ...good, ref: 'https://evil/<script>' }).ref, '');
assert.deepEqual(clean({ ...good, used: { ok: 2, ['x'.repeat(49)]: 1, bad: 'many', zero: 0, big: 1e9 } }).used, { ok: 2, big: 9999 });
assert.equal(Object.keys(clean({ ...good, used: Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['k' + i, 1])) }).used).length, 40);
for (const bad of [null, [], 'x', { ...good, v: 'nope' }, { ...good, page: 'https://elsewhere/' }, { ...good, page: '//elsewhere' }, { ...good, page: '/' + 'x'.repeat(300) }, { ...good, secs: 0 }, { ...good, secs: 'long' }])
  assert.equal(clean(bad), null, JSON.stringify(bad).slice(0, 60));
assert.deepEqual(clean({ v: 'a1b2c3d4', page: '/', secs: 3 }), { view: 'a1b2c3d4', page: '/', secs: 3, scroll: 0, ref: '', wide: 0, used: {} });

// ---- what the owner is told ----
const rows = [
  { day: '2026-11-26', who: 'A', page: '/', secs: 10, scroll: 50, ref: 'discord.com', country: 'US', wide: 1500, used: '{"Open":1}' },
  { day: '2026-11-27', who: 'B', page: '/V6/notebook.html', secs: 300, scroll: 100, ref: '', country: 'US', wide: 400, used: '{"Sweep":2,"Routing":1}' },
  { day: '2026-11-27', who: 'B', page: '/V6/notebook.html', secs: 100, scroll: 20, ref: '', country: 'US', wide: 400, used: '{"Sweep":1}' },
  { day: '2026-11-27', who: 'C', page: '/V6/notebook.html', secs: 20, scroll: 60, ref: 't.co', country: 'DE', wide: 1500, used: 'not json' },
  { day: '2026-11-27', who: 'C', page: '/', secs: 5, scroll: 10, ref: 't.co', country: 'DE', wide: 1500, used: '{}' }];
const r = report(rows);
assert.deepEqual(r.total, { people: 3, visits: 5, secs: 435, phones: 2 });     // phones: views in a window under 700 px
assert.deepEqual(r.days, [{ day: '2026-11-26', people: 1, visits: 1, secs: 10 }, { day: '2026-11-27', people: 2, visits: 4, secs: 425 }]);
assert.deepEqual(r.pages, [{ page: '/V6/notebook.html', people: 2, visits: 3, typical: 100, secs: 420, read: 60 }, { page: '/', people: 2, visits: 2, typical: 8, secs: 15, read: 30 }]);
assert.deepEqual(r.used, [{ page: '/V6/notebook.html', label: 'Sweep', times: 3, people: 1 }, { page: '/', label: 'Open', times: 1, people: 1 }, { page: '/V6/notebook.html', label: 'Routing', times: 1, people: 1 }]);
assert.deepEqual(r.refs, [{ ref: 't.co', visits: 2 }, { ref: 'discord.com', visits: 1 }]);
assert.deepEqual(r.countries, [{ country: 'US', people: 2 }, { country: 'DE', people: 1 }]);
assert.deepEqual(report([]), { total: { people: 0, visits: 0, secs: 0, phones: 0 }, days: [], pages: [], used: [], refs: [], countries: [] });

// ---- the Worker, with a database behind it ----
const sql = new DatabaseSync(':memory:');
const stmt = (text, args) => ({ bind: (...a) => stmt(text, a), run: async () => { sql.prepare(text).run(...args); return { success: true }; },
  all: async () => ({ results: sql.prepare(text).all(...args) }), first: async () => sql.prepare(text).get(...args) ?? null });
const KEY = 'a-key-of-at-least-24-characters';
const env = (more = {}) => ({ SEEN_KEY: KEY, DB: { prepare: (text) => stmt(text, []) }, SEEN_NOW: String(Date.UTC(2026, 10, 27, 12)), ...more });
const say = async (body, { e = env(), ip = '203.0.113.9', ua = 'Mozilla/5.0 Chrome', origin = 'https://slopswap.org', method = 'POST' } = {}) => {
  const res = await worker.fetch(new Request('https://slopswap.org/api/seen', { method, body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { origin, 'user-agent': ua, 'cf-connecting-ip': ip, 'cf-ipcountry': 'US' } }), e);
  return res.status;
};
const ask = async (query = '', key = KEY, e = env()) => {
  const res = await worker.fetch(new Request('https://slopswap.org/api/seen' + query, { headers: key ? { authorization: 'Bearer ' + key } : {} }), e);
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') };
};
const stored = () => sql.prepare('SELECT * FROM seen ORDER BY at, view').all();

assert.equal(await say(good, { e: env({ SEEN_KEY: 'short' }) }), 503);                  // no key on the server: nothing is kept, nothing is told
assert.equal(await say(good), 204);
let all = stored();
assert.equal(all.length, 1); assert.deepEqual([all[0].page, all[0].secs, all[0].day, all[0].country, all[0].used], ['/V6/notebook.html', 42, '2026-11-27', 'US', '{"Sweep":3,"Pitch slider":1}']);
assert.match(all[0].who, /^[0-9a-f]{16}$/); assert.ok(!JSON.stringify(all[0]).includes('203.0.113'));     // a hash of the address, never the address
assert.equal(await say({ ...good, secs: 90, scroll: 40, used: { Sweep: 5 } }), 204);                       // the same view, later: one row, grown
all = stored(); assert.equal(all.length, 1); assert.deepEqual([all[0].secs, all[0].scroll, all[0].used], [90, 80, '{"Sweep":5}']);
assert.equal(await say({ ...good, v: 'ffffffff00000001', page: '/' }), 204);                                 // the same visitor, the same day: the same "who"
assert.equal(await say({ ...good, v: 'ffffffff00000002', page: '/' }, { ip: '198.51.100.7' }), 204);        // another address: another
assert.equal(await say({ ...good, v: 'ffffffff00000003', page: '/' }, { e: env({ SEEN_NOW: String(Date.UTC(2026, 10, 28, 12)) }) }), 204);   // the next day: not the same, on purpose
all = stored(); assert.equal(all.length, 4); assert.equal(new Set(all.map((x) => x.who)).size, 3); assert.equal(all[0].who, all[1].who);
// what is not kept
assert.equal(await say(good, { origin: 'https://elsewhere.example' }), 403);
assert.equal(await say({ ...good, v: 'ffffffff00000009' }, { ua: 'Mozilla/5.0 (compatible; Discordbot/2.0)' }), 204);
assert.equal(await say('{nope'), 400); assert.equal(await say({ ...good, page: 'https://x/' }), 400);
assert.equal(await say('x'.repeat(5000)), 413);
assert.equal(await say(good, { method: 'PUT' }), 405);
assert.equal(await say({ ...good, v: 'ffffffff0000000a' }, { e: env({ LIMIT: { limit: async () => ({ success: false }) } }) }), 429);
assert.equal(stored().length, 4);
// the report: only with the key
assert.equal((await ask('', '')).status, 401); assert.equal((await ask('', 'the-wrong-key-the-wrong-key')).status, 401);
let rep = await ask('?days=30', KEY, env({ SEEN_NOW: String(Date.UTC(2026, 10, 28, 13)) }));
assert.equal(rep.status, 200); assert.equal(rep.cache, 'no-store');
assert.deepEqual(rep.body.total, { people: 3, visits: 4, secs: 90 + 42 * 3, phones: 0 });
assert.deepEqual(rep.body.days.map((d) => [d.day, d.people, d.visits]), [['2026-11-27', 2, 3], ['2026-11-28', 1, 1]]);
rep = await ask('?days=1', KEY, env({ SEEN_NOW: String(Date.UTC(2026, 10, 28, 13)) })); assert.equal(rep.body.total.visits, 1);     // today only
console.log('ok');
