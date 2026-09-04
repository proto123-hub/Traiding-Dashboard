#!/usr/bin/env node
// Scrape headlines per ticker from Google News RSS (no-auth, stable).
// Append to data/news-feed.json with verified=false. Validator stamps later.
//
// Why Google News RSS: saveticker.com serves 403 to non-browser UAs
// (Cloudflare). Google News RSS is key-less, returns multi-publisher
// headlines (Reuters / CNBC / Bloomberg / Yahoo / etc.), and gives us a
// per-publisher `source` field — which is actually richer than saveticker's
// pre-aggregated feed for the validator's >=2-source check.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore, slugify, NEWS_FEED_NOTE } from './lib/io.mjs';

const TIMEOUT_MS = 8000;
const CONCURRENCY = 4;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_PER_TICKER = 5;

function decodeXmlEntities(s) {
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function parseRssItems(xml, max) {
    const items = [];
    const re = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < max) {
        const block = m[1];
        const grab = (tag) => {
            const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`).exec(block);
            if (cdata) return cdata[1];
            const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
            return plain ? plain[1] : '';
        };
        const title = decodeXmlEntities(grab('title')).trim();
        const link = decodeXmlEntities(grab('link')).trim();
        const pubDate = grab('pubDate').trim();
        const sourceRaw = grab('source').trim();
        const source = decodeXmlEntities(sourceRaw.replace(/^.*?>([^<]+)<.*$/, '$1') || sourceRaw || 'Google News').trim();
        if (!title) continue;
        items.push({ title, link, pubDate, source });
    }
    return items;
}

async function fetchGoogleNews(symbol, signal) {
    // hl=en-US, gl=US, ceid=US:en — US English news edition
    const q = `${symbol}+stock`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml' }
    });
    if (!res.ok) throw new Error(`google-news:http_${res.status}`);
    const xml = await res.text();
    return parseRssItems(xml, MAX_PER_TICKER);
}

/**
 * Fail-closed shape check, run BEFORE any scraping.
 *
 * `feed.items = feed.items || []` was the whole of this, and it is the shape a
 * silent history loss takes: `{"items": null}` parses, so the loud
 * does-not-parse branch never fires; the coalesce then turns 9,046 records into
 * `[]`, the run appends the day's headlines and exits 0. Corruption that
 * happens to be valid JSON must be as loud as corruption that is not.
 *
 * Returns a list of faults; empty means the object is safe to append to.
 */
export function feedShapeFaults(feed) {
    const out = [];
    if (feed === null || typeof feed !== 'object' || Array.isArray(feed)) {
        out.push(`top level is ${Array.isArray(feed) ? 'an array' : feed === null ? 'null' : typeof feed}, expected an object`);
        return out;
    }
    if (!('items' in feed)) out.push('no "items" key');
    else if (!Array.isArray(feed.items)) {
        out.push(`"items" is ${feed.items === null ? 'null' : typeof feed.items}, expected an array`);
    }
    return out;
}

/**
 * Continuity gate: every id read must still be present in what is written.
 *
 * The previous version compared `feed.items.length` before and after a push
 * into that same array, so the two lengths were the same number read twice and
 * the branch could not fire. Comparing ID SETS on the object actually handed to
 * the writer is checkable: it fires if a future edit rebuilds `items` by
 * filter, map, or assignment instead of appending to it.
 */
export function continuityFaults(beforeIds, afterItems) {
    const after = new Set((afterItems || []).map(i => i && i.id));
    const missing = [...beforeIds].filter(id => !after.has(id));
    if (!missing.length) return [];
    return [
        `refusing to write data/news-feed.json: ${missing.length} of ${beforeIds.size} ids read ` +
        `are absent from what would be written (e.g. ${missing.slice(0, 3).map(i => JSON.stringify(i)).join(', ')}). ` +
        `An append-only feed cannot lose records.`
    ];
}

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = (universe.tickers || []).map(t => t.symbol);

    // A bare catch here treated three different situations identically: a
    // genuine first run, a missing file, and a CORRUPT one. Removing the
    // committed 9,046-item feed and re-running produced a fresh 24-item file
    // and a green validator pass — the entire history gone inside a run that
    // reported success. Absence and corruption now fail loudly; bootstrapping
    // an empty feed is possible but must be asked for.
    let feed;
    try {
        feed = await readJson('data/news-feed.json');
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw new Error(
                `data/news-feed.json exists but does not parse (${e.message}). Refusing to ` +
                `continue: this run would replace the whole feed with today's headlines.`
            );
        }
        // `!process.env.NEWS_FEED_BOOTSTRAP` let NEWS_FEED_BOOTSTRAP=0 through:
        // env vars are strings and "0" is truthy. An opt-in this destructive
        // takes exactly the one value that spells it.
        if (process.env.NEWS_FEED_BOOTSTRAP !== '1') {
            throw new Error(
                'data/news-feed.json is missing. It is a committed file, so absence means a ' +
                'bad checkout or a deleted file, not a first run. Set NEWS_FEED_BOOTSTRAP=1 to ' +
                'create one deliberately.'
            );
        }
        feed = { items: [] };
    }

    // Before the network, not after: a run that has already spent 24 fetches is
    // under pressure to write something, and this is the point at which the
    // feed is still exactly what was on disk.
    const shape = feedShapeFaults(feed);
    if (shape.length) {
        throw new Error(
            `data/news-feed.json parses but is not a news feed: ${shape.join('; ')}. Refusing to ` +
            `continue: this run would replace the whole feed with today's headlines.`
        );
    }

    // Set unconditionally, not `if (!feed.note)`. The old form meant a wrong
    // committed value was never repaired by any run — which is why replacing it
    // with "x" survived indefinitely. The note is a fixed contract, not data.
    const noteWasWrong = feed.note !== NEWS_FEED_NOTE;
    feed.note = NEWS_FEED_NOTE;

    const startingIds = new Set(feed.items.map(i => i.id));
    const existingIds = new Set(startingIds);
    const sem = new Semaphore(CONCURRENCY);
    const collected = [];
    const failures = [];
    const ts = nowIso();

    await Promise.all(tickers.map(sym => sem.run(async () => {
        try {
            const items = await withTimeout(s => fetchGoogleNews(sym, s), TIMEOUT_MS, `news:${sym}`);
            for (const it of items) {
                const day = (it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : todayUtc());
                const id = `${day}-${sym.toLowerCase()}-${slugify(it.title)}`;
                if (existingIds.has(id)) continue;
                existingIds.add(id);
                collected.push({
                    id,
                    ticker: sym,
                    headline: it.title,
                    source: it.source || 'Google News',
                    url: it.link,
                    collectedAt: ts,
                    verified: false,
                    verifiedBy: [],
                    crossSources: [],
                    sentiment: null,
                    impact: null,
                    eventType: null,
                    rawExcerpt: ''
                });
            }
        } catch (e) {
            failures.push({ symbol: sym, source: 'google-news', reason: e.message });
        }
    })));

    // `collected.length > 0` alone was not enough: assigning the note in memory
    // repairs nothing if the file is never written, so a run that collected no
    // headlines exited 0 and left a wrong note on disk. The validator fails
    // closed on it either way, but "the writer repairs it" was only true of
    // runs that happened to find news. A note-only repair is now a reason to
    // write on its own.
    if (collected.length > 0 || noteWasWrong) {
        const outgoing = { ...feed, items: [...feed.items, ...collected] };
        const faults = continuityFaults(startingIds, outgoing.items);
        if (faults.length) throw new Error(faults.join(' '));
        await writeJsonAtomic('data/news-feed.json', outgoing);
    }

    if (collected.length > 0 || failures.length > 0) {
        const rawDrop = {
            agent: 'refresher',
            runAt: ts,
            asOfDate: todayUtc(),
            appendedItems: collected,
            failures
        };
        await writeJsonAtomic(`reports/raw/${todayUtc()}-google-news.json`, rawDrop);
    }

    console.log(`scrape-news: appended ${collected.length} items across ${tickers.length} tickers, ${failures.length} failures`);
}

// Direct-invocation guard, same reason as validate-data.mjs: importing this to
// drive main() against a stubbed fetch in scripts/test/ must not scrape.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main().catch(e => { console.error('fatal:', e.message || e); process.exit(1); });
}

export { main };
