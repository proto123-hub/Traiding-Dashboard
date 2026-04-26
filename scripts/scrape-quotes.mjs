#!/usr/bin/env node
// Scrape quote table from Stooq.com (CSV, no-auth) + Yahoo Finance v8 chart
// (no-auth chart endpoint, fallback). Output: data/price-quotes.json (merged)
// + reports/raw/YYYY-MM-DD-quotes.json (audit trail).
//
// Why these sources: Yahoo v7 quote API now returns 401 without crumb auth,
// and saveticker.com serves 403 to non-browser UAs (Cloudflare). Stooq has a
// stable, key-less CSV endpoint for US equities, indices, and FX. Yahoo v8
// chart endpoint still serves quotes without auth and is used as the
// independent secondary source for the comparator.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore } from './lib/io.mjs';

const TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
// Match a real Chrome UA to reduce bot-detection 403s on either source.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Stooq symbol map. US equities are <ticker>.us (lowercased). Indices use ^.
function stooqSymbol(sym) {
    const map = {
        SPX: '^spx', NDX: '^ndx', VIX: '^vix', DXY: '^dxy',
        US10Y: '10usy.b',
        USDKRW: 'usdkrw',
        SPY: 'spy.us', QQQ: 'qqq.us'
    };
    if (map[sym]) return map[sym];
    return `${sym.toLowerCase()}.us`;
}

async function fetchStooqOne(sym, signal) {
    const ssym = stooqSymbol(sym);
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(ssym)}&f=sd2t2ohlcvn&h&e=csv`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/csv,text/plain' }
    });
    if (!res.ok) throw new Error(`stooq:http_${res.status}`);
    const text = (await res.text()).trim();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) throw new Error('stooq:no_data');
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const cols = lines[1].split(',').map(s => s.trim());
    const idx = (k) => header.indexOf(k);
    const close = parseFloat(cols[idx('close')]);
    const open = parseFloat(cols[idx('open')]);
    if (!Number.isFinite(close)) throw new Error('stooq:no_close');
    // Stooq daily CSV does not return prevClose directly; open is current
    // session open, not yesterday close. Mark prevClose as null so verify
    // step does not falsely compare derived numbers.
    return { price: close, change: null, changePct: null, prevClose: null, open: Number.isFinite(open) ? open : null };
}

// Yahoo v8 chart endpoint — returns meta with regularMarketPrice + previousClose.
// Public endpoint, generally accessible without crumb auth.
function yahooSymbol(sym) {
    if (sym === 'SPX') return '^GSPC';
    if (sym === 'NDX') return '^NDX';
    if (sym === 'VIX') return '^VIX';
    if (sym === 'DXY') return 'DX-Y.NYB';
    if (sym === 'US10Y') return '^TNX';
    if (sym === 'USDKRW') return 'KRW=X';
    return sym;
}

async function fetchYahooChartOne(sym, signal) {
    const ysym = yahooSymbol(sym);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=2d`;
    const res = await fetch(url, {
        signal,
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com/'
        }
    });
    if (!res.ok) throw new Error(`yahoo:http_${res.status}`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('yahoo:no_meta');
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose;
    if (!Number.isFinite(price)) throw new Error('yahoo:no_price');
    const change = Number.isFinite(prev) ? +(price - prev).toFixed(4) : null;
    const changePct = (Number.isFinite(prev) && prev !== 0) ? +(((price - prev) / prev) * 100).toFixed(4) : null;
    return { price, change, changePct, prevClose: Number.isFinite(prev) ? prev : null, asOfTs: meta.regularMarketTime ?? null };
}

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = [
        ...(universe.tickers || []).map(t => t.symbol),
        ...(universe.indices || []).map(t => t.symbol)
    ];
    if (!tickers.length) { console.error('no tickers'); process.exit(1); }

    const sem = new Semaphore(CONCURRENCY);
    const stooqMap = {};
    const yahooMap = {};
    const failures = [];

    await Promise.all(tickers.map(sym => sem.run(async () => {
        const tasks = [
            withTimeout(s => fetchStooqOne(sym, s), TIMEOUT_MS, `stooq:${sym}`)
                .then(q => { stooqMap[sym] = q; })
                .catch(e => { failures.push({ symbol: sym, source: 'stooq', reason: e.message }); }),
            withTimeout(s => fetchYahooChartOne(sym, s), TIMEOUT_MS, `yahoo:${sym}`)
                .then(q => { yahooMap[sym] = q; })
                .catch(e => { failures.push({ symbol: sym, source: 'yahoo', reason: e.message }); })
        ];
        await Promise.all(tasks);
    })));

    const quotes = {};
    const tolerance = 0.002;
    const ts = nowIso();
    for (const sym of tickers) {
        const s = stooqMap[sym];
        const y = yahooMap[sym];
        const perSource = {};
        if (s?.price != null) perSource.stooq = s.price;
        if (y?.price != null) perSource.yahoo = y.price;

        // Yahoo is preferred when present (it carries prevClose / change).
        // Stooq is fallback. Pick the source that gives us the richest row.
        const primary = (y && y.price != null) ? y : s;
        if (!primary?.price) continue;

        let verified = false;
        if (s?.price != null && y?.price != null) {
            const diff = Math.abs(s.price - y.price) / Math.max(y.price, 1e-6);
            verified = diff <= tolerance;
        }

        quotes[sym] = {
            price: primary.price,
            change: primary.change ?? 0,
            changePct: primary.changePct ?? 0,
            prevClose: primary.prevClose ?? primary.price,
            verified,
            sourceCount: Object.keys(perSource).length,
            perSource,
            lastUpdated: ts
        };
    }

    let prior = { quotes: {} };
    try { prior = await readJson('data/price-quotes.json'); } catch { /* first run */ }

    const okCount = Object.keys(quotes).length;
    const priorCount = Object.values(prior.quotes || {}).filter(q => q.price != null).length;

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate: todayUtc(),
        perSourceRaw: { stooq: stooqMap, yahoo: yahooMap },
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
        note: prior.note || 'Owned by refresher agent + GitHub Actions data-refresh workflow. Sources: Stooq.com (CSV, no-auth) + Yahoo Finance v8 chart (no-auth). Kapture (TradingView) imports merge into perSource.kapture.',
        updated: ts,
        asOfDate: todayUtc(),
        agent: 'refresher',
        sources: ['stooq', 'yahoo'],
        tolerance,
        quotes: merged,
        failures
    };
    await writeJsonAtomic('data/price-quotes.json', out);

    const verifiedCount = Object.values(quotes).filter(q => q.verified).length;
    console.log(`scrape-quotes: ${okCount}/${tickers.length} symbols, ${verifiedCount} verified, ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
