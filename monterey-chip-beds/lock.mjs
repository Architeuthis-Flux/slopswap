#!/usr/bin/env node
// Locks the private files of monterey-chip-beds so only ciphertext goes in this public repo.
//
//   node lock.mjs [srcDir] [outDir]      defaults: ./src and ./enc beside this script
//
// It asks for a passphrase (not echoed, never stored), derives a key with PBKDF2-SHA256 and writes
// <name>.enc for each file below with AES-256-GCM: the same calls unlock.js makes in the browser.
// Keep srcDir outside any git checkout. Copy outDir/*.enc into monterey-chip-beds/ and commit those.
// The ciphertext is public and can be guessed at offline for ever, so the passphrase must be long.
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = {                                   // plaintext file -> name the page asks for
  'guide.html': 'guide',
  'map-pins.json': 'map-pins',
  'map-records.json': 'map-records',
  'map-cells.json': 'map-cells',
  'monterey-chip-bed-spots.kml': 'spots-kml',
};
const ITER = 600000, MIN = 14;
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] || path.join(here, 'src'));
const out = path.resolve(process.argv[3] || path.join(here, 'enc'));
const b64 = (u) => Buffer.from(u).toString('base64');

function ask(question) {                          // one line from the terminal, not echoed
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {                           // piped in (tests): first line
      let s = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { s += d; });
      stdin.on('end', () => resolve(s.split(/\r?\n/)[0]));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '';
    const on = (d) => {
      for (const ch of d) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(s); }
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', on);
  });
}

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const missing = Object.keys(FILES).filter((f) => !fs.existsSync(path.join(src, f)));
if (missing.length) { console.error(`Missing in ${src}: ${missing.join(', ')}`); process.exit(1); }

const pass = await ask(`Passphrase for the page (at least ${MIN} characters): `);
if (pass.length < MIN) { console.error(`Too short: use at least ${MIN} characters, such as four or more random words.`); process.exit(1); }
if (process.stdin.isTTY) {
  const again = await ask('Again: ');
  if (again !== pass) { console.error('The two did not match. Nothing was written.'); process.exit(1); }
}

const salt = crypto.getRandomValues(new Uint8Array(16));   // one salt per run, so the page derives the key once
const key = await keyFrom(pass, salt);
fs.mkdirSync(out, { recursive: true });
for (const [file, name] of Object.entries(FILES)) {
  const plain = fs.readFileSync(path.join(src, file));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const back = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  if (!back.equals(plain)) throw new Error(`${file} did not survive a round trip`);
  fs.writeFileSync(path.join(out, name + '.enc'), JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
}
fs.writeFileSync(path.join(out, 'LOCKED'), new Date().toISOString() + '\n');
console.log(`Locked ${Object.keys(FILES).length} files into ${out}`);
