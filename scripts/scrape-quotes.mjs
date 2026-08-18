#!/usr/bin/env node
// Scrape quote table from NASDAQ public API (primary) + Cboe delayed-quotes
// CDN (secondary) + CNBC restQuote (tertiary, full coverage). Session-aware
// since 2026-08-18: each adapter returns { regular, extended } — regular is
// the official close of the last COMPLETED session, extended is a live
// pre/after-hours (or intraday) print, tagged with sessionType. The two are
// never compared against each other for verification. See
// reports/designs/2026-08-18-session-aware-quotes.md for the full design.
//
// SOURCE HISTORY — Yahoo and Stooq were REMOVED 2026-08-18 (see
// reports/validation/2026-08-18-source-probe.md for raw evidence, captured
// from a GitHub Actions runner IP via scripts/probe-sources.mjs):
// - Yahoo v7 spark AND v8 chart both returned HTTP 429 on the FIRST request
//   of the run, from a freshly warmed fc.yahoo.com session cookie, on both
//   query1/query2 hosts — per-IP reputation blocking of GitHub-runner
//   egress ranges, not a pacing problem. Structurally dead; do not
//   re-attempt without a non-datacenter egress IP or a paid feed.
// - Stooq's q/l/ endpoint (single AND batched) returned a branded Stooq 404
//   page ("page you requested does not exist") on stooq.com AND the
//   stooq.pl mirror — a styled 404 from Stooq's own template means the path
//   itself is gone, not that we're being fingerprinted. Structurally dead.
// Roster is now NASDAQ + Cboe + CNBC — all key-less, all cover the full
// 27-symbol universe except DXY (single-source, CNBC-only — see the
// coverage table below). If a future probe finds Yahoo/Stooq alive again,
// re-add behind the same probe-then-integrate discipline; don't restore the
// old code from git history blind — it also read the wrong NASDAQ/Cboe
// fields (see the session-aware-quotes design, root-cause section).
//
// Why the previous "Fix A–E" design's C/D (rescue Yahoo/Stooq) turned out
// wrong and E (CNBC indices-only) turned out unnecessarily narrow: see
// reports/validation/2026-08-18-source-probe.md §5/§6 (dead sources) and
// §3 (CNBC covers equities cleanly, not just indices).
//
// Rate parameters: Cboe conc 4, 8s timeout, 1 retry (2s) on 5xx/network only
// (no retry on 404 = symbol not covered). NASDAQ: unchanged (concurrency 3,
// 3-assetclass fallback, 16s timeout). CNBC: ONE batched request covering
// all 27 symbols, 8s timeout, 1 retry. Expected runtime ≈2 min worst case
// (well under the 8-minute job timeout and the 5-minute design budget) —
// removing Yahoo's up-to-90s backoff phase and Stooq's mirror-retry phase
// is the main saving.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore } from './lib/io.mjs';

const TIMEOUT_MS = 8000;
const CBOE_CONCURRENCY = 4;
// Match a real Chrome UA to reduce bot-detection 403s across sources.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// NASDAQ public API coverage gaps (run #10 confirmed):
// - SPX, VIX (Cboe-listed, not NASDAQ-native — assetclass=index returns no_primaryData)
// - US10Y (Treasury yield)
// - USDKRW (FX pair)
// - DXY (ICE-listed dollar index)
const NASDAQ_SKIP = new Set(['SPX', 'VIX', 'DXY', 'US10Y', 'USDKRW']);

// ICE-listed dollar index — not on Cboe's consolidated tape.
const CBOE_SKIP = new Set(['DXY']);

// Reserved for a future FX addition — comparator.md documents a 0.1%
// tolerance for FX but tickers-universe.json has no FX symbol today.
const FX_SYMBOLS = new Set(['USDKRW']);
const TOLERANCE_BY_CLASS = { equity: 0.002, index: 0.005, fx: 0.001 };

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

// Symbol -> tolerance class, derived from tickers-universe.json's
// tickers[]/indices[] split (already loaded in main()) rather than a
// duplicated hardcoded list — see reports/designs/2026-08-18-session-aware-quotes.md §3.
function classifySymbol(sym, indexSymbolSet) {
    if (FX_SYMBOLS.has(sym)) return 'fx';
    if (indexSymbolSet.has(sym)) return 'index';
    return 'equity';
}

// Cboe delayed-quotes CDN — public, key-less CloudFront endpoint. Indices
// are underscore-prefixed; equities are plain uppercase.
function cboeSymbol(sym) {
    if (sym === 'SPX') return '_SPX';
    if (sym === 'NDX') return '_NDX';
    if (sym === 'VIX') return '_VIX';
    if (sym === 'US10Y') return '_TNX'; // degenerate yield*10 feed — see normalizeCboeYield
    return sym.toUpperCase();
}

// Cboe's _TNX reports yield x10 with zeroed OHLC (e.g. current_price:47.24 =
// 4.724%). Guarded: only divide when the raw value is implausible as a
// direct yield (realistic US10Y range is roughly 0-20%) — protects against
// silent corruption if Cboe ever changes the feed to report the yield
// directly, which an unconditional /10 would quietly halve instead of
// failing loud.
function normalizeCboeYield(raw) {
    return raw > 20 ? +(raw / 10).toFixed(4) : raw;
}

function parseIsoDatePrefix(s) {
    if (!s) return null;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : null;
}

// Cboe reads `close` (the official consolidated close), NEVER
// `current_price` (Cboe's own venue print, stamped 15:59:59 — one second
// before the closing auction). change/changePct are always self-derived
// from close vs prev_day_close — d.price_change/price_change_percent belong
// to current_price's session, not close's.
function extractCboeSession(sym, j) {
    const d = j?.data;
    if (!d || d.close == null) throw new Error('cboe:no_close');
    let price = d.close;
    // price_change belongs to the session `close` came from. d.prev_day_close is
    // NOT usable as a prior close: on a pre-market request it repeats that same
    // session's close, which would zero out every change.
    let change = d.price_change ?? null;
    if (sym === 'US10Y') {
        price = normalizeCboeYield(price);
        change = change != null ? normalizeCboeYield(change) : null;
    }
    const prevClose = change != null ? +(price - change).toFixed(4) : null;
    // Self-derive the percentage: Cboe's own price_change_percent divides by the
    // new close rather than the prior one, so it disagrees with every other source.
    const changePct = (prevClose != null && prevClose !== 0)
        ? +((change / prevClose) * 100).toFixed(4) : null;
    return {
        regular: {
            price, prevClose, change, changePct,
            // _TNX's last_trade_time is a degenerate 00:00:00 stamp — don't trust it for sessionDate
            sessionDate: sym === 'US10Y' ? null : parseIsoDatePrefix(d.last_trade_time),
        },
        extended: null, // Cboe carries NO pre/post-market data at all — never populate this
    };
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
    return extractCboeSession(sym, j);
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

// NASDAQ public API — free, no auth. secondaryData is ALWAYS the last
// completed regular-session close; primaryData is a live print only when
// isRealTime === true (the actual gate for `extended` — not the
// marketStatus string, which only supplies the sessionType label). See
// reports/designs/2026-08-18-session-aware-quotes.md §1b for the full
// isRealTime/marketStatus mapping table.
const MARKET_STATUS_MAP = {
    'Pre-Market': 'pre-market',
    'Market Open': 'intraday',
    'After Hours': 'after-hours',
    'Closed': 'closed',
};

function parseNum(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[$,%+]/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

// Strips the optional "Closed at " prefix NASDAQ adds to secondaryData's
// timestamp once the regular session has ended (e.g. "Closed at Aug 17,
// 2026 4:00 PM ET") and parses the "Mon D, YYYY" date into YYYY-MM-DD.
function parseNasdaqDate(s) {
    if (!s) return null;
    const cleaned = s.replace(/^Closed at\s+/i, '');
    const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/.exec(cleaned);
    if (!m) return null;
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const mm = months[m[1]];
    if (!mm) return null;
    const dd = String(m[2]).padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
}

function extractNasdaqSession(j) {
    const status = j?.data?.marketStatus;
    const sessionType = MARKET_STATUS_MAP[status] || null;
    const sd = j?.data?.secondaryData;
    const pd = j?.data?.primaryData;

    // secondaryData.netChange/percentageChange describe the regular session's own
    // move, so prevClose derives as price - change. Do NOT use any source's
    // `prev_day_close` for this: on a pre-market run it names the SAME session we
    // just published, which would report every symbol as unchanged.
    const regular = (sd?.lastSalePrice != null) ? {
        price: parseNum(sd.lastSalePrice),
        change: parseNum(sd.netChange),
        changePct: parseNum(sd.percentageChange),
        prevClose: null, // derived in the merge step from price - change
        sessionDate: parseNasdaqDate(sd.lastTradeTimestamp),
    } : null;

    const extended = (pd?.isRealTime === true && pd?.lastSalePrice != null) ? {
        price: parseNum(pd.lastSalePrice),
        sessionType,
    } : null; // omitted whenever isRealTime is false/absent (covers the "Closed" state)

    return { marketStatus: status, sessionType, regular, extended };
}

// Tries assetclass=stocks first; falls back to assetclass=etf for ETFs that
// reject the stocks path (e.g. SOXL/NYSE Arca), then assetclass=index for
// SPX/NDX/VIX-style market indices. Fallback loop itself is unchanged by the
// 2026-08-18 session-aware redesign — only the post-fetch extraction is.
async function fetchNasdaqOne(sym, signal) {
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
            const session = extractNasdaqSession(j);
            if (session.regular?.price == null && session.extended?.price == null) {
                lastErr = `no_primaryData@${cls}`; continue;
            }
            return session;
        } catch (e) {
            lastErr = (e.message || 'fetch_err') + '@' + cls;
        }
    }
    throw new Error(`nasdaq:${lastErr}`);
}

// CNBC restQuote — unofficial partner endpoint (no key, no SLA), now
// first-class for the full 27-symbol universe (promoted from an
// indices-only gap filler — see header comment). Session-tagged natively:
// last/previous_day_closing is the regular close, ExtendedMktQuote is a
// live pre/after-hours print.
const CNBC_SYMBOL_MAP = { SPX: '.SPX', NDX: '.NDX', VIX: '.VIX', DXY: '.DXY', US10Y: 'US10Y' };

function cnbcSymbol(sym) {
    return CNBC_SYMBOL_MAP[sym] || sym; // equities/ETFs: bare symbol, e.g. "SOXL", "GOOGL"
}

function mapCnbcExtType(type) {
    if (type === 'PRE_MKT') return 'pre-market'; // confirmed by probe
    if (type === 'AFTER_HOURS' || type === 'POST_MKT') return 'after-hours'; // unconfirmed — validate on first post-close dispatch
    return 'intraday';
}

// Comma/currency-formatted numeric strings — same cleanup NASDAQ's parseNum
// applies (duplicated here rather than sharing a closure, since CNBC is a
// distinct source).
function parseCnbcNum(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[$,%+]/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

// CNBC's own change/change_pct top-level fields are used as-is for
// `regular` (already validated in production drops); ExtendedMktQuote's own
// change/change_pct are NOT read — extended.changePct is self-derived
// against the row's own verified `price` in the merge step so it stays
// internally consistent regardless of which source wins the extended slot.
function extractCnbcSession(row) {
    const price = parseCnbcNum(row.last);
    // row.change belongs to the session `last` came from; previous_day_closing
    // repeats that same close pre-market, so prevClose derives as last - change.
    const cnChange = parseCnbcNum(row.change);
    const regular = (price != null) ? {
        price,
        change: cnChange,
        prevClose: cnChange != null ? +(price - cnChange).toFixed(4) : null,
        changePct: parseCnbcNum(row.change_pct),
        sessionDate: row.last_time || null, // probe shows this is already "YYYY-MM-DD"
    } : null;

    const ext = row.ExtendedMktQuote;
    const extended = (ext && ext.last != null) ? {
        price: parseCnbcNum(ext.last),
        sessionType: mapCnbcExtType(ext.type),
    } : null; // omitted when ExtendedMktQuote is absent (no live extended print this cycle)

    return { curmktstatus: row.curmktstatus, regular, extended };
}

// One batched request covers all 27 symbols (URL length ~200 chars,
// trivially fine). Per-symbol misses inside the response are recorded as
// failures by the caller rather than failing the whole request.
async function fetchCnbcBatchOnce(symbols, signal) {
    const joined = symbols.map(s => cnbcSymbol(s)).join('|');
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(joined)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.cnbc.com/' }
    });
    if (!res.ok) throw new Error(`cnbc:http_${res.status}`);
    const j = await res.json();
    const raw = j?.FormattedQuoteResult?.FormattedQuote;
    const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const revMap = Object.fromEntries(symbols.map(s => [cnbcSymbol(s), s]));
    const out = {};
    for (const row of rows) {
        const sym = revMap[row.symbol];
        if (!sym) continue;
        out[sym] = extractCnbcSession(row);
    }
    return out;
}

// reports/raw/YYYY-MM-DD-quotes.json shape: existing flat
// price/change/changePct/prevClose fields are kept (now holding
// regular-session values), new keys are added alongside per the design's
// additive-only raw-drop delta.
function nasdaqToRaw(session) {
    if (!session) return null;
    const out = {
        price: session.regular?.price ?? null,
        change: null,
        changePct: null,
        prevClose: null,
        marketStatus: session.marketStatus ?? null,
        regularSessionDate: session.regular?.sessionDate ?? null,
    };
    if (session.extended) out.extended = { price: session.extended.price, sessionType: session.extended.sessionType };
    return out;
}

function cboeToRaw(session) {
    if (!session) return null;
    const r = session.regular;
    return {
        price: r?.price ?? null,
        change: r?.change ?? null,
        changePct: r?.changePct ?? null,
        prevClose: r?.prevClose ?? null,
        regularSessionDate: r?.sessionDate ?? null,
    };
}

function cnbcToRaw(session) {
    if (!session) return null;
    const r = session.regular;
    const out = {
        price: r?.price ?? null,
        change: r?.change ?? null,
        changePct: r?.changePct ?? null,
        prevClose: r?.prevClose ?? null,
        curmktstatus: session.curmktstatus ?? null,
        regularSessionDate: r?.sessionDate ?? null,
    };
    if (session.extended) out.extended = { price: session.extended.price, sessionType: session.extended.sessionType };
    return out;
}

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const tickers = [
        ...(universe.tickers || []).map(t => t.symbol),
        ...(universe.indices || []).map(t => t.symbol)
    ];
    if (!tickers.length) { console.error('no tickers'); process.exit(1); }
    const indexSymbolSet = new Set((universe.indices || []).map(t => t.symbol));

    const cboeSem = new Semaphore(CBOE_CONCURRENCY);
    const nasdaqSem = new Semaphore(3);
    const cboeMap = {};
    const nasdaqMap = {};
    const cnbcMap = {};
    const failures = [];

    // Cboe fan-out — independent source, restores 2-source verification for
    // equities + SPX/NDX/VIX/US10Y regardless of NASDAQ/CNBC availability.
    await Promise.all(tickers.filter(s => !CBOE_SKIP.has(s)).map(sym => cboeSem.run(async () => {
        try {
            cboeMap[sym] = await withTimeout(s => fetchCboeOne(sym, s), TIMEOUT_MS, `cboe:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'cboe', reason: e.message });
        }
    })));

    // NASDAQ fan-out — primary source (3 assetclass fallbacks per symbol). Untouched.
    await Promise.all(tickers.filter(s => !NASDAQ_SKIP.has(s)).map(sym => nasdaqSem.run(async () => {
        try {
            nasdaqMap[sym] = await withTimeout(s => fetchNasdaqOne(sym, s), TIMEOUT_MS * 2, `nasdaq:${sym}`);
        } catch (e) {
            failures.push({ symbol: sym, source: 'nasdaq', reason: e.message });
        }
    })));

    // CNBC — one batched request, 1 retry. Full 27-symbol coverage (promoted
    // from indices-only) — per-symbol misses inside the batch are recorded
    // individually rather than failing the whole request.
    let cnbcBatchOk = false;
    try {
        Object.assign(cnbcMap, await withTimeout(s => fetchCnbcBatchOnce(tickers, s), TIMEOUT_MS, 'cnbc:batch'));
        cnbcBatchOk = true;
    } catch (e1) {
        try {
            Object.assign(cnbcMap, await withTimeout(s => fetchCnbcBatchOnce(tickers, s), TIMEOUT_MS, 'cnbc:batch-retry'));
            cnbcBatchOk = true;
        } catch (e2) {
            failures.push({ symbol: 'ALL', source: 'cnbc', reason: e2.message });
        }
    }
    if (cnbcBatchOk) {
        for (const sym of tickers) {
            if (!cnbcMap[sym]) failures.push({ symbol: sym, source: 'cnbc', reason: 'cnbc:not_found' });
        }
    }

    const ts = nowIso();

    // For prevClose carry-forward: use the prior file's stored price when no
    // source in this run supplies one.
    let prior = { quotes: {} };
    try { prior = await readJson('data/price-quotes.json'); } catch { /* first run */ }

    // Top-level session: market phase at scrape time, from whichever NASDAQ
    // response resolved first (NASDAQ is the only source that serves an
    // explicit marketStatus string covering the whole universe's session).
    let session = null;
    for (const sym of tickers) {
        const st = nasdaqMap[sym]?.sessionType;
        if (st) { session = st; break; }
    }
    if (!session) session = 'closed';

    const quotes = {};
    for (const sym of tickers) {
        const n = nasdaqMap[sym];
        const c = cboeMap[sym];
        const cn = cnbcMap[sym];
        const nReg = n?.regular;
        const cReg = c?.regular;
        const cnReg = cn?.regular;

        // Primary-price selection chain (unchanged pattern, sources
        // removed): NASDAQ > Cboe > CNBC, regular-session values only.
        const primary = (nReg?.price != null) ? nReg
            : (cReg?.price != null) ? cReg
            : (cnReg?.price != null) ? cnReg
            : null;
        if (!primary) continue;

        const perSource = {};
        if (nReg?.price != null) perSource.nasdaq = nReg.price;
        if (cReg?.price != null) perSource.cboe = cReg.price;
        if (cnReg?.price != null) perSource.cnbc = cnReg.price;

        // Session move: take the change each source reports FOR the session it
        // published, then derive prevClose from it. Falling back to a stored
        // prior-run price is a last resort — across a weekend or a skipped run it
        // silently spans more than one session.
        const sessionChange = (nReg?.change != null) ? nReg.change
            : (cReg?.change != null) ? cReg.change
            : (cnReg?.change != null) ? cnReg.change
            : null;

        const priorPrice = prior?.quotes?.[sym]?.price;
        const priorSessionDate = prior?.quotes?.[sym]?.regularSessionDate;
        const regularSessionDate = nReg?.sessionDate ?? cReg?.sessionDate ?? cnReg?.sessionDate ?? null;

        let carriedPrev, change, changePct;
        if (sessionChange != null) {
            change = +sessionChange.toFixed(4);
            carriedPrev = +(primary.price - change).toFixed(4);
            changePct = (carriedPrev !== 0) ? +((change / carriedPrev) * 100).toFixed(4) : 0;
        } else if (priorPrice != null && priorSessionDate && regularSessionDate
                   && priorSessionDate !== regularSessionDate) {
            // No source reported a change, but the stored run is a genuinely
            // earlier session — safe to difference against it.
            carriedPrev = priorPrice;
            change = +(primary.price - carriedPrev).toFixed(4);
            changePct = (carriedPrev !== 0) ? +((change / carriedPrev) * 100).toFixed(4) : 0;
        } else {
            // Unknown rather than zero: a fabricated 0.00% reads as "flat today".
            carriedPrev = null;
            change = null;
            changePct = null;
        }

        const assetClass = classifySymbol(sym, indexSymbolSet);
        const tolerance = TOLERANCE_BY_CLASS[assetClass] ?? TOLERANCE_BY_CLASS.equity;
        const { verified } = pairwiseVerify(perSource, tolerance);

        const row = {
            price: primary.price,
            change,
            changePct,
            prevClose: carriedPrev,
            regularSessionDate,
            verified,
            sourceCount: Object.keys(perSource).length,
            assetClass,
            perSource,
            lastUpdated: ts
        };

        // Extended (live) print — sibling of perSource, never blended into
        // the regular close above. changePct is self-derived vs the row's
        // own verified `price`, not vs prevClose.
        const extPerSource = {};
        if (n?.extended?.price != null) extPerSource.nasdaq = n.extended.price;
        if (cn?.extended?.price != null) extPerSource.cnbc = cn.extended.price;
        if (Object.keys(extPerSource).length) {
            const extPrimary = n?.extended ?? cn?.extended; // NASDAQ > CNBC, same priority order as regular
            const extChangePct = (primary.price !== 0)
                ? +(((extPrimary.price - primary.price) / primary.price) * 100).toFixed(4)
                : null;
            const { verified: extVerified } = pairwiseVerify(extPerSource, tolerance);
            row.extended = {
                price: extPrimary.price,
                changePct: extChangePct,
                verified: extVerified,
                sessionType: extPrimary.sessionType,
                perSource: extPerSource
            };
        }

        quotes[sym] = row;
    }

    const okCount = Object.keys(quotes).length;
    const priorCount = Object.values(prior.quotes || {}).filter(q => q.price != null).length;

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate: todayUtc(),
        perSourceRaw: {
            nasdaq: Object.fromEntries(Object.entries(nasdaqMap).map(([sym, s]) => [sym, nasdaqToRaw(s)])),
            cboe: Object.fromEntries(Object.entries(cboeMap).map(([sym, s]) => [sym, cboeToRaw(s)])),
            cnbc: Object.fromEntries(Object.entries(cnbcMap).map(([sym, s]) => [sym, cnbcToRaw(s)])),
        },
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
        note: 'Owned by refresher agent + GitHub Actions data-refresh workflow. Sources: NASDAQ public API (primary) + Cboe delayed-quotes CDN (secondary) + CNBC restQuote (tertiary, full coverage) — see scripts/scrape-quotes.mjs header for the 2026-08-18 session-aware redesign and the Yahoo/Stooq removal rationale. quotes[sym].price/changePct/verified describe the official REGULAR-SESSION close only; a live pre/after-hours (or intraday) print, when available, is reported separately under quotes[sym].extended and is NEVER blended into the verified close. Kapture (TradingView) imports merge into perSource.kapture (regular only).',
        updated: ts,
        asOfDate: todayUtc(),
        agent: 'refresher',
        sources: ['nasdaq', 'cboe', 'cnbc'],
        session,
        tolerance: TOLERANCE_BY_CLASS.equity,
        toleranceByClass: TOLERANCE_BY_CLASS,
        quotes: merged,
        failures
    };
    await writeJsonAtomic('data/price-quotes.json', out);

    const verifiedCount = Object.values(quotes).filter(q => q.verified).length;
    console.log(`scrape-quotes: ${okCount}/${tickers.length} symbols, ${verifiedCount} verified, ${failures.length} failures, session=${session}`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
