// The site's visit counter: how many people see slopswap, which pages, for how long, and what they used there.
// styles/seen.js (on every page) reports one line per page view when the visitor leaves; misc/visitors.html reads the
// sums back with a key. It answers on the site's own hostname:
//
//   POST /api/seen  { v, page, secs, scroll, ref, wide, used }   -> 204        one page view (sent again as it grows)
//   GET  /api/seen?days=30    with "Authorization: Bearer <key>" -> { total, days, pages, used, refs, countries }
//
// What is kept for a view: the day, the page, seconds looked at, how far it was scrolled, the site it came from, the
// country Cloudflare names, the window's width, and the labels of the controls used with a count each. What is not:
// no address, no cookie, nothing in the visitor's browser, nothing typed. People are told apart only within a day, by
// a one-way hash of the day, the address, the browser's name and the server's key: the same friend tomorrow is
// somebody new, and the hash cannot be turned back into an address.
//
// ponytail: one table in the notebook's database (nothing shared with the notebook's own row); a report reads at most
// the newest 20,000 views and sums them here. If the site ever outgrows that, sum in SQL.
const MOST = 4096, NEWEST = 20000, MIN_KEY = 24;
const TABLE = 'CREATE TABLE IF NOT EXISTS seen (view TEXT PRIMARY KEY, day TEXT NOT NULL, at INTEGER NOT NULL, who TEXT NOT NULL, page TEXT NOT NULL, secs INTEGER NOT NULL, scroll INTEGER NOT NULL, ref TEXT NOT NULL, country TEXT NOT NULL, wide INTEGER NOT NULL, used TEXT NOT NULL)';
const INDEX = 'CREATE INDEX IF NOT EXISTS seen_day ON seen (day)';
const BOT = /bot|crawl|spider|slurp|preview|headless|facebookexternalhit|whatsapp|slack|telegram|curl|wget|python|monitor/i;
let ready = false;

const answer = (status, body) => new Response(body === null ? null : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const refuse = (status, message) => answer(status, { error: message });

async function digest(text) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

// One page view as a page may report it, made safe to keep; null for anything that is not one.
export function clean(o) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
    const whole = (n, low, high) => (Number.isFinite(+n) ? Math.max(low, Math.min(high, Math.round(+n))) : low);
    if (typeof o.v !== 'string' || !/^[0-9a-f]{8,32}$/.test(o.v)) return null;
    if (typeof o.page !== 'string' || !/^\/(?!\/)/.test(o.page)) return null;
    const page = o.page.split(/[?#]/)[0];
    if (page.length > 200 || !Number.isFinite(+o.secs) || +o.secs < 1) return null;
    const used = {};
    if (o.used !== null && typeof o.used === 'object' && !Array.isArray(o.used)) {
        for (const [k, n] of Object.entries(o.used)) {
            const label = String(k).replace(/\s+/g, ' ').trim();
            if (!label || label.length > 48 || !Number.isFinite(+n) || +n < 1 || Object.keys(used).length >= 40) continue;
            used[label] = whole(n, 1, 9999);
        }
    }
    return { view: o.v, page, secs: whole(o.secs, 1, 14400), scroll: whole(o.scroll, 0, 100),
        ref: typeof o.ref === 'string' && /^[a-z0-9.-]{1,100}$/i.test(o.ref) ? o.ref.toLowerCase() : '', wide: Math.round(whole(o.wide, 0, 10000) / 100) * 100, used };
}

// The sums the visitors page shows, from the kept views. A person is somebody on one day (see the top of this file).
export function report(rows) {
    const days = new Map(), pages = new Map(), used = new Map(), refs = new Map(), lands = new Map(), everyone = new Set();
    const at = (map, key, make) => { if (!map.has(key)) map.set(key, make()); return map.get(key); };
    let secs = 0, phones = 0;
    for (const r of rows) {
        const person = r.day + '|' + r.who;
        everyone.add(person); secs += r.secs; if (r.wide > 0 && r.wide < 700) phones++;
        const d = at(days, r.day, () => ({ people: new Set(), visits: 0, secs: 0 })); d.people.add(r.who); d.visits++; d.secs += r.secs;
        const p = at(pages, r.page, () => ({ people: new Set(), all: [], scroll: 0 })); p.people.add(person); p.all.push(r.secs); p.scroll += r.scroll;
        if (r.ref) refs.set(r.ref, (refs.get(r.ref) || 0) + 1);
        if (r.country) at(lands, r.country, () => new Set()).add(person);
        let labels = {};
        try { labels = JSON.parse(r.used) || {}; } catch (e) { labels = {}; }
        for (const [label, n] of Object.entries(labels)) { const u = at(used, r.page + '\n' + label, () => ({ page: r.page, label, times: 0, people: new Set() })); u.times += +n || 0; u.people.add(person); }
    }
    const middle = (list) => { const s = list.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
    return {
        total: { people: everyone.size, visits: rows.length, secs, phones },
        days: Array.from(days, ([day, d]) => ({ day, people: d.people.size, visits: d.visits, secs: d.secs })).sort((a, b) => (a.day < b.day ? -1 : 1)),
        pages: Array.from(pages, ([page, p]) => ({ page, people: p.people.size, visits: p.all.length, typical: middle(p.all), secs: p.all.reduce((a, b) => a + b, 0), read: Math.round(p.scroll / p.all.length) }))
            .sort((a, b) => b.secs - a.secs),
        used: Array.from(used.values(), (u) => ({ page: u.page, label: u.label, times: u.times, people: u.people.size }))
            .sort((a, b) => b.times - a.times || (a.label < b.label ? -1 : 1)).slice(0, 200),
        refs: Array.from(refs, ([ref, visits]) => ({ ref, visits })).sort((a, b) => b.visits - a.visits),
        countries: Array.from(lands, ([country, people]) => ({ country, people: people.size })).sort((a, b) => b.people - a.people),
    };
}

// The body as text, or null once it is longer than `most` bytes.
async function read(request, most) {
    if (!request.body) return '';
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body) {
        size += chunk.length;
        if (size > most) return null;
        chunks.push(chunk);
    }
    return new Blob(chunks).text();
}

export default {
    async fetch(request, env) {
        const key = env.SEEN_KEY || '';
        if (key.length < MIN_KEY) return refuse(503, 'no key is set on the server');      // the key also salts the hash: without it nothing is kept
        if (!ready) { await env.DB.prepare(TABLE).run(); await env.DB.prepare(INDEX).run(); ready = true; }
        const url = new URL(request.url), now = +env.SEEN_NOW || Date.now(), day = (ms) => new Date(ms).toISOString().slice(0, 10);

        if (request.method === 'POST') {
            if (request.headers.get('origin') !== url.origin && request.headers.get('sec-fetch-site') !== 'same-origin') return refuse(403, 'only this site\'s own pages report here');
            const ua = request.headers.get('user-agent') || '', ip = request.headers.get('cf-connecting-ip') || '';
            if (BOT.test(ua)) return answer(204, null);                                      // a machine reading the page is not a visit
            if (env.LIMIT) { const { success } = await env.LIMIT.limit({ key: ip || 'nobody' }); if (!success) return refuse(429, 'too many reports from this address'); }
            const text = await read(request, MOST);
            if (text === null) return refuse(413, 'a report may be at most ' + MOST + ' bytes');
            let row;
            try { row = clean(JSON.parse(text)); } catch (e) { row = null; }
            if (!row) return refuse(400, 'that is not a page view');
            const who = (await digest(day(now) + '|' + key + '|' + ip + '|' + ua)).slice(0, 16);
            await env.DB.prepare('INSERT INTO seen (view, day, at, who, page, secs, scroll, ref, country, wide, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                + 'ON CONFLICT (view) DO UPDATE SET secs = max(secs, excluded.secs), scroll = max(scroll, excluded.scroll), used = excluded.used')
                .bind(row.view, day(now), Math.floor(now / 1000), who, row.page, row.secs, row.scroll, row.ref, (request.headers.get('cf-ipcountry') || '').slice(0, 2), row.wide, JSON.stringify(row.used)).run();
            return answer(204, null);
        }
        if (request.method !== 'GET') return refuse(405, 'POST a page view, or GET the report');
        // Digests are compared so that how long the comparison takes says nothing of the key.
        const given = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
        if (await digest(given) !== await digest(key)) return refuse(401, 'the key is missing or wrong');
        const span = Math.max(1, Math.min(365, Math.round(+url.searchParams.get('days')) || 30));
        const rows = await env.DB.prepare('SELECT day, who, page, secs, scroll, ref, country, wide, used FROM seen WHERE day >= ? ORDER BY at DESC LIMIT ?')
            .bind(day(now - (span - 1) * 86400000), NEWEST).all();
        return answer(200, report(rows.results));
    },
};
