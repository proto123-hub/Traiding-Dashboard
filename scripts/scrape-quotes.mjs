#!/usr/bin/env node
// Scrape quote table from NASDAQ public API (primary) + Cboe delayed-quotes
// CDN (secondary) + Stooq.com (best-effort, batched) + Yahoo v7 spark / v8
// chart (best-effort) + CNBC restQuote (indices-only gap filler, probe-
// gated). Output: data/price-quotes.json (merged) + reports/raw/YYYY-MM-DD-
// quotes.json (audit trail).
//
// Why this roster (2026-08-18 fix — see reports/designs/2026-08-18-scraper-fix.md):
// - Stooq's per-symbol q/l/ endpoint has 404'd on every attempted symbol on
//   every run since at least 2026-08-05 — a stable, structural failure (not
//   symbol-mapping: even ^spx and long-covered tickers 404), most likely bot-
//   scoring or an IP block of GitHub-runner (Azure) egress ranges on that
//   path. Fix D replaces the 24-request fan-out with ONE batched multi-symbol
//   request (+ a stooq.pl mirror retry) and keeps Stooq best-effort. If the
//   batched request also dies, delete the rescue attempt and update this
//   comment + data/README.md (see the design's fallback plan §4.5).
// - Yahoo v8 chart 429s ~27/27 requests even at concurrency 2 + 400ms gaps —
//   that signature is IP-reputation rate limiting of shared runner egress
//   IPs plus cookie gating, not request pacing, so pacing alone cannot fix
//   it. Fix C attacks both: a one-time fc.yahoo.com cookie warm-up, and a
//   batched v7 spark request (27 symbols -> 2 chunks of <=14) instead of 27
//   individual v8 calls. Falls back to the old per-symbol v8 chart fetch
//   (still carrying the warm-up cookie) only if spark itself comes back
//   gated (401/404), bounded by a hard 3-minute phase budget so the
//   workflow's 8-minute job timeout is never threatened.
// - NASDAQ is untouched — it is the only source that has been consistently
//   healthy for a month — and is promoted to first in the primary-price
//   chain (NASDAQ > Cboe > Stooq > Yahoo).
// - Cboe's delayed-quotes CDN (Fix A) is the new primary rescue: a public,
//   key-less CloudFront endpoint covering equities + SPX/NDX/VIX (and a
//   probed `_TNX` for US10Y). Pairing it with NASDAQ restores 2-source
//   verification for the whole equity universe regardless of whether
//   stooq/yahoo ever recover. Both cron slots (11:00 UTC pre-market, 21:00
//   UTC = close+1h) run outside RTH, so Cboe's 15-minute delay is immaterial
//   — it settles to the same close NASDAQ reports. A future intraday
//   workflow_dispatch during RTH could see Cboe-vs-NASDAQ drift >0.2% on
//   fast movers — acceptable, would just show as sporadic unverified.
// - CNBC restQuote (Fix E) is an indices-only, unofficial partner endpoint —
//   the only candidate source for DXY without Yahoo. Shipped key-less and
//   probe-gated: watch the first CI run for reachability/shape, and for a
//   possible yield-unit mismatch on US10Y (Yahoo ^TNX / Cboe _TNX / CNBC
//   US10Y have a known history of disagreeing by 10x — yield vs yield*10
//   across vendors). The pairwise 0.2% verify check below makes a unit
//   mismatch fail-safe (US10Y just stays verified=false), not corrupting.
//
// Fix B — verified = true iff ANY PAIR of distinct sources agrees within
// tolerance, not "all sources in range". One stale/outlier leg no longer
// un-verifies a symbol that two good sources already agree on.
//
// Rate parameters: Cboe conc 4, 8s timeout, 1 retry (2s) on 5xx/network only
// (no retry on 404 = symbol not covered). Stooq: 1 batched request + 1
// mirror-host retry (3s) on 404/403. Yahoo: v7 spark in chunks of <=14, 1s
// gap between chunks, up to 4 retries per chunk (2/5/10/20s +-20% jitter,
// alternating query1/query2 hosts); v8-chart fallback at concurrency 1,
// 1500ms gap, 1 retry per symbol, 3-minute hard phase budget. NASDAQ:
// unchanged (concurrency 3, 3-assetclass fallback, 16s timeout). CNBC: 1
// batched request, 8s timeout, 1 retry.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore } from './lib/io.mjs';

const TIMEOUT_MS = 8000;
const CBOE_CONCURRENCY = 4;
const YAHOO_SPARK_CHUNK = 14;                                // 27 symbols -> 2 chunks
const YAHOO_SPARK_GAP_MS = 1000;                              // gap between sequential spark chunks
const YAHOO_SPARK_BACKOFF_MS = [2000, 5000, 10000, 20000];    // 429/5xx backoff, +-20% jitter
const YAHOO_FALLBACK_GAP_MS = 1500;                           // v8-chart fallback: gap per symbol at conc 1
const YAHOO_PHASE_BUDGET_MS = 3 * 60 * 1000;                  // hard deadline for the v8-chart fallback phase
// Match a real Chrome UA to reduce bot-detection 403s across sources.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Empirically uncovered by Stooq's free quote endpoint (returns N/D for close).
const STOOQ_SKIP = new Set(['VIX', 'DXY', 'US10Y']);

// NASDAQ public API coverage gaps (run #10 confirmed):
// - SPX, VIX (Cboe-listed, not NASDAQ-native — assetclass=index returns no_primaryData)
// - US10Y (Treasury yield)
// - USDKRW (FX pair)
// - DXY (ICE-listed dollar index)
const NASDAQ_SKIP = new Set(['SPX', 'VIX', 'DXY', 'US10Y', 'USDKRW']);

// ICE-listed dollar index — not on Cboe's consolidated tape.
const CBOE_SKIP = new Set(['DXY']);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fix B: verified iff ANY PAIR of distinct sources agrees within tolerance —
// replaces the old min/max "all sources in range" check, which let one
// stale/outlier source un-verify a symbol two good sources already agreed
// on. Returns the tightest pairwise delta too, for reporting.
function pairwiseVerify(perSource, tolerance) {
    const vals = Object.values(perSource).filter(v => v != null);
    let minDelta = Infinity;
    for (let i = 0; i < vals.length; i++) {
        for (let j = i + 1; j < vals.length; j++) {
            const d = Math.abs(vals[i] - vals[j]) / Math.max(Math.min(vals[i], vals[j]), 1e-6);
            if (d < minDelta) minDelta = d;
        }
    }
    return { verified: minDelta <= tolerance, minDelta };
}

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

// Fix D: one batched multi-symbol request instead of a 24-request fan-out.
// The q/l/ endpoint accepts a `+`-joined symbol list and returns one CSV row
// per symbol; the join must stay unencoded (symbols are [a-z0-9.^] only —
// encodeURIComponent would mangle the literal `+` separators). "N/D" close
// values are per-symbol misses, not a request failure. History/prevClose is
// still not attempted — Stooq's daily history endpoint (q/d/l/) has been
// captcha-gated for a while (its response literally instructs "Get your
// apikey:"); NASDAQ already supplies a clean prevClose.
async function fetchStooqBatch(symbols, host, signal) {
    const url = `https://${host}/q/l/?s=${symbols.join('+')}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
        signal,
        headers: {
            'User-Agent': UA,
            'Accept': 'text/csv,text/plain',
            'Referer': 'https://stooq.com/',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    if (!res.ok) throw new Error(`stooq-batch:http_${res.status}`);
    const text = (await res.text()).trim();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('stooq-batch:no_data');
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const symIdx = header.indexOf('symbol');
    const closeIdx = header.indexOf('close');
    const rows = {};
    for (const line of lines.slice(1)) {
        const cols = line.split(',').map(s => s.trim());
        const rowSym = (cols[symIdx] || '').toLowerCase();
        if (!rowSym) continue;
        const closeRaw = cols[closeIdx];
        if (!closeRaw || closeRaw === 'N/D') { rows[rowSym] = null; continue; }
        const close = parseFloat(closeRaw);
        rows[rowSym] = Number.isFinite(close) ? close : null;
    }
    return rows;
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

// Cboe delayed-quotes CDN (Fix A) — public, key-less CloudFront endpoint.
// Indices are underscore-prefixed; equities are plain uppercase.
function cboeSymbol(sym) {
    if (sym === 'SPX') return '_SPX';
    if (sym === 'NDX') return '_NDX';
    if (sym === 'VIX') return '_VIX';
    if (sym === 'US10Y') return '_TNX'; // probed — see header comment re: unit mismatch risk
    return sym.toUpperCase();
}

async function fetchCboeQuoteOnce(sym, signal) {
    const csym = cboeSymbol(sym);
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(csym)}.json`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.cboe.com/' }
    });
    if (!res.ok) throw new Error(`cboe:http_${res.status}`);
    const j = await res.json();
    const d = j?.data;
    if (!d || d.current_price == null) throw new Error('cboe:no_data');
    const price = d.current_price;
    const prevClose = (d.prev_day_close != null) ? d.prev_day_close : null;
    const change = (d.price_change != null) ? d.price_change
        : (prevClose != null ? +(price - prevClose).toFixed(4) : null);
    const changePct = (d.price_change_percent != null) ? d.price_change_percent : null;
    return { price, change, changePct, prevClose };
}

// 1 retry after 2s, but only on 5xx/network error — a 404 means the symbol
// just isn't covered and retrying won't change that.
async function fetchCboeOne(sym, signal) {
    try {
        return await fetchCboeQuoteOnce(sym, signal);
    } catch (e) {
        const m = /http_(\d+)/.exec(e.message);
        const status = m ? Number(m[1]) : null;
        const retryable = status == null || status >= 500;
        if (!retryable) throw e;
        await sleep(2000);
        return await fetchCboeQuoteOnce(sym, signal);
    }
}

// Yahoo v7 spark / v8 chart endpoints — the v8 chart's `meta` object
// (regularMarketPrice/previousClose/chartPreviousClose/regularMarketTime) is
// also what each v7 spark result carries at response[0].meta, so one mapper
// serves both.
function yahooSymbol(sym) {
    if (sym === 'SPX') return '^GSPC';
    if (sym === 'NDX') return '^NDX';
    if (sym === 'VIX') return '^VIX';
    if (sym === 'DXY') return 'DX-Y.NYB';
    if (sym === 'US10Y') return '^TNX';
    if (sym === 'USDKRW') return 'KRW=X';
    return sym;
}

function yahooMetaToQuote(meta) {
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose;
    if (!Number.isFinite(price)) return null;
    const change = Number.isFinite(prev) ? +(price - prev).toFixed(4) : null;
    const changePct = (Number.isFinite(prev) && prev !== 0) ? +(((price - prev) / prev) * 100).toFixed(4) : null;
    return { price, change, changePct, prevClose: Number.isFinite(prev) ? prev : null, asOfTs: meta.regularMarketTime ?? null };
}

function jitterMs(base) {
    const spread = base * 0.2;
    return Math.round(base + (Math.random() * 2 - 1) * spread);
}

// One-time cookie warm-up so batched Yahoo requests carry a session cookie
// instead of looking like anonymous datacenter traffic. The endpoint 404s by
// design — we only want its Set-Cookie header(s).
async function yahooWarmupCookie() {
    try {
        const res = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
        const cookies = res.headers.getSetCookie?.() ?? [];
        if (!cookies.length) return '';
        return cookies.map(c => c.split(';')[0]).join('; ');
    } catch {
        return '';
    }
}

// Batched v7 spark fetch for one chunk of symbols. Retries up to 4 times on
// 429/5xx/network error with 2/5/10/20s backoff (+-20% jitter), alternating
// query1/query2 hosts per attempt. A 401/404 means the endpoint itself is
// gated — bail out immediately so the caller can fall back to v8 chart.
async function fetchYahooSparkChunk(symbols, cookie, signal) {
    const buildUrl = (host) => `https://${host}.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=2d&interval=1d`;
    let lastErr;
    for (let attempt = 0; attempt < YAHOO_SPARK_BACKOFF_MS.length + 1; attempt++) {
        const host = (attempt % 2 === 0) ? 'query1' : 'query2';
        let res;
        try {
            res = await fetch(buildUrl(host), {
                signal,
                headers: {
                    'User-Agent': UA,
                    'Accept': 'application/json',
                    'Referer': 'https://finance.yahoo.com/',
                    ...(cookie ? { Cookie: cookie } : {})
                }
            });
        } catch (e) {
            lastErr = e;
            if (attempt === YAHOO_SPARK_BACKOFF_MS.length) throw lastErr;
            await sleep(jitterMs(YAHOO_SPARK_BACKOFF_MS[attempt]));
            continue;
        }
        if (res.status === 401 || res.status === 404) throw new Error(`yahoo-spark:gated_${res.status}`);
        if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`yahoo-spark:http_${res.status}`);
            if (attempt === YAHOO_SPARK_BACKOFF_MS.length) throw lastErr;
            await sleep(jitterMs(YAHOO_SPARK_BACKOFF_MS[attempt]));
            continue;
        }
        if (!res.ok) throw new Error(`yahoo-spark:http_${res.status}`);
        const j = await res.json();
        return j?.spark?.result || [];
    }
    throw lastErr;
}

// Fallback path (only reached if spark itself is gated): the old per-symbol
// v8 chart fetch, now carrying the warm-up cookie, with 1 retry.
async function fetchYahooChartOne(sym, cookie, signal) {
    const ysym = yahooSymbol(sym);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=2d`;
    const res = await fetch(url, {
        signal,
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com/',
            ...(cookie ? { Cookie: cookie } : {})
        }
    });
    if (!res.ok) throw new Error(`yahoo:http_${res.status}`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('yahoo:no_meta');
    const q = yahooMetaToQuote(meta);
    if (!q) throw new Error('yahoo:no_price');
    return q;
}

async function fetchYahooChartOneWithRetry(sym, cookie, signal) {
    try {
        return await fetchYahooChartOne(sym, cookie, signal);
    } catch {
        return await fetchYahooChartOne(sym, cookie, signal);
    }
}

// CNBC restQuote (Fix E) — indices-only gap filler, unofficial partner
// endpoint (no key, no SLA). One batched request covers SPX/NDX/VIX/DXY/US10Y.
const CNBC_SYMBOL_MAP = { SPX: '.SPX', NDX: '.NDX', VIX: '.VIX', DXY: '.DXY', US10Y: 'US10Y' };

// Comma/currency-formatted numeric strings — same cleanup NASDAQ's parseNum
// applies (duplicated here rather than sharing a closure, to leave
// fetchNasdaqOne untouched per the design's "what not to change" list).
function parseCnbcNum(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[$,%+]/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

async function fetchCnbcIndicesOnce(symbols, signal) {
    const joined = symbols.map(s => CNBC_SYMBOL_MAP[s]).join('|');
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(joined)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.cnbc.com/' }
    });
    if (!res.ok) throw new Error(`cnbc:http_${res.status}`);
    const j = await res.json();
    const raw = j?.FormattedQuoteResult?.FormattedQuote;
    const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const revMap = Object.fromEntries(Object.entries(CNBC_SYMBOL_MAP).map(([k, v]) => [v, k]));
    const out = {};
    for (const row of rows) {
        const sym = revMap[row.symbol];
        if (!sym) continue;
        const price = parseCnbcNum(row.last);
        if (price == null) continue;
        out[sym] = {
            price,
            change: parseCnbcNum(row.change),
            changePct: parseCnbcNum(row.change_pct),
            prevClose: parseCnbcNum(row.previous_day_closing)
        };
    }
    return out;
}

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = [
        ...(universe.tickers || []).map(t => t.symbol),
        ...(universe.indices || []).map(t => t.symbol)
    ];
    if (!tickers.length) { console.error('no tickers'); process.exit(1); }

    const cboeSem = new Semaphore(CBOE_CONCURRENCY);
    const nasdaqSem = new Semaphore(3);
    const cboeMap = {};
    const nasdaqMap = {};
    const stooqMap = {};
    const yahooMap = {};
    const cnbcMap = {};
    const failures = [];

    // Cboe fan-out (Fix A) — new independent source, restores 2-source
    // verification for equities + SPX/NDX/VIX regardless of stooq/yahoo.
    await Promise.all(tickers.filter(s => !CBOE_SKIP.has(s)).map(sym => cboeSem.run(async () => {
        try {
            cboeMap[sym] = await withTimeout(s => fetchCboeOne(sym, s), TIMEOUT_MS, `cboe:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'cboe', reason: e.message });
        }
    })));

    // NASDAQ fan-out — primary prevClose + change source (3 assetclass fallbacks per symbol). Untouched.
    await Promise.all(tickers.filter(s => !NASDAQ_SKIP.has(s)).map(sym => nasdaqSem.run(async () => {
        try {
            nasdaqMap[sym] = await withTimeout(s => fetchNasdaqOne(sym, s), TIMEOUT_MS * 2, `nasdaq:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'nasdaq', reason: e.message });
        }
    })));

    // Stooq (Fix D) — one batched request instead of a 24-request fan-out,
    // with a stooq.pl mirror retry on 404/403. Best-effort: log one failure
    // row and move on if both hosts fail.
    const stooqTickers = tickers.filter(s => !STOOQ_SKIP.has(s));
    const stooqSymbols = stooqTickers.map(sym => stooqSymbol(sym));
    let stooqRows = null;
    let stooqErr = null;
    try {
        stooqRows = await withTimeout(s => fetchStooqBatch(stooqSymbols, 'stooq.com', s), TIMEOUT_MS, 'stooq:batch');
    } catch (e) {
        stooqErr = e;
        const m = /http_(\d+)/.exec(e.message);
        const status = m ? Number(m[1]) : null;
        if (status === 404 || status === 403) {
            await sleep(3000);
            try {
                stooqRows = await withTimeout(s => fetchStooqBatch(stooqSymbols, 'stooq.pl', s), TIMEOUT_MS, 'stooq:batch-mirror');
            } catch (e2) {
                stooqErr = e2;
            }
        }
    }
    if (stooqRows) {
        for (const sym of stooqTickers) {
            const close = stooqRows[stooqSymbol(sym).toLowerCase()];
            if (close != null) stooqMap[sym] = { price: close, change: null, changePct: null, prevClose: null };
            else failures.push({ symbol: sym, source: 'stooq', reason: 'stooq:no_close' });
        }
    } else {
        failures.push({ symbol: 'ALL', source: 'stooq', reason: stooqErr?.message || 'stooq:batch_failed' });
    }

    // Yahoo (Fix C) — cookie warm-up, then batched v7 spark in <=14-symbol
    // chunks; falls back to per-symbol v8 chart only if spark is gated.
    const yahooCookie = await yahooWarmupCookie();
    const yahooSyms = tickers.map(sym => ({ sym, ysym: yahooSymbol(sym) }));
    let yahooSparkGated = false;
    for (let i = 0; i < yahooSyms.length; i += YAHOO_SPARK_CHUNK) {
        const chunk = yahooSyms.slice(i, i + YAHOO_SPARK_CHUNK);
        try {
            const results = await withTimeout(
                s => fetchYahooSparkChunk(chunk.map(c => c.ysym), yahooCookie, s),
                45000,
                'yahoo-spark'
            );
            const bySym = new Map(results.map(r => [r.symbol, r]));
            for (const { sym, ysym } of chunk) {
                const meta = bySym.get(ysym)?.response?.[0]?.meta;
                const q = meta ? yahooMetaToQuote(meta) : null;
                if (q) yahooMap[sym] = q;
                else failures.push({ symbol: sym, source: 'yahoo', reason: 'yahoo-spark:no_price' });
            }
        } catch (e) {
            if (/gated_/.test(e.message)) { yahooSparkGated = true; break; }
            for (const { sym } of chunk) failures.push({ symbol: sym, source: 'yahoo', reason: e.message });
        }
        if (i + YAHOO_SPARK_CHUNK < yahooSyms.length) await sleep(YAHOO_SPARK_GAP_MS);
    }

    if (yahooSparkGated) {
        const yahooFallbackSem = new Semaphore(1);
        const phaseDeadline = Date.now() + YAHOO_PHASE_BUDGET_MS;
        await Promise.all(tickers.map(sym => yahooFallbackSem.run(async () => {
            if (Date.now() > phaseDeadline) return; // budget exhausted — leave as best-effort miss
            try {
                yahooMap[sym] = await withTimeout(s => fetchYahooChartOneWithRetry(sym, yahooCookie, s), TIMEOUT_MS, `yahoo:${sym}`);
            } catch (e) {
                failures.push({ symbol: sym, source: 'yahoo', reason: e.message });
            }
            await sleep(YAHOO_FALLBACK_GAP_MS);
        })));
    }

    // CNBC (Fix E) — indices-only gap filler, probe-gated. 1 batched request, 1 retry.
    const cnbcSymbols = (universe.indices || []).map(t => t.symbol).filter(s => CNBC_SYMBOL_MAP[s]);
    if (cnbcSymbols.length) {
        try {
            Object.assign(cnbcMap, await withTimeout(s => fetchCnbcIndicesOnce(cnbcSymbols, s), TIMEOUT_MS, 'cnbc:batch'));
        } catch (e1) {
            try {
                Object.assign(cnbcMap, await withTimeout(s => fetchCnbcIndicesOnce(cnbcSymbols, s), TIMEOUT_MS, 'cnbc:batch-retry'));
            } catch (e2) {
                failures.push({ symbol: 'INDICES', source: 'cnbc', reason: e2.message });
            }
        }
    }

    const quotes = {};
    const tolerance = 0.002;
    const ts = nowIso();

    // For prevClose carry-forward: use the prior file's stored price when no
    // source in this run supplies one.
    let prior = { quotes: {} };
    try { prior = await readJson('data/price-quotes.json'); } catch { /* first run */ }

    for (const sym of tickers) {
        const s = stooqMap[sym];
        const y = yahooMap[sym];
        const n = nasdaqMap[sym];
        const c = cboeMap[sym];
        const cn = cnbcMap[sym];
        const perSource = {};
        if (n?.price != null) perSource.nasdaq = n.price;
        if (c?.price != null) perSource.cboe = c.price;
        if (s?.price != null) perSource.stooq = s.price;
        if (y?.price != null) perSource.yahoo = y.price;
        if (cn?.price != null) perSource.cnbc = cn.price;

        // Source priority (Fix D demotion): NASDAQ (empirically reliable,
        // carries prevClose) > Cboe (new, high-availability) > Stooq
        // (best-effort since the datacenter-404 issue) > Yahoo (best-effort)
        // > CNBC (indices-only, last resort).
        const primary = (n && n.price != null) ? n
            : (c && c.price != null) ? c
            : (s && s.price != null) ? s
            : (y && y.price != null) ? y
            : cn;
        if (!primary?.price) continue;

        // prevClose chain: primary's own > NASDAQ > Cboe > Yahoo > prior file > today (last resort).
        const priorPrice = prior?.quotes?.[sym]?.price;
        const carriedPrev = (primary.prevClose != null) ? primary.prevClose
            : (n?.prevClose != null) ? n.prevClose
            : (c?.prevClose != null) ? c.prevClose
            : (y?.prevClose != null) ? y.prevClose
            : (priorPrice != null && priorPrice !== primary.price) ? priorPrice
            : primary.price;

        const change = +(primary.price - carriedPrev).toFixed(4);
        const changePct = (carriedPrev !== 0)
            ? +(((primary.price - carriedPrev) / carriedPrev) * 100).toFixed(4)
            : 0;

        const { verified } = pairwiseVerify(perSource, tolerance);

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
        perSourceRaw: { nasdaq: nasdaqMap, cboe: cboeMap, stooq: stooqMap, yahoo: yahooMap, cnbc: cnbcMap },
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
        note: prior.note || 'Owned by refresher agent + GitHub Actions data-refresh workflow. Sources: NASDAQ public API (primary, prevClose + change) + Cboe delayed-quotes CDN (secondary) + Stooq.com (best-effort, batched) + Yahoo v7 spark / v8 chart (best-effort) + CNBC restQuote (indices-only gap filler, probe-gated). Kapture (TradingView) imports merge into perSource.kapture.',
        updated: ts,
        asOfDate: todayUtc(),
        agent: 'refresher',
        sources: ['nasdaq', 'cboe', 'stooq', 'yahoo', 'cnbc'],
        tolerance,
        quotes: merged,
        failures
    };
    await writeJsonAtomic('data/price-quotes.json', out);

    const verifiedCount = Object.values(quotes).filter(q => q.verified).length;
    console.log(`scrape-quotes: ${okCount}/${tickers.length} symbols, ${verifiedCount} verified, ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
