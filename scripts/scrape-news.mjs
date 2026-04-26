#!/usr/bin/env node
// Scrape headlines per ticker from Google News RSS (no-auth, stable).
// Append to data/news-feed.json with verified=false. Validator stamps later.
//
// Why Google News RSS: saveticker.com serves 403 to non-browser UAs
// (Cloudflare). Google News RSS is key-less, returns multi-publisher
// headlines (Reuters / CNBC / Bloomberg / Yahoo / etc.), and gives us a
// per-publisher `source` field — which is actually richer than saveticker's
// pre-aggregated feed for the validator's >=2-source check.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore, slugify } from './lib/io.mjs';

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

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = (universe.tickers || []).map(t => t.symbol);

    let feed = { items: [] };
    try { feed = await readJson('data/news-feed.json'); } catch { /* first run */ }
    if (!feed.note) feed.note = 'Owned by collector agent; verified field set by validator. Each item must have ≥2 cross-sources to be verified=true.';
    feed.items = feed.items || [];

    const existingIds = new Set(feed.items.map(i => i.id));
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

    if (collected.length > 0) {
        feed.items.push(...collected);
        await writeJsonAtomic('data/news-feed.json', feed);
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

main().catch(e => { console.error('fatal:', e); process.exit(1); });
