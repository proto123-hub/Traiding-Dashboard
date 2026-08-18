#!/usr/bin/env node
// Diagnostic probe — dumps RAW upstream payloads so source adapters can be
// grounded in real responses from a runner IP. The dev sandbox cannot reach any
// finance host, so this is the only way to see what upstreams actually return.
//
// Run via the TEMP step in .github/workflows/data-refresh.yml (workflow_dispatch)
// and read the job log. Writes nothing.
//
// Round 2 (2026-08-18): quote-source semantics are settled — see
// reports/validation/2026-08-18-source-probe.md. This round targets FUNDAMENTALS
// (trailing/forward P/E) for scripts/scrape-fundamentals.mjs.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function show(label, text, limit = 2200) {
    const body = text.length > limit ? text.slice(0, limit) + `\n…[truncated ${text.length - limit} chars]` : text;
    console.log(`\n===== ${label} =====\n${body}`);
}

async function probe(label, url, headers = {}) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
        const text = await res.text();
        show(`${label} — HTTP ${res.status} — ${url}`, text);
        return { ok: res.ok, text };
    } catch (e) {
        console.log(`\n===== ${label} — FETCH ERROR — ${url} =====\n${e.message}`);
        return { ok: false, text: '' };
    }
}

console.log(`probe-sources(fundamentals): runAt=${new Date().toISOString()}`);

const J = { Accept: 'application/json' };

// --- NASDAQ: does the key-less summary endpoint carry P/E? ---
for (const s of ['GOOGL', 'MU']) {
    await probe(`nasdaq summary ${s}`, `https://api.nasdaq.com/api/quote/${s}/summary?assetclass=stocks`, J);
}
// ETF variant (SOXL is NYSE Arca — stocks assetclass 404s)
await probe('nasdaq summary SOXL (etf)', 'https://api.nasdaq.com/api/quote/SOXL/summary?assetclass=etf', J);

// NASDAQ analyst/earnings surfaces — forward P/E often lives with EPS forecasts.
await probe('nasdaq eps GOOGL', 'https://api.nasdaq.com/api/analyst/GOOGL/earnings-forecast', J);
await probe('nasdaq price/earnings GOOGL', 'https://api.nasdaq.com/api/analyst/GOOGL/peg-ratio', J);

// --- CNBC: the quote payload showed dividend/yield; does a fuller field set carry P/E? ---
await probe('cnbc quote GOOGL (full)',
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=GOOGL&requestMethod=extended&noform=1&partnerId=2&fund=1&exthrs=1&output=json',
    J);
await probe('cnbc fundamentals GOOGL',
    'https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=GOOGL&requestMethod=quick&noform=1&partnerId=2&fund=1&exthrs=1&output=json&symbolType=symbol',
    J);

// --- Stockanalysis: the validator's preferred human source. Is it key-less for machines? ---
await probe('stockanalysis GOOGL json',
    'https://stockanalysis.com/api/symbol/s/GOOGL/overview', J);
await probe('stockanalysis GOOGL statistics page',
    'https://stockanalysis.com/stocks/googl/statistics/', { Accept: 'text/html' });

// --- SEC: authoritative EPS (companyconcept) — PE would be derived, not fetched ---
await probe('sec companyconcept GOOGL EPS diluted',
    'https://data.sec.gov/api/xbrl/companyconcept/CIK0001652044/us-gaap/EarningsPerShareDiluted.json',
    { Accept: 'application/json', 'User-Agent': 'Traiding-Dashboard research contact: pebrikai67@gmail.com' });

// --- Others worth one shot each ---
await probe('macrotrends GOOGL pe (html)', 'https://www.macrotrends.net/stocks/charts/GOOG/alphabet/pe-ratio', { Accept: 'text/html' });
await probe('wsj quote GOOGL (html head)', 'https://www.wsj.com/market-data/quotes/GOOGL', { Accept: 'text/html' });

console.log('\nprobe-sources(fundamentals): done');
