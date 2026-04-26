#!/usr/bin/env node
// Scrape headlines from saveticker.com per ticker; append to data/news-feed.json
// with verified=false. Validator stamps verified later.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore, slugify } from './lib/io.mjs';

const TIMEOUT_MS = 6000;
const CONCURRENCY = 4;
const UA = 'Mozilla/5.0 (compatible; TraidingDashboardBot/1.0; +https://github.com/proto123-hub/Traiding-Dashboard)';
const MAX_PER_TICKER = 5;

async function fetchSavetickerNews(symbol, signal) {
    const url = `https://saveticker.com/ticker/${symbol.toLowerCase()}`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html' }
    });
    if (!res.ok) throw new Error(`saveticker:http_${res.status}`);
    const html = await res.text();
    const m = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('saveticker:no_next_data');
    const data = JSON.parse(m[1]);
    const news = data?.props?.pageProps?.news || data?.props?.pageProps?.headlines || [];
    return news.slice(0, MAX_PER_TICKER).map(n => ({
        headline: n.title || n.headline || '',
        source: n.source || n.publisher || 'saveticker',
        url: n.url || n.link || '',
        publishedAt: n.publishedAt || n.date || null
    })).filter(n => n.headline);
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
            const items = await withTimeout(s => fetchSavetickerNews(sym, s), TIMEOUT_MS, `news:${sym}`);
            for (const it of items) {
                const day = (it.publishedAt || todayUtc()).slice(0, 10);
                const id = `${day}-${sym.toLowerCase()}-${slugify(it.headline)}`;
                if (existingIds.has(id)) continue;
                existingIds.add(id);
                collected.push({
                    id,
                    ticker: sym,
                    headline: it.headline,
                    source: it.source,
                    url: it.url,
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
            failures.push({ symbol: sym, source: 'saveticker', reason: e.message });
        }
    })));

    feed.items.push(...collected);
    await writeJsonAtomic('data/news-feed.json', feed);

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate: todayUtc(),
        appendedItems: collected,
        failures
    };
    await writeJsonAtomic(`reports/raw/${todayUtc()}-saveticker-news.json`, rawDrop);

    console.log(`scrape-news: appended ${collected.length} items across ${tickers.length} tickers, ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
