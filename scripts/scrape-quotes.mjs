#!/usr/bin/env node
// Scrape quote table from Yahoo Finance v7 + saveticker.com.
// Output: data/price-quotes.json (merged) + reports/raw/YYYY-MM-DD-quotes.json (audit trail).

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore } from './lib/io.mjs';

const TIMEOUT_MS = 6000;
const CONCURRENCY = 6;
const UA = 'Mozilla/5.0 (compatible; TraidingDashboardBot/1.0; +https://github.com/proto123-hub/Traiding-Dashboard)';

async function fetchYahooBatch(symbols, signal) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`yahoo:http_${res.status}`);
    const j = await res.json();
    const rows = j?.quoteResponse?.result || [];
    const out = {};
    for (const r of rows) {
        out[r.symbol] = {
            price: r.regularMarketPrice ?? null,
            change: r.regularMarketChange ?? null,
            changePct: r.regularMarketChangePercent ?? null,
            prevClose: r.regularMarketPreviousClose ?? null,
            asOfTs: r.regularMarketTime ?? null
        };
    }
    return out;
}

async function fetchSavetickerOne(symbol, signal) {
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
    const q = data?.props?.pageProps?.quote || data?.props?.pageProps?.ticker || {};
    const price = q.price ?? q.regularMarketPrice ?? q.last ?? null;
    const prev = q.previousClose ?? q.regularMarketPreviousClose ?? null;
    if (price == null) throw new Error('saveticker:no_price');
    const change = (prev != null) ? +(price - prev).toFixed(4) : null;
    const changePct = (prev != null && prev !== 0) ? +(((price - prev) / prev) * 100).toFixed(4) : null;
    return { price, change, changePct, prevClose: prev };
}

function mapYahooSymbol(sym) {
    if (sym === 'SPX') return '^GSPC';
    if (sym === 'NDX') return '^NDX';
    if (sym === 'VIX') return '^VIX';
    if (sym === 'DXY') return 'DX-Y.NYB';
    if (sym === 'US10Y') return '^TNX';
    if (sym === 'USDKRW') return 'KRW=X';
    return sym;
}
function unmapYahooSymbol(yahooSym, original) { return original; }

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = [
        ...(universe.tickers || []).map(t => t.symbol),
        ...(universe.indices || []).map(t => t.symbol)
    ];
    if (!tickers.length) { console.error('no tickers'); process.exit(1); }

    const yahooSymbols = tickers.map(mapYahooSymbol);
    let yahooMap = {};
    const failures = [];

    try {
        yahooMap = await withTimeout(s => fetchYahooBatch(yahooSymbols, s), TIMEOUT_MS, 'yahoo-batch');
    } catch (e) {
        for (const sym of tickers) failures.push({ symbol: sym, source: 'yahoo', reason: e.message });
    }

    const sem = new Semaphore(CONCURRENCY);
    const savetickerMap = {};
    await Promise.all(tickers.map(sym => sem.run(async () => {
        try {
            const q = await withTimeout(s => fetchSavetickerOne(sym, s), TIMEOUT_MS, `saveticker:${sym}`);
            savetickerMap[sym] = q;
        } catch (e) {
            failures.push({ symbol: sym, source: 'saveticker', reason: e.message });
        }
    })));

    const quotes = {};
    const tolerance = 0.002;
    const ts = nowIso();
    for (const sym of tickers) {
        const ySym = mapYahooSymbol(sym);
        const y = yahooMap[ySym];
        const s = savetickerMap[sym];
        const perSource = {};
        if (y?.price != null) perSource.yahoo = y.price;
        if (s?.price != null) perSource.saveticker = s.price;

        const primary = y || s;
        if (!primary?.price) continue;

        let verified = false;
        if (y?.price != null && s?.price != null) {
            const diff = Math.abs(y.price - s.price) / Math.max(y.price, 1e-6);
            verified = diff <= tolerance;
        }

        quotes[sym] = {
            price: primary.price,
            change: primary.change,
            changePct: primary.changePct,
            prevClose: primary.prevClose,
            verified,
            sourceCount: Object.keys(perSource).length,
            perSource,
            lastUpdated: ts
        };
    }

    let prior = { quotes: {} };
    try { prior = await readJson('data/price-quotes.json'); } catch { /* first run */ }

    const okCount = Object.keys(quotes).length;
    const priorCount = Object.keys(prior.quotes || {}).length;

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate: todayUtc(),
        perSourceRaw: { yahoo: yahooMap, saveticker: savetickerMap },
        failures
    };
    await writeJsonAtomic(`reports/raw/${todayUtc()}-quotes.json`, rawDrop);

    if (okCount === 0 && priorCount > 0) {
        console.error(`scrape-quotes: ALL sources failed (0/${tickers.length}, ${failures.length} failures) — NOT overwriting prior price-quotes.json with ${priorCount} entries. Raw drop saved for audit.`);
        process.exit(2);
    }

    const merged = { ...(prior.quotes || {}) };
    for (const [sym, row] of Object.entries(quotes)) {
        const existing = merged[sym] || {};
        const existingKapture = existing.perSource?.kapture;
        merged[sym] = {
            ...row,
            perSource: existingKapture != null
                ? { ...row.perSource, kapture: existingKapture }
                : row.perSource
        };
    }

    const out = {
        note: prior.note || 'Owned by refresher agent + GitHub Actions data-refresh workflow.',
        updated: ts,
        asOfDate: todayUtc(),
        agent: 'refresher',
        sources: ['yahoo', 'saveticker'],
        tolerance,
        quotes: merged,
        failures
    };
    await writeJsonAtomic('data/price-quotes.json', out);

    const verifiedCount = Object.values(quotes).filter(q => q.verified).length;
    console.log(`scrape-quotes: ${okCount}/${tickers.length} symbols, ${verifiedCount} verified, ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
