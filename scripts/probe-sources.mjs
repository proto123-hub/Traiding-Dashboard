#!/usr/bin/env node
// Diagnostic probe — dumps RAW upstream payloads for a few symbols so we can
// see each source's actual field names/semantics from a runner IP. The sandbox
// used for development cannot reach any finance host, so this is the only way
// to ground source-adapter decisions in real data.
//
// Run via .github/workflows/probe-sources.yml (workflow_dispatch). Read the job
// log. Writes nothing.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SYMS = ['SOXL', 'MRVL', 'GOOGL'];

function show(label, text, limit = 1600) {
    const body = text.length > limit ? text.slice(0, limit) + `\n…[truncated ${text.length - limit} chars]` : text;
    console.log(`\n===== ${label} =====\n${body}`);
}

async function probe(label, url, headers = {}) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
        const text = await res.text();
        show(`${label} — HTTP ${res.status} — ${url}`, text);
    } catch (e) {
        console.log(`\n===== ${label} — FETCH ERROR — ${url} =====\n${e.message}`);
    }
}

console.log(`probe-sources: runAt=${new Date().toISOString()}`);

for (const s of SYMS) {
    await probe(`cboe ${s}`, `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${s}.json`,
        { Accept: 'application/json', Referer: 'https://www.cboe.com/' });
    await probe(`nasdaq ${s}`, `https://api.nasdaq.com/api/quote/${s}/info?assetclass=stocks`,
        { Accept: 'application/json' });
}

await probe('cboe _SPX', 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_SPX.json',
    { Accept: 'application/json', Referer: 'https://www.cboe.com/' });
await probe('cboe _TNX', 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_TNX.json',
    { Accept: 'application/json', Referer: 'https://www.cboe.com/' });

// Does Cboe expose an ETF/equity endpoint variant with a session marker?
await probe('cboe SOXL (options-style path)', 'https://cdn.cboe.com/api/global/delayed_quotes/options/SOXL.json',
    { Accept: 'application/json', Referer: 'https://www.cboe.com/' });

// Yahoo: is the 429 wall total, or does a warmed cookie + spark batch pass?
try {
    const warm = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
    const cookies = (warm.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    console.log(`\n===== yahoo warmup — HTTP ${warm.status} — cookie=${cookies ? cookies.slice(0, 80) + '…' : '(none)'} =====`);
    await probe('yahoo spark (cookie)', 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=SOXL,MRVL,GOOGL&range=2d&interval=1d',
        cookies ? { Cookie: cookies, Accept: 'application/json' } : { Accept: 'application/json' });
    await probe('yahoo v8 chart (cookie)', 'https://query2.finance.yahoo.com/v8/finance/chart/SOXL?range=2d&interval=1d',
        cookies ? { Cookie: cookies, Accept: 'application/json' } : { Accept: 'application/json' });
} catch (e) {
    console.log('yahoo probe error:', e.message);
}

// Stooq: is the 404 path-wide, or shape-specific?
await probe('stooq batch', 'https://stooq.com/q/l/?s=soxl.us+mrvl.us+googl.us&f=sd2t2ohlcv&h&e=csv',
    { Accept: 'text/csv,text/plain', Referer: 'https://stooq.com/' });
await probe('stooq single', 'https://stooq.com/q/l/?s=googl.us&f=sd2t2ohlcv&h&e=csv',
    { Accept: 'text/csv,text/plain', Referer: 'https://stooq.com/' });
await probe('stooq.pl mirror', 'https://stooq.pl/q/l/?s=googl.us&f=sd2t2ohlcv&h&e=csv',
    { Accept: 'text/csv,text/plain', Referer: 'https://stooq.pl/' });

await probe('cnbc indices', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=SOXL%7CMRVL%7C.SPX&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json',
    { Accept: 'application/json' });

console.log('\nprobe-sources: done');
