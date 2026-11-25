// The V6 notebook's pages, kept on Kevin's own Cloudflare account so that every device shows the same ones.
// One notebook, one row: its text, and a number (rev) that goes up by one with every change.
//
//   GET  /api/notebook                      -> { rev, notebook }           (rev 0 and null while there is none)
//   PUT  /api/notebook  { base, notebook }  -> { rev }                     written only if rev is still `base`
//                                           -> 409 { error, rev, notebook } somebody wrote since: merge and try again
// Both need "Authorization: Bearer <key>". What a notebook holds is the page's business (V6/notebook-sync.js);
// here it is JSON of a bounded size and nothing in it is ever run.
//
// ponytail: no CORS, because the page is on the hostname this answers on. One notebook for one key; a second
// notebook would be a second id and a way to name it.

const MAX_BYTES = 1500 * 1024;          // D1 holds 2 MB in a row; a page is about 12 kB, so this is over a hundred pages
const MIN_KEY = 24;                     // a shorter secret on the server is taken as none
const BOOK = "v6";

const answer = (status, body) => new Response(JSON.stringify(body),
    { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const refuse = (status, message, more) => answer(status, { error: message, ...more });

async function digest(text) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The body as text, or null once it is longer than `most` bytes.
async function read(request, most) {
    if (!request.body) return "";
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body) {
        size += chunk.length;
        if (size > most) return null;
        chunks.push(chunk);
    }
    return new Blob(chunks).text();
}

const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

export default {
    async fetch(request, env) {
        const key = env.NOTEBOOK_KEY || "";
        if (key.length < MIN_KEY) return refuse(503, "no key is set on the server");
        // Digests are compared so that how long the comparison takes says nothing of the key.
        const given = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
        if (await digest(given) !== await digest(key)) return refuse(401, "the key is missing or wrong");

        const now = async () => {
            const row = await env.DB.prepare("SELECT rev, body FROM notebook WHERE id = ?").bind(BOOK).first();
            return row ? { rev: row.rev, notebook: JSON.parse(row.body) } : { rev: 0, notebook: null };
        };
        if (request.method === "GET") return answer(200, await now());
        if (request.method !== "PUT") return refuse(405, "GET the notebook, or PUT a newer one");

        const tooBig = "a notebook may be at most " + MAX_BYTES + " bytes";
        if (Number(request.headers.get("content-length")) > MAX_BYTES) return refuse(413, tooBig);
        const text = await read(request, MAX_BYTES);
        if (text === null) return refuse(413, tooBig);
        let q;
        try {
            q = JSON.parse(text);
        } catch {
            return refuse(400, "the body is not JSON");
        }
        if (!isObject(q) || !Number.isInteger(q.base) || q.base < 0) return refuse(400, "base must be the rev the notebook was read at");
        if (!isObject(q.notebook) || !isObject(q.notebook.pages)) return refuse(400, "notebook must be an object with pages");

        // One statement decides: the row is written only if nobody has written since `base`.
        const body = JSON.stringify(q.notebook);
        const wrote = q.base === 0
            ? await env.DB.prepare("INSERT INTO notebook (id, rev, body, t) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO NOTHING")
                .bind(BOOK, body, Date.now()).run()
            : await env.DB.prepare("UPDATE notebook SET rev = rev + 1, body = ?, t = ? WHERE id = ? AND rev = ?")
                .bind(body, Date.now(), BOOK, q.base).run();
        if (wrote.meta.changes === 1) return answer(200, { rev: q.base + 1 });
        return refuse(409, "the notebook changed since it was read", await now());
    },
};
