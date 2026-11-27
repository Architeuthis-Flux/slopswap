// node .tools/social.test.mjs     the preview maker's own machinery (styles/social.js), with no browser: joining frames
// into an animated WebP, the cut-out, the palette PNG, where a page's files go, and the commit to GitHub (a stand-in
// for its API). Pillow (python3) makes the test frames and reads the results back, as any other reader would.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import M from '../styles/social.js';

const dir = mkdtempSync(join(tmpdir(), 'social-'));
const py = (code) => execFileSync('python3', ['-B', '-c', code], { encoding: 'utf8' }).trim();

// ---- frames into one animated WebP ----
py(`
from PIL import Image
for i, (c, a) in enumerate([((240, 40, 90), 255), ((40, 200, 240), 255), ((250, 220, 40), 0)]):
    im = Image.new('RGBA', (96, 50), c + (255,)); im.paste((0, 0, 0, a), (0, 0, 20, 20))
    im.save('${dir}/f%d.webp' % i, 'WEBP', quality=80)
Image.new('RGB', (96, 50), (9, 9, 9)).save('${dir}/plain.webp', 'WEBP', quality=80)
Image.new('RGB', (96, 50), (9, 9, 9)).save('${dir}/lossless.webp', 'WEBP', lossless=True)`);
const frames = [0, 1, 2].map((i) => new Uint8Array(readFileSync(`${dir}/f${i}.webp`)));
let out = M.webpAnim(frames, 96, 50, 80);
writeFileSync(`${dir}/anim.webp`, out);
assert.equal(py(`
from PIL import Image
im = Image.open('${dir}/anim.webp'); d = []
for i in range(im.n_frames):
    im.seek(i); im.load(); d.append(im.info['duration'])
im.seek(2); print(im.format, im.size, im.n_frames, d, im.info.get('loop'), im.convert('RGBA').getpixel((5, 5))[3], im.convert('RGBA').getpixel((60, 30))[:3])`),
  'WEBP (96, 50) 3 [80, 80, 80] 0 0 (250, 220, 40)'.replace('(250, 220, 40)', py(`
from PIL import Image
print(Image.open('${dir}/f2.webp').convert('RGBA').getpixel((60, 30))[:3])`)));
assert.equal(String.fromCharCode(...out.subarray(0, 4), ...out.subarray(8, 16)), 'RIFFWEBPVP8X');
assert.equal(new DataView(out.buffer).getUint32(4, true), out.length - 8);            // the file says how long it is
assert.equal(out[20] & 0x12, 0x12);                                                   // animated, and see-through
out = M.webpAnim([new Uint8Array(readFileSync(`${dir}/plain.webp`)), new Uint8Array(readFileSync(`${dir}/lossless.webp`))], 96, 50, 120);
writeFileSync(`${dir}/anim2.webp`, out);                                              // plain and lossless frames join too
assert.equal(py(`
from PIL import Image
im = Image.open('${dir}/anim2.webp'); print(im.n_frames, im.size)`), '2 (96, 50)');
assert.equal(out[20] & 0x10, 0);
assert.throws(() => M.webpAnim([new Uint8Array([1, 2, 3])], 96, 50, 80), /WebP/);
assert.throws(() => M.webpAnim([], 96, 50, 80), /frame/);

// ---- the cut-out: clear where the shot is the bare view to the bit, solid 6 levels away ----
const shot = new Uint8ClampedArray([10, 10, 10, 255, 50, 50, 50, 255, 53, 50, 50, 255, 57, 50, 50, 255, 50, 50, 50, 0]);
const bare = new Uint8ClampedArray([50, 50, 50, 255, 50, 50, 50, 255, 50, 50, 50, 255, 50, 50, 50, 255, 50, 50, 50, 255]);
M.cutOut(shot, bare);
assert.deepEqual([shot[3], shot[7], shot[11], shot[15], shot[19]], [255, 0, 127, 255, 0]);

// ---- a heavy see-through still as a palette PNG ----
const w = 64, h = 40, rgba = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, on = x >= 16 && y >= 8; rgba.set(on ? [x * 4, y * 6, 200, 255] : [0, 0, 0, 0], o); }
const png = await M.palettePng(rgba, w, h, 64);
writeFileSync(`${dir}/p.png`, png);
assert.equal(py(`
from PIL import Image
im = Image.open('${dir}/p.png'); r = im.convert('RGBA'); a, b = r.getpixel((2, 2)), r.getpixel((40, 20))
print(im.format, im.mode, im.size, a[3], b[3], abs(b[0] - 160) < 24 and abs(b[1] - 120) < 24 and abs(b[2] - 200) < 24, len(im.getcolors()) <= 64)`), 'PNG P (64, 40) 0 255 True True');

// ---- where a page's files go ----
assert.deepEqual(M.target('/V6/board-outline.html'), { stem: 'V6/board-outline-og', site: false });
assert.deepEqual(M.target('/roland-lg540/'), { stem: 'roland-lg540/index-og', site: false });
assert.deepEqual(M.target('/lenticular-shirt/index.html'), { stem: 'lenticular-shirt/index-og', site: false });
assert.deepEqual(M.target('/'), { stem: 'styles/social', site: true });
assert.deepEqual(M.target('/a%20b/c%20d.html'), { stem: 'a b/c d-og', site: false });
assert.deepEqual(M.names({ stem: 'V6/x-og', site: false }), { png: 'V6/x-og.png', webp: 'V6/x-og.webp', mp4: 'V6/x-og.mp4', json: 'V6/x-og.json' });
assert.deepEqual(M.names({ stem: 'styles/social', site: true }), { png: 'styles/social-card.png', webp: 'styles/social-sweep.webp', mp4: 'styles/social-sweep.mp4', json: 'styles/social-card.json' });

// ---- one commit through GitHub's API ----
const calls = [];
const github = async (url, init = {}) => {
  const path = url.replace('https://api.github.com/repos/o/r', ''), body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method: init.method || 'GET', path, body, auth: init.headers.Authorization });
  const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
  if (path === '/git/ref/heads/main') return json({ object: { sha: 'HEAD0' } });
  if (path === '/git/commits/HEAD0') return json({ tree: { sha: 'TREE0' } });
  if (path === '/git/blobs') return json({ sha: 'BLOB' + calls.filter((c) => c.path === '/git/blobs').length }, 201);
  if (path === '/git/trees') return json({ sha: 'TREE1' }, 201);
  if (path === '/git/commits') return json({ sha: 'HEAD1' }, 201);
  if (path === '/git/refs/heads/main') return json({ object: { sha: 'HEAD1' } });
  return json({ message: 'Not Found' }, 404);
};
const big = new Uint8Array(200000).map((_, i) => i % 251);
const sha = await M.publish({ repo: 'o/r', branch: 'main', token: 'T', message: 'V6: a preview', fetch: github,
  files: [{ path: 'V6/x-og.png', bytes: big }, { path: 'V6/x-og.json', bytes: new TextEncoder().encode('{"a":1}') }] });
assert.equal(sha, 'HEAD1');
assert.deepEqual(calls.map((c) => c.method + ' ' + c.path), ['GET /git/ref/heads/main', 'GET /git/commits/HEAD0', 'POST /git/blobs', 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main']);
assert.ok(calls.every((c) => c.auth === 'Bearer T'));
assert.deepEqual(Buffer.from(calls[2].body.content, 'base64'), Buffer.from(big)); assert.equal(calls[2].body.encoding, 'base64');
assert.deepEqual(calls[4].body, { base_tree: 'TREE0', tree: [{ path: 'V6/x-og.png', mode: '100644', type: 'blob', sha: 'BLOB1' }, { path: 'V6/x-og.json', mode: '100644', type: 'blob', sha: 'BLOB2' }] });
assert.deepEqual(calls[5].body, { message: 'V6: a preview', tree: 'TREE1', parents: ['HEAD0'] });
assert.deepEqual(calls[6].body, { sha: 'HEAD1' });
await assert.rejects(M.publish({ repo: 'o/r', branch: 'gone', token: 'T', message: 'm', fetch: github, files: [] }), /404|Not Found/);

console.log('ok');
