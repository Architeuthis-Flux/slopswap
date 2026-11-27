// node .workers/unfurl/test/worker.test.mjs     the fetch Worker's answers, asked of the Worker itself (no wrangler, no
// network): it is handed requests as Cloudflare would hand them, and fetches from a small server started here.
import assert from 'node:assert/strict';
import http from 'node:http';
import worker from '../src/index.js';

const seen = [];                                           // what the target was asked, and as whom
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 4, 176, 0, 0, 2, 118, 8, 6, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(500000, 7)]);
const PAGE = '<!doctype html><html><head><title>A page</title><meta property="og:title" content="Hello"></head><body>' + 'x'.repeat(5000) + '</body></html>';
const target = http.createServer((req, res) => {
  seen.push({ url: req.url, ua: req.headers['user-agent'], range: req.headers.range });
  const to = (where) => { res.writeHead(302, { location: where }); res.end(); };
  if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); }
  else if (req.url === '/r1') to('/r2'); else if (req.url === '/r2') to('/r3'); else if (req.url === '/r3') to('/page');
  else if (req.url.startsWith('/loop')) to('/loop' + (+(req.url.slice(5) || 0) + 1));
  else if (req.url === '/out') to('http://10.0.0.1/secret');
  else if (req.url === '/img.png') {
    if (req.headers.range) { res.writeHead(206, { 'content-type': 'image/png', 'content-range': `bytes 0-262143/${PNG.length}` }); res.end(PNG.subarray(0, 262144)); }
    else { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); res.end(PNG); }
  }
  else if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head>' + '<!-- pad -->'.repeat(90000)); }
  else if (req.url === '/latin') { res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }); res.end(Buffer.from('<head><title>caf\xe9</title></head>', 'latin1')); }
  else if (req.url === '/data.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"author_name":"Kev"}'); }
  else if (req.url === '/hang') { /* never answers */ }
  else { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<head><title>Not here</title></head>'); }
});
await new Promise((go) => target.listen(0, '127.0.0.1', go));
const T = 'http://127.0.0.1:' + target.address().port;

const LOCAL = { UNFURL_ALLOW_LOCAL: 'yes', UNFURL_TIMEOUT_MS: '400' };
const ask = async (query, { env = LOCAL, method = 'GET', headers = { 'sec-fetch-site': 'same-origin' } } = {}) => {
  const r = await worker.fetch(new Request('https://slopswap.org/api/unfurl?' + query, { method, headers }), env);
  return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control'), type: r.headers.get('content-type') };
};
const q = (name, address, more = '') => name + '=' + encodeURIComponent(address) + more;

// a page: its head and no more, asked for as the crawler named
let r = await ask(q('url', T + '/page', '&as=slack'));
assert.equal(r.status, 200); assert.equal(r.cache, 'no-store'); assert.match(r.type, /json/);
assert.equal(r.body.status, 200); assert.equal(r.body.final, T + '/page'); assert.match(r.body.type, /text\/html/);
assert.ok(r.body.html.endsWith('</head>') && r.body.html.includes('og:title') && !r.body.html.includes('xxxx'), r.body.html.slice(-40));
assert.equal(r.body.cut, true); assert.equal(r.body.as, 'slack'); assert.deepEqual(r.body.hops, []);
assert.match(seen.at(-1).ua, /^Slackbot-LinkExpanding/);
r = await ask(q('url', T + '/page')); assert.match(seen.at(-1).ua, /Discordbot/);             // Discord's, when none is named
r = await ask(q('url', T + '/page', '&as=nobody')); assert.equal(r.status, 400);

// redirects are followed one at a time, listed, and given up on after five
r = await ask(q('url', T + '/r1'));
assert.equal(r.body.final, T + '/page'); assert.deepEqual(r.body.hops, [{ url: T + '/r1', status: 302 }, { url: T + '/r2', status: 302 }, { url: T + '/r3', status: 302 }]);
r = await ask(q('url', T + '/loop')); assert.equal(r.status, 508);
assert.ok(seen.filter((s) => s.url.startsWith('/loop')).length <= 6);

// a page that is long, missing, or not UTF-8; a target that never answers; one that is not there at all
r = await ask(q('url', T + '/big')); assert.equal(r.status, 200); assert.ok(r.body.html.length <= 400 * 1024 && r.body.cut === true && r.body.bytes <= 420 * 1024, String(r.body.bytes));
r = await ask(q('url', T + '/nothing')); assert.deepEqual([r.status, r.body.status], [200, 404]); assert.match(r.body.html, /Not here/);
r = await ask(q('url', T + '/latin')); assert.match(r.body.html, /café/);
r = await ask(q('url', T + '/hang')); assert.equal(r.status, 504);
r = await ask(q('url', 'http://127.0.0.1:1/')); assert.equal(r.status, 502);
// something that is not a page comes back as what it is, with no text
r = await ask(q('url', T + '/img.png')); assert.equal(r.status, 200); assert.equal(r.body.html, ''); assert.match(r.body.type, /image\/png/);

// a media file: what it is, from its first 256 kB
r = await ask(q('probe', T + '/img.png'));
assert.equal(r.status, 200); assert.equal(seen.at(-1).range, 'bytes=0-262143');
assert.deepEqual([r.body.status, r.body.type, r.body.bytes, r.body.format, r.body.width, r.body.height, r.body.animated], [206, 'image/png', PNG.length, 'png', 1200, 630, false]);
r = await ask(q('probe', T + '/gone.png')); assert.deepEqual([r.status, r.body.status, r.body.format], [200, 404, '']);
// a small text file (oEmbed, a linked Discord layout)
r = await ask(q('text', T + '/data.json')); assert.deepEqual([r.status, r.body.status, r.body.text], [200, 200, '{"author_name":"Kev"}']);
r = await ask(q('text', T + '/big')); assert.ok(r.body.text.length <= 64 * 1024);

// what it will not do
assert.equal((await ask(q('url', T + '/page'), { method: 'POST' })).status, 405);
assert.equal((await ask(q('url', T + '/page'), { headers: {} })).status, 403);                           // not asked by a page of its own site
assert.equal((await ask(q('url', T + '/page'), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
assert.equal((await ask('')).status, 400);
assert.equal((await ask(q('url', T + '/page') + '&' + q('probe', T + '/img.png'))).status, 400);          // one thing at a time
for (const junk of ['not a link', 'ftp://ex.org/x', 'javascript:alert(1)', 'file:///etc/passwd', '//ex.org'])
  assert.equal((await ask(q('url', junk))).status, 400, junk);
const PUBLIC = { UNFURL_TIMEOUT_MS: '400' };                 // as deployed: no local addresses, whatever the page asks
for (const inside of ['http://localhost/', 'http://127.0.0.1/', 'http://2130706433/', 'http://10.0.0.1/', 'http://172.16.5.4/', 'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/', 'http://printer.local/',
  'http://db.internal/', 'http://x.localhost/', 'http://example.org:8080/', 'https://example.org:8443/', 'http://user:pw@example.org/',
  'https://slopswap.org/api/unfurl?url=https://example.org', 'https://slopswap.org/api/notebook'])
  for (const mode of ['url', 'probe', 'text']) { r = await ask(q(mode, inside), { env: PUBLIC }); assert.equal(r.status, 403, mode + ' ' + inside); }
assert.equal(seen.some((s) => s.url.includes('meta-data')), false);
const before = seen.length;
r = await ask(q('url', T + '/page'), { env: PUBLIC }); assert.equal(r.status, 403); assert.equal(seen.length, before);   // not even this test's own target
// a redirect cannot lead where a first address could not go: every hop is checked. (UNFURL_ALLOW_LOCAL opens 127.0.0.1 and no more.)
r = await ask(q('url', T + '/out')); assert.equal(r.status, 403);
// the limit, when Cloudflare's limiter is bound
let asked = '';
const limited = { ...LOCAL, LIMIT: { limit: async ({ key }) => { asked = key; return { success: false }; } } };
r = await ask(q('url', T + '/page'), { env: limited, headers: { 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.9' } });
assert.equal(r.status, 429); assert.equal(asked, '203.0.113.9');

target.closeAllConnections(); target.close();
console.log('ok');
