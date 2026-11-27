// The link preview tester's fetcher. A page cannot read another site's HTML (the browser forbids it), so this reads
// it for misc/link-preview.html and hands back text. It answers on the page's own hostname, to that site's pages only.
//
//   GET /api/unfurl?url=<address>&as=<crawler>    -> { url, final, status, hops, type, html, bytes, cut, ms, as }
//        the top of a document, to </head> or 400 kB, asked for as that crawler asks (misc/link-preview.js, CRAWLERS)
//   GET /api/unfurl?probe=<address>&as=<crawler>  -> { url, final, status, type, bytes, format, width, height, animated, ms }
//        what a picture or video is, from its first 256 kB
//   GET /api/unfurl?text=<address>                -> { url, final, status, type, text }
//        a small text file (oEmbed, a linked Discord layout), at most 64 kB
//   anything refused                              -> { error }: 400 not an http(s) address, 403 an address or caller it
//        will not serve, 405 not GET, 429 too many, 502 no answer, 504 too slow, 508 too many redirects
//
// What keeps it from being anyone's proxy: only http and https on their own ports, never a local or private address
// (each redirect is checked again), never this site's own /api/, at most five redirects and eight seconds, only the
// start of a file, only for a page of this site (Sec-Fetch-Site: same-origin, which a browser sets and a page cannot
// forge), and Cloudflare's limiter per address. Nothing fetched is ever run.
//
// ponytail: UNFURL_ALLOW_LOCAL=yes (tests and dev.mjs only, never in wrangler.jsonc) lets it reach 127.0.0.1.
import LP from '../../../misc/link-preview.js';

const HEAD_MOST = 400 * 1024, PROBE_MOST = 256 * 1024, TEXT_MOST = 64 * 1024, HOPS = 5, PATIENCE_MS = 8000;

const answer = (status, body) => new Response(JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const refuse = (status, message) => answer(status, { error: message });
class Refusal extends Error { constructor(status, message) { super(message); this.status = status; } }

// Why an address will not be fetched, or '' if it may be.
function refused(u, env, self) {
    const host = u.hostname.toLowerCase();
    if (env.UNFURL_ALLOW_LOCAL === 'yes' && host === '127.0.0.1' && u.protocol === 'http:') return '';
    if (u.username || u.password) return 'an address with a name and password in it';
    if (u.port) return 'a port other than 80 or 443';
    if (host === self.hostname.toLowerCase() && u.pathname.startsWith('/api/')) return "this site's own /api/";
    if (host.startsWith('[')) return 'an IPv6 address';
    if (host === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host) || !host.includes('.')) return 'a local name';
    const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);       // the URL parser has already turned 2130706433 and 0x7f.1 into dotted form
    if (ip) {
        const [a, b] = [+ip[1], +ip[2]];
        if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)))
            return 'a private or local address';
    }
    return '';
}

// The address, as a URL, or a Refusal saying why not.
function address(text) {
    let u;
    try { u = new URL(String(text).trim()); } catch (e) { throw new Refusal(400, 'that is not a whole http or https address'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Refusal(400, 'only http and https addresses are fetched');
    return u;
}

// Fetch, following redirects by hand so that every address on the way is checked.
async function get(start, headers, env, self, signal) {
    const hops = [];
    let url = start;
    for (let i = 0; i <= HOPS; i++) {
        const why = refused(url, env, self);
        if (why) throw new Refusal(403, (hops.length ? 'a redirect led to ' : 'this will not fetch ') + why);
        const r = await fetch(url.href, { redirect: 'manual', headers, signal });
        const next = r.headers.get('location');
        if (r.status < 300 || r.status > 399 || !next) return { r, url, hops };
        hops.push({ url: url.href, status: r.status });
        if (r.body) await r.body.cancel();
        try { url = address(new URL(next, url).href); } catch (e) { throw new Refusal(502, 'a redirect led to something that is not an address'); }
    }
    throw new Refusal(508, 'more than ' + HOPS + ' redirects');
}

// The first `most` bytes of an answer, and whether there was more.
async function start(r, most) {
    if (!r.body) return { bytes: new Uint8Array(0), more: false };
    const reader = r.body.getReader(), chunks = [];
    let size = 0, more = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); size += value.length;
        if (size >= most) { more = true; await reader.cancel(); break; }
    }
    const all = new Uint8Array(Math.min(size, most));
    let at = 0;
    for (const c of chunks) { const part = c.subarray(0, all.length - at); all.set(part, at); at += part.length; if (at >= all.length) break; }
    return { bytes: all, more: more || size > most };
}

function words(bytes, type) {
    const named = /charset=["']?([\w-]+)/i.exec(type || '');
    try { return new TextDecoder(named ? named[1] : 'utf-8').decode(bytes); } catch (e) { return new TextDecoder().decode(bytes); }
}

export default {
    async fetch(request, env) {
        if (request.method !== 'GET') return refuse(405, 'GET only');
        if (request.headers.get('sec-fetch-site') !== 'same-origin') return refuse(403, "this answers only pages of its own site");
        if (env.LIMIT) {
            const { success } = await env.LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'nobody' });
            if (!success) return refuse(429, 'too many previews from this address; try again in a minute');
        }
        const self = new URL(request.url), ask = self.searchParams;
        const modes = ['url', 'probe', 'text'].filter((m) => ask.get(m));
        if (modes.length !== 1) return refuse(400, 'ask for one of url=, probe= or text=');
        const mode = modes[0], as = ask.get('as') || 'discord';
        if (!Object.prototype.hasOwnProperty.call(LP.CRAWLERS, as)) return refuse(400, 'as= must be one of ' + Object.keys(LP.CRAWLERS).join(', '));

        const began = Date.now(), stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), +env.UNFURL_TIMEOUT_MS || PATIENCE_MS);
        try {
            const first = address(ask.get(mode));
            const headers = { 'user-agent': LP.CRAWLERS[as].ua, accept: mode === 'url' ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' : '*/*' };
            if (mode === 'probe') headers.range = 'bytes=0-' + (PROBE_MOST - 1);
            const { r, url, hops } = await get(first, headers, env, self, stop.signal);
            const type = r.headers.get('content-type') || '', base = { url: first.href, final: url.href, status: r.status, type };
            if (mode === 'probe') {
                const { bytes } = await start(r, PROBE_MOST);
                const total = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
                const size = total ? +total[1] : r.status === 200 && r.headers.get('content-length') ? +r.headers.get('content-length') : null;
                return answer(200, { ...base, bytes: size, ...LP.sniff(r.status >= 200 && r.status < 300 ? bytes : new Uint8Array(0)), ms: Date.now() - began });
            }
            if (mode === 'text') {
                const { bytes } = await start(r, TEXT_MOST);
                return answer(200, { ...base, text: words(bytes, type) });
            }
            if (type && !/html|xml|text\/plain/i.test(type)) {           // a picture, a PDF: said as what it is, and not read
                if (r.body) await r.body.cancel();
                return answer(200, { ...base, hops, html: '', bytes: 0, cut: false, ms: Date.now() - began, as });
            }
            const { bytes, more } = await start(r, HEAD_MOST);
            let html = words(bytes, type);
            const end = html.search(/<\/head\s*>/i);
            const cut = more || end >= 0;
            if (end >= 0) html = html.slice(0, end) + '</head>';
            return answer(200, { ...base, hops, html, bytes: bytes.length, cut, ms: Date.now() - began, as });
        } catch (e) {
            if (e instanceof Refusal) return refuse(e.status, e.message);
            if (stop.signal.aborted) return refuse(504, 'no answer within ' + Math.round((+env.UNFURL_TIMEOUT_MS || PATIENCE_MS) / 1000) + ' s');
            return refuse(502, 'could not fetch it: ' + ((e && e.cause && e.cause.code) || (e && e.message) || 'no answer'));
        } finally {
            clearTimeout(timer);
        }
    },
};
