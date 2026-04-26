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

// Symbols Stooq's free CSV does not cover cleanly (returns N/D for close).
// Yahoo handles these via v8 chart with the mapped Yahoo symbols.
const STOOQ_SKIP = new Set(['VIX', 'DXY', 'US10Y']);

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
async function fetchStooqHistory(sym, signal) {
    const ssym = stooqSymbol(sym);
    const today = new Date();
    const past = new Date(today.getTime() - 14 * 86400000);
    const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

    const urls = [
        `https://stooq.com/q/d/l/?s=${encodeURIComponent(ssym)}&d1=${ymd(past)}&d2=${ymd(today)}&i=d`,
        `https://stooq.com/q/d/l/?i=d&s=${encodeURIComponent(ssym)}`,
        `https://stooq.com/q/d/?s=${encodeURIComponent(ssym)}&i=d&e=csv`
    ];

    let lastErr = 'no_attempt';
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                signal,
                headers: {
                    'User-Agent': UA,
                    'Accept': 'text/csv,text/plain,*/*;q=0.5',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://stooq.com/'
                }
            });
            if (!res.ok) { lastErr = `http_${res.status}`; continue; }
            const text = (await res.text()).trim();
            // If the body is HTML (challenge page), skip
            if (/^\s*<(!doctype|html)/i.test(text)) { lastErr = 'html_body'; continue; }
            const lines = text.split(/\r?\n/).filter(Boolean);
            if (lines.length < 3) { lastErr = `lt_3_lines(${lines.length})`; continue; }
            const header = lines[0].split(',').map(s => s.trim().toLowerCase());
            const closeIdx = header.indexOf('close');
            if (closeIdx < 0) { lastErr = 'no_close_col'; continue; }
            const rows = lines.slice(1)
                .map(l => l.split(',').map(c => c.trim()))
                .filter(r => Number.isFinite(parseFloat(r[closeIdx])));
            if (rows.length < 2) { lastErr = `lt_2_rows(${rows.length})`; continue; }
            return {
                latestClose: parseFloat(rows[rows.length - 1][closeIdx]),
                prevClose: parseFloat(rows[rows.length - 2][closeIdx])
            };
        } catch (e) {
            lastErr = e.message || 'fetch_err';
        }
    }
    throw new Error(`stooq-hist:${lastErr}`);
}

async function fetchStooqOne(sym, signal, histFailures) {
    const close = await fetchStooqQuote(sym, signal);
    let prevClose = null;
    try {
        const h = await fetchStooqHistory(sym, signal);
        prevClose = h.prevClose;
    } catch (e) {
        // Don't fail the symbol — record diagnostic for ops visibility.
        histFailures.push({ symbol: sym, reason: e.message });
    }
    const change = (prevClose != null) ? +(close - prevClose).toFixed(4) : null;
    const changePct = (prevClose != null && prevClose !== 0)
        ? +(((close - prevClose) / prevClose) * 100).toFixed(4) : null;
    return { price: close, change, changePct, prevClose };
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
    const stooqMap = {};
    const yahooMap = {};
    const failures = [];
    const histFailures = []; // diagnostic — does not block the symbol

    // Stooq fan-out (excluding macros it cannot serve)
    await Promise.all(tickers.filter(s => !STOOQ_SKIP.has(s)).map(sym => stooqSem.run(async () => {
        try {
            stooqMap[sym] = await withTimeout(s => fetchStooqOne(sym, s, histFailures), TIMEOUT_MS * 2, `stooq:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'stooq', reason: e.message });
        }
    })));
    if (histFailures.length) {
        const reasons = {};
        for (const f of histFailures) reasons[f.reason] = (reasons[f.reason] || 0) + 1;
        console.log(`stooq-hist diagnostic: ${histFailures.length} symbols missing prevClose · ${JSON.stringify(reasons)}`);
    }

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
        const perSource = {};
        if (s?.price != null) perSource.stooq = s.price;
        if (y?.price != null) perSource.yahoo = y.price;

        // Stooq daily history now returns prevClose directly. Yahoo is kept as
        // best-effort secondary; when both have prevClose, prefer Stooq's
        // (which we just computed from the same dataset that yielded `price`).
        const primary = (s && s.price != null) ? s : y;
        if (!primary?.price) continue;

        // prevClose chain: primary's own > the other source's > prior file > today (last resort).
        const otherPrev = (primary === s) ? y?.prevClose : s?.prevClose;
        const priorPrice = prior?.quotes?.[sym]?.price;
        const carriedPrev = (primary.prevClose != null) ? primary.prevClose
                          : (otherPrev != null) ? otherPrev
                          : (priorPrice != null && priorPrice !== primary.price) ? priorPrice
                          : primary.price;

        const change = +(primary.price - carriedPrev).toFixed(4);
        const changePct = (carriedPrev !== 0)
            ? +(((primary.price - carriedPrev) / carriedPrev) * 100).toFixed(4)
            : 0;

        let verified = false;
        if (s?.price != null && y?.price != null) {
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
