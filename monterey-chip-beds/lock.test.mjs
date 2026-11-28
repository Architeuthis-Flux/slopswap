// node lock.test.mjs
// Locks dummy files with a random passphrase (lock.mjs), then opens them with the page's own unlock.js.
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chiplock-'));
const src = path.join(tmp, 'src'), out = path.join(tmp, 'enc');
const names = { 'guide.html': 'guide', 'map-pins.json': 'map-pins', 'map-records.json': 'map-records', 'map-cells.json': 'map-cells', 'monterey-chip-bed-spots.kml': 'spots-kml' };
fs.mkdirSync(src);
for (const f of Object.keys(names)) fs.writeFileSync(path.join(src, f), `${f} é ${randomBytes(4000).toString('hex')}`);
const lock = (input) => execFileSync(process.execPath, [path.join(here, 'lock.mjs'), src, out], { input, stdio: ['pipe', 'pipe', 'pipe'] });

assert.throws(() => lock('too short\n'), 'a short passphrase is refused');
assert.ok(!fs.existsSync(out), 'and nothing is written for it');
const pass = randomBytes(18).toString('base64');
lock(pass + '\n');
for (const n of Object.values(names)) assert.ok(!fs.readFileSync(path.join(out, n + '.enc'), 'utf8').includes('é'), 'no plaintext in ' + n);

// the page's code, with fetch reading the locked folder
const ctx = {
  atob, TextEncoder, TextDecoder, crypto: webcrypto, document: {},
  fetch: async (u) => {
    const p = path.join(out, u);
    return fs.existsSync(p) ? { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) } : { ok: false, status: 404 };
  },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, 'unlock.js'), 'utf8'), ctx);
const L = ctx.ChipLock;

await assert.rejects(L.unlock(pass + 'x'), (e) => e.name === 'OperationError', 'a wrong password is refused');
assert.strictEqual(L.key, null);
await L.unlock(pass);
for (const [f, n] of Object.entries(names)) assert.strictEqual(await L.read(n), fs.readFileSync(path.join(src, f), 'utf8'), f);

fs.rmSync(tmp, { recursive: true });
console.log('ok: locked 5 files, wrong password refused, right password reads them back');
