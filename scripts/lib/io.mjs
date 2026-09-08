import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The exact note data/news-feed.json must carry. It lives here because three
 * places need to agree on it and a word-search does not make them agree: a
 * check for "collector" and "validator" accepted "Owned by validator; verified
 * set by collector" and "Collector does not own this file", which invert and
 * negate the contract while satisfying every word in it. The value is the
 * contract, so it is one constant and compared exactly.
 */
export const NEWS_FEED_NOTE =
    'Owned by collector agent; verified field set by validator. ' +
    'Each item must have \u22652 cross-sources to be verified=true.';

export async function readJson(path) {
    const buf = await readFile(path, 'utf8');
    return JSON.parse(buf);
}

export async function writeJsonAtomic(path, obj) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
}

export function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

export function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function withTimeout(promise, ms, label) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`timeout:${label}`)), ms);
    try {
        return await promise(ctrl.signal);
    } finally {
        clearTimeout(timer);
    }
}

export class Semaphore {
    constructor(n) { this.n = n; this.q = []; }
    async acquire() {
        if (this.n > 0) { this.n--; return; }
        await new Promise(r => this.q.push(r));
        this.n--;
    }
    release() {
        this.n++;
        const r = this.q.shift();
        if (r) r();
    }
    async run(fn) {
        await this.acquire();
        try { return await fn(); }
        finally { this.release(); }
    }
}
