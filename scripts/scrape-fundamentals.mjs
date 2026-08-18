#!/usr/bin/env node
// Scrape trailing/forward P/E + ETF metadata for the 20 stock tickers in
// tickers-universe.json (ETF-Leveraged sector tickers — SOXL/TSMU — get
// notApplicable + real expense-ratio/AUM/beta instead). Replaces the prior
// validator/WebSearch-synthesis phase of data/fundamentals.json entirely —
// see reports/designs/2026-08-18-fundamentals-scraper.md for the full design
// this implements, grounded in reports/validation/2026-08-18-fundamentals-probe.md
// (CI ground truth, captured 2026-08-18 from a GitHub Actions runner IP).
//
// ROSTER (four independent phases, run concurrently via Promise.all):
// - CNBC batched quote.htm (primary) — one request covers all 20 stock
//   tickers, gives pe/eps/fpe/feps (trailing + NTM-basis forward).
// - SEC XBRL companyconcept (authoritative second source for TRAILING P/E
//   only) — TTM diluted EPS computed from the last 4 discrete-quarter
//   USD/shares facts, PE anchored to OUR OWN verified close in
//   data/price-quotes.json (SEC supplies no price). Domestic 10-Q/10-K
//   filers only — TSM/ARM/CLS are foreign private issuers (20-F/40-F,
//   annual-only) and are EXPECTED to miss this leg (sec:insufficient_quarters),
//   not a bug. Fresh ticker->CIK map refetched every run (~1MB, refetch is
//   simpler than a cache+TTL for one extra ~3-5s request).
// - stockanalysis.com statistics page (best-effort HTML/JSON regex
//   extraction, tertiary) — probe confirmed HTTP 200/121KB but flagged as
//   "fragile to redesign"; fails safe (never crashes the run), logs
//   stockanalysis:extract_miss on a parse miss.
// - NASDAQ peg-ratio (FY-basis forward P/E estimates) + ETF summary
//   (expenseRatio/aum/beta for SOXL/TSMU) — same host/phase.
// Dead per the 2026-08-18 probe, not attempted: macrotrends.net (HTTP 403
// Cloudflare challenge), wsj.com (HTTP 401 captcha-delivery).
//
// THE FORWARD-P/E BASIS TRAP (see design doc §2): forward P/E is not one
// number — CNBC's fpe/feps is NTM (next-twelve-months) consensus, NASDAQ's
// peg-ratio chart is FY-basis (e.g. "2026 Estimates"). A forward P/E is only
// ever compared against another forward P/E on the IDENTICAL basis string —
// never averaged, never cross-verified across bases. forwardPEByBasis carries
// every basis independently; the top-level forwardPE/forwardPEBasis resolve
// via a priority chain (CNBC NTM -> stockanalysis assumed-NTM -> nearest
// NASDAQ FY-basis) purely for index.html back-compat.
//
// TRAILING P/E is two-tier: primary is EPS-vs-EPS agreement at 1%
// (tolerance.trailingEps — reuses validator.md's already-documented
// "1% for fundamentals (EPS/rev)" convention, strips out cross-vendor
// price-timing noise entirely); falls back to raw PE-vs-PE at 5%
// (tolerance.trailingPE) only when no second source exposes a separate EPS.
//
// RATE LIMITS / BUDGETS (worst case ~61s total — phases run concurrently,
// wall time is the MAX not the sum):
// - CNBC: 1 batched request (+1 retry), 8s timeout each -> <=16s.
// - SEC XBRL: ticker-map + up to 20 companyconcept fetches, concurrency 5,
//   10s timeout each (1 retry on 5xx/network only, no retry on 404), hard
//   phase budget 60s (SEC_PHASE_BUDGET_MS) checked before each fetch.
// - stockanalysis: concurrency 4, 8s timeout, NO retry (best-effort,
//   protects the phase budget), hard phase budget 45s.
// - NASDAQ (peg-ratio + ETF summary, shared phase/budget): concurrency 3,
//   16s timeout (TIMEOUT_MS*2, matches scrape-quotes.mjs's NASDAQ pattern),
//   1 retry on 5xx only, hard phase budget 45s.
// SEC requires a fair-access User-Agent with a real contact per SEC policy
// (not UA-spoofing evasion like the other sources) — see SEC_UA below.
//
// Per-source failures are recorded in failures[] (data, not a crash) — the
// script exits non-zero only on a genuinely fatal error (e.g. can't read
// data/tickers-universe.json). continue-on-error in the workflow means this
// step failing must never block the quotes/news commit either way.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout, Semaphore } from './lib/io.mjs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// SEC's fair-access policy requires a descriptive UA with a real contact, not
// a generic browser UA — using a fake browser UA here would violate SEC's own
// terms, unlike the other sources where UA-spoofing is just anti-bot evasion.
const SEC_UA = 'Traiding-Dashboard research contact: pebrikai67@gmail.com';

const CNBC_TIMEOUT_MS = 8000;

const SEC_TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_TIMEOUT_MS = 10000;
const SEC_CONCURRENCY = 5;
const SEC_PHASE_BUDGET_MS = 60_000;

const STOCKANALYSIS_TIMEOUT_MS = 8000;
const STOCKANALYSIS_CONCURRENCY = 4;
const STOCKANALYSIS_PHASE_BUDGET_MS = 45_000;

const NASDAQ_TIMEOUT_MS = 16000; // TIMEOUT_MS*2 pattern reused from scrape-quotes.mjs
const NASDAQ_CONCURRENCY = 3;
const NASDAQ_PHASE_BUDGET_MS = 45_000;

const TOLERANCE = { trailingEps: 0.01, trailingPE: 0.05, forwardPE: 0.05 };

// Named, justified expectation (design doc §1b/§8) — not a bug when these
// three miss the SEC leg with sec:insufficient_quarters.
const FOREIGN_ISSUER_NOTES = {
    TSM: 'TSM is a Taiwan 20-F foreign private issuer — SEC XBRL companyconcept has no quarterly EarningsPerShareDiluted facts (annual-only reporting); sec-xbrl leg not attempted for this reason, not a fetch failure.',
    ARM: 'ARM is a UK 20-F foreign private issuer — SEC XBRL companyconcept has no quarterly EarningsPerShareDiluted facts (annual-only reporting); sec-xbrl leg not attempted for this reason, not a fetch failure.',
    CLS: 'CLS is a Canada 40-F foreign private issuer — SEC XBRL companyconcept has no quarterly EarningsPerShareDiluted facts (annual-only reporting); sec-xbrl leg not attempted for this reason, not a fetch failure.',
};

// Unchanged trigger condition/reason text vs. the prior validator-authored file (design §5).
const ETF_REASONS = {
    SOXL: 'Leveraged ETF — PE not meaningful (NAV tracks 3x SOX basket, no issuer earnings)',
    TSMU: 'Leveraged single-stock ETF (2x daily-reset TSM exposure) — P/E not meaningful, no issuer earnings',
};

const FUNDAMENTALS_NOTE = "Owned by refresher agent + GitHub Actions data-refresh workflow (scripts/scrape-fundamentals.mjs). Supersedes the prior validator/WebSearch-synthesis phase — see data/README.md for the ownership history. trailingPE = CNBC's reported TTM PE (falls back to stockanalysis.com, then a SEC-XBRL-computed figure anchored to the verified close in data/price-quotes.json). trailingVerified = TTM diluted EPS agreement (CNBC vs SEC-XBRL, and stockanalysis when it exposes EPS) within tolerance.trailingEps — see tolerance.trailingPE for the wider raw-PE fallback comparison used only when no source exposes a separate EPS figure. forwardPE/forwardPEBasis = the NTM-basis consensus figure when available (CNBC feps, falls back to stockanalysis, then the nearest NASDAQ FY-basis estimate — see forwardPEBasisNote when that fallback fires). forwardPEByBasis carries every basis independently, each verified only against another source on the SAME basis — forward P/Es on different bases are NEVER cross-verified or averaged (see reports/designs/2026-08-18-fundamentals-scraper.md §2). verified (top-level, back-compat) is UNCHANGED semantics: true only if BOTH trailingVerified AND forwardVerified pass — expect this to be rare under basis-aware forward verification; trailingVerified is the more informative signal going forward. ETFs get notApplicable plus real expenseRatio/aum/etfBeta from NASDAQ's ETF summary.";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fix B: verified iff ANY PAIR of distinct sources agrees within tolerance —
// identical to scrape-quotes.mjs's helper, duplicated locally not shared,
// matching house convention (design doc §2).
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

// A forward P/E is only ever compared against another forward P/E on the
// exact same `basis` string — never averaged, never cross-verified across
// bases (design doc §2, the forward-P/E definition trap).
function verifyForwardByBasis(entries) {
    const byBasis = {};
    for (const e of entries) (byBasis[e.basis] ??= []).push(e);
    const out = {};
    for (const [basis, group] of Object.entries(byBasis)) {
        const perSource = Object.fromEntries(group.map(g => [g.source, g.value]));
        const { verified, minDelta } = group.length >= 2
            ? pairwiseVerify(perSource, TOLERANCE.forwardPE)
            : { verified: false, minDelta: null };
        out[basis] = { value: group[0].value, verified, sourceCount: group.length, perSource, deltaPct: minDelta };
    }
    return out;
}

function parseNum(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[$,%+]/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

// CNBC returns an empty/zero/negative string for loss-making issuers (SNOW,
// CRWD are GAAP-loss TTM). Must return null — not a negative or zero number —
// matching the existing "not meaningful" convention already in the file.
function parseCnbcPE(raw) {
    const n = parseNum(raw);
    if (n == null || n <= 0) return null;
    return n;
}

// ===== 1a. CNBC batched quote.htm — primary =====

// UNCONFIRMED for multi-symbol batches — the probe only exercised a single
// symbol (symbols=GOOGL). Parse defensively, trying known CNBC envelope
// shapes in priority order, never throwing on an unexpected shape.
function extractCnbcQuickRows(j) {
    const c = j?.QuickQuoteResult?.QuickQuote; // primary guess — matches requestMethod=quick naming
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object') return [c]; // single-result requests may return an object, not an array
    if (Array.isArray(j)) return j; // fallback: bare top-level array
    return null; // unexpected shape
}

async function fetchCnbcFundamentalsOnce(symbols, signal) {
    const joined = symbols.join('|');
    const url = `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(joined)}&requestMethod=quick&noform=1&partnerId=2&fund=1&exthrs=1&output=json&symbolType=symbol`;
    const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.cnbc.com/' }
    });
    if (!res.ok) throw new Error(`cnbc:http_${res.status}`);
    return res.json();
}

async function runCnbcPhase(stockSymbols, failures) {
    const perSymbol = {};
    const raw = {};
    let j = null;
    let batchErr = null;

    try {
        j = await withTimeout(s => fetchCnbcFundamentalsOnce(stockSymbols, s), CNBC_TIMEOUT_MS, 'cnbc:fundamentals');
    } catch (e1) {
        try {
            j = await withTimeout(s => fetchCnbcFundamentalsOnce(stockSymbols, s), CNBC_TIMEOUT_MS, 'cnbc:fundamentals-retry');
        } catch (e2) {
            batchErr = e2.message;
        }
    }
    if (batchErr) {
        failures.push({ symbol: 'ALL', source: 'cnbc', reason: batchErr });
        for (const sym of stockSymbols) raw[sym] = { extracted: false, reason: batchErr };
        return { perSymbol, raw };
    }

    const rows = extractCnbcQuickRows(j);
    if (rows == null) {
        const reason = 'cnbc:unexpected_shape';
        failures.push({ symbol: 'ALL', source: 'cnbc', reason, raw: JSON.stringify(j).slice(0, 200) });
        for (const sym of stockSymbols) raw[sym] = { extracted: false, reason };
        return { perSymbol, raw };
    }

    const symbolSet = new Set(stockSymbols);
    const seen = new Set();
    for (const row of rows) {
        const sym = String(row?.symbol || row?.code || '').toUpperCase();
        if (!sym || !symbolSet.has(sym)) continue;
        seen.add(sym);
        const fd = row.FundamentalData || row.fundamentalData;
        if (!fd) {
            failures.push({ symbol: sym, source: 'cnbc', reason: 'cnbc:no_fundamental_data' });
            raw[sym] = { extracted: false, reason: 'cnbc:no_fundamental_data' };
            continue;
        }
        perSymbol[sym] = {
            trailingPE: parseCnbcPE(fd.pe),
            eps: parseNum(fd.eps),
            forwardPE: parseCnbcPE(fd.fpe),
            forwardEps: parseNum(fd.feps),
        };
        raw[sym] = { pe: fd.pe ?? null, eps: fd.eps ?? null, fpe: fd.fpe ?? null, feps: fd.feps ?? null, last: row.last ?? null };
    }
    for (const sym of stockSymbols) {
        if (!seen.has(sym)) {
            failures.push({ symbol: sym, source: 'cnbc', reason: 'cnbc:not_found' });
            raw[sym] = { extracted: false, reason: 'cnbc:not_found' };
        }
    }
    return { perSymbol, raw };
}

// ===== 1b. SEC XBRL — authoritative second source for TRAILING P/E only =====

// Standard TTM technique for this SEC shape (design doc §1b, verbatim).
function computeTtmEpsDiluted(json) {
    const facts = json?.units?.['USD/shares'];
    if (!Array.isArray(facts)) throw new Error('sec:no_data');

    // Isolate SINGLE-QUARTER facts by duration, not by the `fp` label —
    // annual (fp:"FY") facts span ~365 days; some filers also report 6/9-month
    // YTD cumulative facts. Filtering by (end-start) in [80,100] days robustly
    // keeps only true discrete-quarter figures regardless of label quirks.
    const quarterly = facts.filter(f => {
        if (f.val == null || !f.start || !f.end) return false;
        const days = (new Date(f.end) - new Date(f.start)) / 86400000;
        return days >= 80 && days <= 100;
    });
    if (!quarterly.length) throw new Error('sec:insufficient_quarters');

    // Dedupe by `end` date, keeping the LATEST `filed` (amendments/restatements
    // supersede the original filing for the same period).
    const byEnd = new Map();
    for (const f of quarterly) {
        const prev = byEnd.get(f.end);
        if (!prev || new Date(f.filed) > new Date(prev.filed)) byEnd.set(f.end, f);
    }
    const last4 = [...byEnd.values()].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 4);
    if (last4.length < 4) throw new Error('sec:insufficient_quarters');

    const ttmEps = +last4.reduce((s, f) => s + f.val, 0).toFixed(4);
    return { ttmEps, quartersUsed: last4.map(f => ({ end: f.end, val: f.val, form: f.form, filed: f.filed })) };
}

async function fetchSecJson(url, signal) {
    const res = await fetch(url, { signal, headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`sec:http_${res.status}`);
    return res.json();
}

// 1 retry after 2s on 5xx/network only — a 404 means the CIK genuinely has no
// XBRL facts for this concept (e.g. a foreign private issuer) and retrying
// won't change that.
async function fetchSecJsonWithRetry(url, signal) {
    try {
        return await fetchSecJson(url, signal);
    } catch (e) {
        const m = /http_(\d+)/.exec(e.message);
        const status = m ? Number(m[1]) : null;
        const retryable = status == null || status >= 500;
        if (!retryable) throw e;
        await sleep(2000);
        return await fetchSecJson(url, signal);
    }
}

async function runSecPhase(stockSymbols, priceQuotes, failures) {
    const perSymbol = {};
    const raw = {};
    const deadline = Date.now() + SEC_PHASE_BUDGET_MS;

    // Refetched every run, never persisted — the ~1MB ticker->CIK map almost
    // never changes; a cache would need its own TTL/invalidation logic for
    // saving one ~3-5s request (design doc §1b, Simplicity First).
    const cikMap = {};
    try {
        const j = await withTimeout(s => fetchSecJsonWithRetry(SEC_TICKER_MAP_URL, s), SEC_TIMEOUT_MS, 'sec:ticker-map');
        const bySymbol = {};
        for (const entry of Object.values(j || {})) {
            const t = entry?.ticker;
            if (t) bySymbol[String(t).toUpperCase()] = entry.cik_str;
        }
        for (const sym of stockSymbols) {
            const cik = bySymbol[sym];
            if (cik != null) cikMap[sym] = String(cik).padStart(10, '0');
        }
    } catch (e) {
        // Whole SEC phase skipped this run (non-fatal) — self-heals next run.
        failures.push({ symbol: 'ALL', source: 'sec-xbrl', reason: e.message });
        for (const sym of stockSymbols) raw[sym] = { extracted: false, reason: e.message };
        return { perSymbol, raw };
    }

    const sem = new Semaphore(SEC_CONCURRENCY);
    await Promise.all(stockSymbols.map(sym => sem.run(async () => {
        const cik = cikMap[sym];
        if (!cik) {
            failures.push({ symbol: sym, source: 'sec-xbrl', reason: 'sec:no_cik' });
            raw[sym] = { extracted: false, reason: 'sec:no_cik' };
            return;
        }
        if (Date.now() > deadline) {
            failures.push({ symbol: sym, source: 'sec-xbrl', reason: 'sec:phase_budget_exhausted' });
            raw[sym] = { extracted: false, reason: 'sec:phase_budget_exhausted' };
            return;
        }
        const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/EarningsPerShareDiluted.json`;
        try {
            const j = await withTimeout(s => fetchSecJsonWithRetry(url, s), SEC_TIMEOUT_MS, `sec:${sym}`);
            const { ttmEps, quartersUsed } = computeTtmEpsDiluted(j);

            // Anchor to OUR OWN verified close (never SEC's or CNBC's price) —
            // apples-to-apples per design doc §4.
            const pq = priceQuotes?.quotes?.[sym];
            const anchorPrice = pq?.price ?? null;
            const anchorVerified = pq?.verified ?? false;
            if (anchorPrice == null) {
                failures.push({ symbol: sym, source: 'sec-xbrl', reason: 'sec:no_anchor_price' });
                raw[sym] = { cik, quartersUsed, ttmEps, extracted: false, reason: 'sec:no_anchor_price' };
                return;
            }
            const computedPE = ttmEps > 0 ? +(anchorPrice / ttmEps).toFixed(2) : null;
            perSymbol[sym] = {
                trailingPE: computedPE,
                epsUsed: ttmEps,
                quartersUsed: quartersUsed.map(q => q.end),
                anchorPrice, anchorVerified,
            };
            raw[sym] = { cik, quartersUsed, ttmEps, anchorPrice, anchorVerified, computedPE };
        } catch (e) {
            failures.push({ symbol: sym, source: 'sec-xbrl', reason: e.message });
            raw[sym] = { extracted: false, reason: e.message };
        }
    })));

    return { perSymbol, raw };
}

// ===== 1c. stockanalysis.com HTML — best-effort tertiary, fails safe =====

function extractStockanalysis(html) {
    const nextDataMatch = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (nextDataMatch) {
        const blob = nextDataMatch[1];
        const peMatch = /"peRatio":\s*([\d.]+)/.exec(blob);
        const fpeMatch = /"forwardPE":\s*([\d.]+)/.exec(blob);
        if (peMatch || fpeMatch) {
            return {
                trailingPE: peMatch ? parseFloat(peMatch[1]) : null,
                forwardPE: fpeMatch ? parseFloat(fpeMatch[1]) : null,
                method: 'next-data-json',
            };
        }
    }
    // Fallback: labeled-row regex over the raw HTML.
    const peRowMatch = /PE Ratio<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i.exec(html);
    const fpeRowMatch = /Forward PE<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i.exec(html);
    if (peRowMatch || fpeRowMatch) {
        return {
            trailingPE: peRowMatch ? parseFloat(peRowMatch[1]) : null,
            forwardPE: fpeRowMatch ? parseFloat(fpeRowMatch[1]) : null,
            method: 'html-row-regex',
        };
    }
    return null; // never throw — caller records stockanalysis:extract_miss
}

async function fetchStockanalysisOne(sym, signal) {
    const url = `https://stockanalysis.com/stocks/${sym.toLowerCase()}/statistics/`;
    const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
    if (!res.ok) throw new Error(`stockanalysis:http_${res.status}`);
    return res.text();
}

async function runStockanalysisPhase(stockSymbols, failures) {
    const perSymbol = {};
    const raw = {};
    const deadline = Date.now() + STOCKANALYSIS_PHASE_BUDGET_MS;
    const sem = new Semaphore(STOCKANALYSIS_CONCURRENCY);

    await Promise.all(stockSymbols.map(sym => sem.run(async () => {
        if (Date.now() > deadline) {
            failures.push({ symbol: sym, source: 'stockanalysis', reason: 'stockanalysis:phase_budget_exhausted' });
            raw[sym] = { extracted: false, reason: 'stockanalysis:phase_budget_exhausted' };
            return;
        }
        try {
            // No retry — best-effort, protects the phase budget.
            const html = await withTimeout(s => fetchStockanalysisOne(sym, s), STOCKANALYSIS_TIMEOUT_MS, `stockanalysis:${sym}`);
            const extracted = extractStockanalysis(html);
            if (!extracted) {
                failures.push({ symbol: sym, source: 'stockanalysis', reason: 'stockanalysis:extract_miss' });
                raw[sym] = { extracted: false, reason: 'stockanalysis:extract_miss' };
                return;
            }
            perSymbol[sym] = {
                trailingPE: extracted.trailingPE,
                forwardPE: extracted.forwardPE,
                forwardPEBasis: 'NTM', // assumed — see basisConfidence
                basisConfidence: 'assumed',
            };
            raw[sym] = { extracted: true, trailingPE: extracted.trailingPE, forwardPE: extracted.forwardPE, method: extracted.method };
        } catch (e) {
            failures.push({ symbol: sym, source: 'stockanalysis', reason: e.message });
            raw[sym] = { extracted: false, reason: e.message };
        }
    })));

    return { perSymbol, raw };
}

// ===== 1d. NASDAQ — FY-basis forward P/E (peg-ratio) + ETF summary =====

function nasdaqHeaders() {
    return {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.nasdaq.com',
        'Referer': 'https://www.nasdaq.com/'
    };
}

// 1 retry on 5xx ONLY (not network/other errors) — matches the design's
// tighter retry gate for this source vs. SEC/Cboe's 5xx-or-network gate.
async function withNasdaq5xxRetry(fetchOnce, signal) {
    try {
        return await fetchOnce(signal);
    } catch (e) {
        const m = /http_(\d+)/.exec(e.message);
        const status = m ? Number(m[1]) : null;
        if (status == null || status < 500) throw e;
        await sleep(2000);
        return await fetchOnce(signal);
    }
}

async function fetchNasdaqPegOnce(sym, signal) {
    const url = `https://api.nasdaq.com/api/analyst/${encodeURIComponent(sym.toLowerCase())}/peg-ratio`;
    const res = await fetch(url, { signal, headers: nasdaqHeaders() });
    if (!res.ok) throw new Error(`nasdaq-peg:http_${res.status}`);
    return res.json();
}

// Exact key names unconfirmed (probe reported values in prose, not raw
// JSON) — parse defensively, log unexpected_shape rather than throw.
function extractNasdaqPegChart(j) {
    const chart = j?.data?.per?.peRatioChart;
    return Array.isArray(chart) ? chart : null;
}

// Only "20XX Estimates" rows are forward-looking — "* Actual" rows are
// already-reported and skipped entirely.
function parseNasdaqForwardRows(chart) {
    const out = [];
    for (const row of chart) {
        const m = /(\d{4})\s+Estimates?/i.exec(row?.category || '');
        if (!m) continue;
        const value = typeof row.value === 'number' ? row.value : parseFloat(row.value);
        if (!Number.isFinite(value)) continue;
        out.push({ basis: `FY${m[1]}E`, value: +value.toFixed(2) });
    }
    return out;
}

async function runNasdaqPegPhase(stockSymbols, deadline, failures) {
    const perSymbol = {};
    const raw = {};
    const sem = new Semaphore(NASDAQ_CONCURRENCY);

    await Promise.all(stockSymbols.map(sym => sem.run(async () => {
        if (Date.now() > deadline) {
            failures.push({ symbol: sym, source: 'nasdaq-peg', reason: 'nasdaq-peg:phase_budget_exhausted' });
            raw[sym] = { extracted: false, reason: 'nasdaq-peg:phase_budget_exhausted' };
            return;
        }
        try {
            const j = await withTimeout(s => withNasdaq5xxRetry(sig => fetchNasdaqPegOnce(sym, sig), s), NASDAQ_TIMEOUT_MS, `nasdaq-peg:${sym}`);
            const chart = extractNasdaqPegChart(j);
            if (chart == null) {
                failures.push({ symbol: sym, source: 'nasdaq-peg', reason: 'nasdaq-peg:unexpected_shape' });
                raw[sym] = { extracted: false, reason: 'nasdaq-peg:unexpected_shape' };
                return;
            }
            perSymbol[sym] = parseNasdaqForwardRows(chart);
            raw[sym] = { chart };
        } catch (e) {
            failures.push({ symbol: sym, source: 'nasdaq-peg', reason: e.message });
            raw[sym] = { extracted: false, reason: e.message };
        }
    })));

    return { perSymbol, raw };
}

async function fetchNasdaqEtfSummaryOnce(sym, signal) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/summary?assetclass=etf`;
    const res = await fetch(url, { signal, headers: nasdaqHeaders() });
    if (!res.ok) throw new Error(`nasdaq-etf:http_${res.status}`);
    return res.json();
}

// Exact JSON key casing unconfirmed — try both PascalCase and camelCase
// variants under data.summaryData.*.value (same {label,value} shape already
// established for OneYrTarget in the probe).
function extractNasdaqEtfSummary(j) {
    const sd = j?.data?.summaryData;
    if (!sd) return null;
    const pick = (pascalKey, camelKey) => sd[pascalKey]?.value ?? sd[camelKey]?.value ?? null;
    const expenseRatioRaw = pick('ExpenseRatio', 'expenseRatio');
    const aumRaw = pick('AUM', 'aum');
    const betaRaw = pick('Beta', 'beta');
    if (expenseRatioRaw == null && aumRaw == null && betaRaw == null) return null;
    return {
        expenseRatio: expenseRatioRaw != null ? parseNum(expenseRatioRaw) / 100 : null, // "0.90%" -> 0.0090
        aum: aumRaw != null ? String(aumRaw) : null, // kept as raw string — see design doc §5
        etfBeta: betaRaw != null ? parseNum(betaRaw) : null,
    };
}

async function runNasdaqEtfPhase(etfSymbols, deadline, failures) {
    const perSymbol = {};
    const raw = {};

    await Promise.all(etfSymbols.map(async (sym) => {
        if (Date.now() > deadline) {
            failures.push({ symbol: sym, source: 'nasdaq-etf', reason: 'nasdaq-etf:phase_budget_exhausted' });
            raw[sym] = { extracted: false, reason: 'nasdaq-etf:phase_budget_exhausted' };
            return;
        }
        try {
            const j = await withTimeout(s => withNasdaq5xxRetry(sig => fetchNasdaqEtfSummaryOnce(sym, sig), s), NASDAQ_TIMEOUT_MS, `nasdaq-etf:${sym}`);
            const extracted = extractNasdaqEtfSummary(j);
            if (!extracted) {
                failures.push({ symbol: sym, source: 'nasdaq-etf', reason: 'nasdaq-etf:unexpected_shape' });
                raw[sym] = { extracted: false, reason: 'nasdaq-etf:unexpected_shape' };
                return;
            }
            perSymbol[sym] = extracted;
            raw[sym] = { expenseRatio: extracted.expenseRatio, aum: extracted.aum, beta: extracted.etfBeta };
        } catch (e) {
            failures.push({ symbol: sym, source: 'nasdaq-etf', reason: e.message });
            raw[sym] = { extracted: false, reason: e.message };
        }
    }));

    return { perSymbol, raw };
}

// peg-ratio + ETF summary share one host and one 45s budget window (design doc §1d).
async function runNasdaqPhase(stockSymbols, etfSymbols, failures) {
    const deadline = Date.now() + NASDAQ_PHASE_BUDGET_MS;
    const [peg, etf] = await Promise.all([
        runNasdaqPegPhase(stockSymbols, deadline, failures),
        runNasdaqEtfPhase(etfSymbols, deadline, failures),
    ]);
    return { peg, etf };
}

// ===== per-ticker resolution (pure — no I/O, unit-harnessed directly) =====

// Back-compat top-level forwardPE/forwardPEBasis priority chain (design §2):
// CNBC NTM -> stockanalysis assumed-NTM -> nearest NASDAQ FY-basis estimate.
function resolveForwardPE(cnbc, sa, forwardPEByBasis) {
    let forwardPE = null, forwardPEBasis = null, forwardEps = null, forwardPEBasisNote = null;
    if (cnbc && cnbc.forwardPE != null) {
        forwardPE = cnbc.forwardPE; forwardPEBasis = 'NTM'; forwardEps = cnbc.forwardEps ?? null;
    } else if (sa && sa.forwardPE != null) {
        forwardPE = sa.forwardPE; forwardPEBasis = 'NTM';
    } else {
        const fyBases = Object.keys(forwardPEByBasis).filter(b => b !== 'NTM').sort();
        if (fyBases.length) {
            const nearest = fyBases[0];
            forwardPE = forwardPEByBasis[nearest].value;
            forwardPEBasis = nearest;
            forwardPEBasisNote = `No NTM consensus available this cycle — showing ${nearest} (NASDAQ consensus) instead.`;
        }
    }
    const forwardVerified = forwardPEBasis ? (forwardPEByBasis[forwardPEBasis]?.verified ?? false) : false;
    return { forwardPE, forwardPEBasis, forwardEps, forwardPEBasisNote, forwardVerified };
}

// Two-tier trailing verification (design §4): EPS-vs-EPS primary (1%), raw
// PE-vs-PE fallback (5%) only when fewer than 2 sources expose EPS directly.
function resolveTrailingVerification(cnbc, sec, sa) {
    const epsValues = {};
    if (cnbc && cnbc.eps != null) epsValues.cnbc = cnbc.eps;
    if (sec && sec.epsUsed != null) epsValues['sec-xbrl'] = sec.epsUsed;
    if (Object.keys(epsValues).length >= 2) {
        const { verified, minDelta } = pairwiseVerify(epsValues, TOLERANCE.trailingEps);
        return { trailingVerified: verified, trailingLeg: 'eps', trailingDelta: minDelta, trailingSources: epsValues };
    }
    const peValues = {};
    if (cnbc && cnbc.trailingPE != null) peValues.cnbc = cnbc.trailingPE;
    if (sa && sa.trailingPE != null) peValues.stockanalysis = sa.trailingPE;
    if (sec && sec.trailingPE != null) peValues['sec-xbrl'] = sec.trailingPE;
    if (Object.keys(peValues).length >= 2) {
        const { verified, minDelta } = pairwiseVerify(peValues, TOLERANCE.trailingPE);
        return { trailingVerified: verified, trailingLeg: 'pe', trailingDelta: minDelta, trailingSources: peValues };
    }
    return { trailingVerified: false, trailingLeg: null, trailingDelta: null, trailingSources: {} };
}

// ETFs never carry a PE — real expenseRatio/aum/etfBeta from NASDAQ's ETF
// summary phase are the only live data (design §5).
function buildEtfRecord(sym, etf, asOfDate) {
    return {
        updated: asOfDate,
        agent: 'refresher',
        trailingPE: null,
        forwardPE: null,
        notApplicable: true,
        reason: ETF_REASONS[sym] || 'Leveraged ETF — PE not meaningful',
        expenseRatio: etf?.expenseRatio ?? null,
        aum: etf?.aum ?? null,
        etfBeta: etf?.etfBeta ?? null,
        etfAsOf: etf ? asOfDate : null,
    };
}

// ===== main =====

async function main() {
    const universe = await readJson('data/tickers-universe.json');
    const allTickers = universe.tickers || [];
    // Derived from sector, not a duplicated hardcoded list — matches
    // classifySymbol's convention in scrape-quotes.mjs. Only SOXL/TSMU carry
    // sector "ETF-Leveraged" today.
    const etfSymbols = allTickers.filter(t => t.sector === 'ETF-Leveraged').map(t => t.symbol);
    const etfSymbolSet = new Set(etfSymbols);
    const stockSymbols = allTickers.filter(t => !etfSymbolSet.has(t.symbol)).map(t => t.symbol);
    if (!stockSymbols.length) { console.error('no stock tickers'); process.exit(1); }

    let priceQuotes = { quotes: {} };
    try { priceQuotes = await readJson('data/price-quotes.json'); } catch { /* SEC anchor unavailable this run — sec:no_anchor_price failures follow, self-heals next run */ }

    const failures = [];

    const [cnbcResult, secResult, stockanalysisResult, nasdaqResult] = await Promise.all([
        runCnbcPhase(stockSymbols, failures),
        runSecPhase(stockSymbols, priceQuotes, failures),
        runStockanalysisPhase(stockSymbols, failures),
        runNasdaqPhase(stockSymbols, etfSymbols, failures),
    ]);

    const ts = nowIso();
    const asOfDate = todayUtc();
    const fundamentals = {};
    const compare = [];
    let trailingVerifiedCount = 0;
    let forwardVerifiedAnyBasisCount = 0;

    for (const sym of stockSymbols) {
        const cnbc = cnbcResult.perSymbol[sym] || null;
        const sec = secResult.perSymbol[sym] || null;
        const sa = stockanalysisResult.perSymbol[sym] || null;
        const pegRows = nasdaqResult.peg.perSymbol[sym] || [];

        const perSource = {};
        if (cnbc) perSource.cnbc = { trailingPE: cnbc.trailingPE, eps: cnbc.eps, forwardPE: cnbc.forwardPE, forwardPEBasis: 'NTM', forwardEps: cnbc.forwardEps };
        if (sec) perSource['sec-xbrl'] = { trailingPE: sec.trailingPE, epsUsed: sec.epsUsed, quartersUsed: sec.quartersUsed, anchorPrice: sec.anchorPrice, anchorVerified: sec.anchorVerified, anchorSource: 'data/price-quotes.json' };
        if (sa) perSource.stockanalysis = { trailingPE: sa.trailingPE, forwardPE: sa.forwardPE, forwardPEBasis: 'NTM', basisConfidence: 'assumed' };

        // Basis-purity gate — build entries once, group/verify per-basis only.
        const forwardEntries = [];
        if (cnbc && cnbc.forwardPE != null) forwardEntries.push({ source: 'cnbc', value: cnbc.forwardPE, basis: 'NTM' });
        if (sa && sa.forwardPE != null) forwardEntries.push({ source: 'stockanalysis', value: sa.forwardPE, basis: 'NTM' });
        for (const row of pegRows) forwardEntries.push({ source: 'nasdaq-peg', value: row.value, basis: row.basis });
        const forwardPEByBasis = verifyForwardByBasis(forwardEntries);

        const { forwardPE, forwardPEBasis, forwardEps, forwardPEBasisNote, forwardVerified } =
            resolveForwardPE(cnbc, sa, forwardPEByBasis);
        const { trailingVerified, trailingLeg, trailingDelta, trailingSources } =
            resolveTrailingVerification(cnbc, sec, sa);

        const trailingPE = (cnbc && cnbc.trailingPE != null) ? cnbc.trailingPE
            : (sa && sa.trailingPE != null) ? sa.trailingPE
            : (sec && sec.trailingPE != null) ? sec.trailingPE
            : null;
        const eps = (cnbc && cnbc.eps != null) ? cnbc.eps : null;

        let sourceCount = 0;
        if (cnbc && cnbc.trailingPE != null) sourceCount++;
        if (sec && sec.trailingPE != null) sourceCount++;
        if (sa && sa.trailingPE != null) sourceCount++;

        const record = {
            updated: asOfDate,
            agent: 'refresher',
            asOf: asOfDate,
            trailingPE,
            eps,
            trailingVerified,
            forwardPE,
            forwardPEBasis,
            forwardEps,
            forwardVerified,
            verified: trailingVerified && forwardVerified,
            sourceCount,
            notApplicable: false,
            perSource,
            forwardPEByBasis,
        };
        if (forwardPEBasisNote) record.forwardPEBasisNote = forwardPEBasisNote;
        if (FOREIGN_ISSUER_NOTES[sym] && !sec) record.note = FOREIGN_ISSUER_NOTES[sym];
        fundamentals[sym] = record;

        if (trailingVerified) trailingVerifiedCount++;
        if (Object.values(forwardPEByBasis).some(b => b.verified)) forwardVerifiedAnyBasisCount++;

        compare.push({
            symbol: sym, leg: 'trailing', basis: trailingLeg || 'none',
            status: trailingLeg ? (trailingVerified ? 'verified' : 'mismatch') : 'single-source',
            deltaPct: Number.isFinite(trailingDelta) ? +trailingDelta.toFixed(5) : null,
            sources: trailingSources,
        });
        if (forwardPEBasis) {
            const fb = forwardPEByBasis[forwardPEBasis];
            compare.push({
                symbol: sym, leg: 'forward', basis: forwardPEBasis,
                status: fb.sourceCount >= 2 ? (fb.verified ? 'verified' : 'mismatch') : 'single-source',
                deltaPct: Number.isFinite(fb.deltaPct) ? +fb.deltaPct.toFixed(5) : null,
                sources: fb.perSource,
            });
        }
    }

    for (const sym of etfSymbols) {
        const etf = nasdaqResult.etf.perSymbol[sym] || null;
        fundamentals[sym] = buildEtfRecord(sym, etf, asOfDate);
    }

    const out = {
        note: FUNDAMENTALS_NOTE,
        updated: ts,
        asOfDate,
        agent: 'refresher',
        sources: ['cnbc', 'sec-xbrl', 'stockanalysis', 'nasdaq-peg'],
        tolerance: TOLERANCE,
        fundamentals,
        failures,
    };
    await writeJsonAtomic('data/fundamentals.json', out);

    const rawDrop = {
        agent: 'refresher',
        runAt: ts,
        asOfDate,
        perSourceRaw: {
            cnbc: cnbcResult.raw,
            'sec-xbrl': secResult.raw,
            stockanalysis: stockanalysisResult.raw,
            'nasdaq-peg': nasdaqResult.peg.raw,
            'nasdaq-etf': nasdaqResult.etf.raw,
        },
        failures,
    };
    await writeJsonAtomic(`reports/raw/${asOfDate}-fundamentals.json`, rawDrop);

    const compareOut = {
        agent: 'refresher',
        runAt: ts,
        tolerance: TOLERANCE,
        summary: {
            trailingVerified: trailingVerifiedCount,
            trailingTotal: stockSymbols.length,
            forwardVerifiedAnyBasis: forwardVerifiedAnyBasisCount,
            forwardTotal: stockSymbols.length,
        },
        compare,
    };
    await writeJsonAtomic(`reports/validation/${asOfDate}-fundamentals-compare.json`, compareOut);

    console.log(`scrape-fundamentals: ${trailingVerifiedCount}/${stockSymbols.length} trailing verified, ${forwardVerifiedAnyBasisCount}/${stockSymbols.length} forward verified (any basis), ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
