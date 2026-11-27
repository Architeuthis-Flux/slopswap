// node .workers/unfurl/dev.mjs [port] [site folder]
// The built site and the fetch Worker on this machine, with nothing installed: the link preview tester as it will be
// once the Worker is deployed. Defaults: port 8788, the site in ../../_site (run `python3 build.py` first).
// Here, and only here, the Worker may fetch from 127.0.0.1, so the tester can be pointed at this server's own pages.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './src/index.js';

const port = +process.argv[2] || 8788;
const root = resolve(process.argv[3] || fileURLToPath(new URL('../../_site', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  if (url.pathname === '/api/unfurl') {
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers }), { UNFURL_ALLOW_LOCAL: 'yes' });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const size = statSync(file).size, range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    if (range && +range[1] < size) {
      const from = +range[1], to = Math.min(size - 1, range[2] ? +range[2] : size - 1);
      res.writeHead(206, { ...head, 'content-range': `bytes ${from}-${to}/${size}`, 'content-length': to - from + 1 });
      return createReadStream(file, { start: from, end: to }).pipe(res);
    }
    res.writeHead(200, { ...head, 'content-length': size });
    createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<head><title>Not here</title></head>'); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/misc/link-preview.html   (site: ${root})`));
