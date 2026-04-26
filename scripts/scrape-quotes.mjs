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
const STOOQ_CONCURRENCY = 6;
const YAHOO_CONCURRENCY = 2;       // Yahoo v8 chart 429s aggressively at higher rates.
const YAHOO_GAP_MS = 400;          // Tarpit between Yahoo requests within a worker.
// Match a real Chrome UA to reduce bot-detection 403s on either source.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Stooq's free CSV does not cover these macro symbols cleanly.
const STOOQ_SKIP = new Set(['VIX', 'DXY', 'US10Y']);

// NASDAQ public API does not cover macro yields, FX, or non-NASDAQ indices.
// Equities and ETFs (including leveraged ones like TSMU) usually resolve via
// the assetclass=stocks->etf->index fallback chain.
const NASDAQ_SKIP = new Set(['VIX', 'DXY', 'US10Y', 'USDKRW', 'SPX']);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Stooq's quote endpoint (q/l/) reliably returns the latest close. We do a
// second call to the history endpoint (q/d/l/) to get the prior trading
// day's close so change/changePct are real numbers, not zeros. If history
// fails we still publish the quote — the dashboard will show change=0 for
// that symbol until the next cron run, when carry-forward kicks in.
async function fetchStooqQuote(sym, signal) {
    const ssym = stooqSymbol(sym);
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(ssym)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/csv,text/plain' } });
    if (!res.ok) throw new Error(`stooq-quote:http_${res.status}`);
    const text = (await res.text()).trim();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('stooq-quote:no_data');
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const cols = lines[1].split(',').map(s => s.trim());
    const close = parseFloat(cols[header.indexOf('close')]);
    if (!Number.isFinite(close)) throw new Error('stooq-quote:no_close');
    return close;
}

// History endpoint format is a plain Date,Open,High,Low,Close,Volume CSV.
// We try multiple URL shapes — Stooq's free download URL has historically
// varied between `q/d/l/?...` and `q/d/?...&e=csv`, and unkeyed sessions
// sometimes get HTML challenge pages instead of the CSV.
// Stooq's daily history endpoint (q/d/l/) now requires a captcha-gated
// API key (their response body literally instructs "Get your apikey:" with a
// captcha step). Since we can't automate captcha, we no longer attempt to
// pull prevClose from Stooq. NASDAQ already provides a clean prevClose via
// lastSalePrice - netChange. Stooq stays as the high-availability primary
// for "current price".
async function fetchStooqOne(sym, signal) {
    const close = await fetchStooqQuote(sym, signal);
    return { price: close, change: null, changePct: null, prevClose: null };
}

// NASDAQ public API — free, no auth, returns prevClose + change. Tries
// assetclass=stocks first; falls back to assetclass=index for SPX/NDX-style
// market indices, and assetclass=etf for ETFs that reject the stocks path.
async function fetchNasdaqOne(sym, signal) {
    const parseNum = (s) => {
        if (s == null) return null;
        const cleaned = String(s).replace(/[$,%+]/g, '').trim();
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : null;
    };
    // Map our symbols to NASDAQ's index/etf naming where it differs
    const indexAlias = { SPX: 'spx', NDX: 'ndx', VIX: 'vix' };
    const tryClasses = ['stocks', 'etf', 'index'];

    let lastErr = 'no_attempt';
    for (const cls of tryClasses) {
        const ndqSym = (cls === 'index') ? (indexAlias[sym] || sym).toLowerCase() : sym.toLowerCase();
        const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ndqSym)}/info?assetclass=${cls}`;
        try {
            const res = await fetch(url, {
                signal,
                headers: {
                    'User-Agent': UA,
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': 'https://www.nasdaq.com',
                    'Referer': 'https://www.nasdaq.com/'
                }
            });
            if (!res.ok) { lastErr = `http_${res.status}@${cls}`; continue; }
            const j = await res.json();
            const pd = j?.data?.primaryData;
            if (!pd) { lastErr = `no_primaryData@${cls}`; continue; }
            const price = parseNum(pd.lastSalePrice);
            const change = parseNum(pd.netChange);
            const changePct = parseNum(pd.percentageChange);
            if (price == null) { lastErr = `no_price@${cls}`; continue; }
            const prevClose = (change != null) ? +(price - change).toFixed(4) : null;
            return { price, change, changePct, prevClose };
        } catch (e) {
            lastErr = (e.message || 'fetch_err') + '@' + cls;
        }
    }
    throw new Error(`nasdaq:${lastErr}`);
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

    const stooqSem = new Semaphore(STOOQ_CONCURRENCY);
    const yahooSem = new Semaphore(YAHOO_CONCURRENCY);
    const nasdaqSem = new Semaphore(3);
    const stooqMap = {};
    const yahooMap = {};
    const nasdaqMap = {};
    const failures = [];

    // Stooq fan-out — current-price only (history endpoint is captcha-gated).
    await Promise.all(tickers.filter(s => !STOOQ_SKIP.has(s)).map(sym => stooqSem.run(async () => {
        try {
            stooqMap[sym] = await withTimeout(s => fetchStooqOne(sym, s), TIMEOUT_MS, `stooq:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'stooq', reason: e.message });
        }
    })));

    // NASDAQ fan-out — primary prevClose + change source (3 assetclass fallbacks per symbol).
    await Promise.all(tickers.filter(s => !NASDAQ_SKIP.has(s)).map(sym => nasdaqSem.run(async () => {
        try {
            nasdaqMap[sym] = await withTimeout(s => fetchNasdaqOne(sym, s), TIMEOUT_MS * 2, `nasdaq:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'nasdaq', reason: e.message });
        }
    })));

    // Yahoo throttled fan-out: 2 workers, ~400ms gap each. Yahoo v8 chart is
    // rate-limited per IP — too many parallel hits and every symbol comes
    // back 429.
    await Promise.all(tickers.map(sym => yahooSem.run(async () => {
        try {
            yahooMap[sym] = await withTimeout(s => fetchYahooChartOne(sym, s), TIMEOUT_MS, `yahoo:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'yahoo', reason: e.message });
        }
        await sleep(YAHOO_GAP_MS);
    })));

    const quotes = {};
    const tolerance = 0.002;
    const ts = nowIso();

    // For prevClose carry-forward: use the prior file's stored price when
    // Yahoo (the only source that returns prevClose) is unavailable.
    let prior = { quotes: {} };
    try { prior = await readJson('data/price-quotes.json'); } catch { /* first run */ }

    for (const sym of tickers) {
        const s = stooqMap[sym];
        const y = yahooMap[sym];
        const n = nasdaqMap[sym];
        const perSource = {};
        if (s?.price != null) perSource.stooq = s.price;
        if (y?.price != null) perSource.yahoo = y.price;
        if (n?.price != null) perSource.nasdaq = n.price;

        // Source priority: Stooq (high-availability) > NASDAQ (carries
        // prevClose + change reliably) > Yahoo (often rate-limited but
        // included when available).
        const primary = (s && s.price != null) ? s : (n && n.price != null) ? n : y;
        if (!primary?.price) continue;

        // prevClose chain: primary's own > NASDAQ (best signal) > Yahoo > prior file > today (last resort).
        const priorPrice = prior?.quotes?.[sym]?.price;
        const carriedPrev = (primary.prevClose != null) ? primary.prevClose
                          : (n?.prevClose != null) ? n.prevClose
                          : (y?.prevClose != null) ? y.prevClose
                          : (priorPrice != null && priorPrice !== primary.price) ? priorPrice
                          : primary.price;

        const change = +(primary.price - carriedPrev).toFixed(4);
        const changePct = (carriedPrev !== 0)
            ? +(((primary.price - carriedPrev) / carriedPrev) * 100).toFixed(4)
            : 0;

        // Cross-source verify: any 2 of 3 sources agreeing within tolerance.
        const prices = [s?.price, y?.price, n?.price].filter(p => p != null);
        let verified = false;
        if (prices.length >= 2) {
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const diff = (max - min) / Math.max(min, 1e-6);
            verified = diff <= tolerance;
        }
        // Original 2-source check (kept for backward-compat shape)
        if (!verified && s?.price != null && y?.price != null) {
            const diff = Math.abs(s.price - y.price) / Math.max(y.price, 1e-6);
            verified = diff <= tolerance;
        }

        quotes[sym] = {
            price: primary.price,
            change,
            changePct,
            prevClose: carriedPrev,
            verified,
            sourceCount: Object.keys(perSource).length,
            perSource,
            lastUpdated: ts
        };
    }
    const okCount = Object.keys(quotes).length;
    const priorCount = Object.values(prior.quotes || {}).filter(q => q.price != null).length;

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate: todayUtc(),
        perSourceRaw: { stooq: stooqMap, yahoo: yahooMap, nasdaq: nasdaqMap },
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
        note: prior.note || 'Owned by refresher agent + GitHub Actions data-refresh workflow. Sources: Stooq.com primary + NASDAQ public API (prevClose + change) + Yahoo v8 chart (best-effort). Kapture (TradingView) imports merge into perSource.kapture.',
        updated: ts,
        asOfDate: todayUtc(),
        agent: 'refresher',
        sources: ['stooq', 'nasdaq', 'yahoo'],
        tolerance,
        quotes: merged,
        failures
    };
    await writeJsonAtomic('data/price-quotes.json', out);

    const verifiedCount = Object.values(quotes).filter(q => q.verified).length;
    console.log(`scrape-quotes: ${okCount}/${tickers.length} symbols, ${verifiedCount} verified, ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
