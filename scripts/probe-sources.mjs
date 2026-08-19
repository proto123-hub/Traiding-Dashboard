#!/usr/bin/env node
// Diagnostic probe — dumps RAW upstream responses so source adapters can be
// grounded in what actually answers from a runner IP. The dev sandbox cannot
// reach any of these hosts (EGRESS_BLOCKED at the proxy), so this is the only
// way to settle reachability and payload shape.
//
// Run via the TEMP step in .github/workflows/data-refresh.yml (workflow_dispatch)
// and read the job log. Writes nothing. Delete once its findings are recorded
// under reports/validation/.
//
// Round 3 (2026-08-19): phase-3 time-series sources — sovereign yields, memory
// share, NAND pricing. Candidate list from
// reports/raw/2026-08-19-timeseries-source-scout.json.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// head: how much body to show. CSV wants the first lines AND the last lines
// (the last row is the newest observation and proves history depth).
async function probe(label, url, { head = 400, tail = 0, headers = {} } = {}) {
    const t0 = Date.now();
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
        const text = await res.text();
        const ms = Date.now() - t0;
        const ct = res.headers.get('content-type') || '?';
        let body = text.slice(0, head);
        if (tail > 0 && text.length > head + tail) {
            body += `\n…[${text.length - head - tail} chars]…\n` + text.slice(-tail);
        } else if (text.length > head) {
            body += `\n…[truncated ${text.length - head} chars]`;
        }
        console.log(`\n===== ${label}\n      HTTP ${res.status} · ${ct} · ${text.length}B · ${ms}ms · ${res.url}\n${body}`);
    } catch (e) {
        console.log(`\n===== ${label}\n      FETCH ERROR (${Date.now() - t0}ms) · ${url}\n${e.message}`);
    }
}

console.log(`probe-sources(phase3): runAt=${new Date().toISOString()}`);

// --- Sovereign yields: FRED graph CSV (key-less, distinct from the FRED API) ---
console.log('\n########## 1. FRED fredgraph.csv — key-less? ##########');
for (const id of ['DGS10', 'DGS2', 'DGS30']) {
    await probe(`fred ${id} (US daily)`, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { head: 220, tail: 180 });
}
// One CSV mechanism for every non-US leg, if the OECD series resolve.
for (const [cc, name] of [['DE', 'Germany'], ['FR', 'France'], ['IT', 'Italy'], ['GB', 'UK'], ['JP', 'Japan']]) {
    await probe(`fred IRLTLT01${cc}M156N (${name} 10y monthly)`,
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRLTLT01${cc}M156N`, { head: 200, tail: 180 });
}

// --- Official national sources (daily, multi-maturity) ---
console.log('\n########## 2. Official national feeds ##########');
await probe('us treasury daily par yield curve 2026',
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv',
    { head: 350, tail: 200 });
await probe('japan MoF jgbcme.csv (english)', 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv', { head: 300, tail: 200 });
await probe('japan MoF jgbcm.csv', 'https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv', { head: 300, tail: 200 });

// --- Euro-area / UK per-country ---
console.log('\n########## 3. Eurostat / ECB / BoE ##########');
await probe('eurostat irt_lt_mcby_m (10y by country, monthly)',
    'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/irt_lt_mcby_m?format=JSON&lang=EN', { head: 500 });
// NOTE: ECB YC is the euro-area AGGREGATE curve, not per-country — probed only
// to confirm that, so a later pass does not waste a cycle rediscovering it.
await probe('ecb YC 10y (euro-area aggregate — expected wrong granularity)',
    'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?lastNObservations=5&format=csvdata', { head: 350 });
await probe('boe IADB IUAAMNPY (10y nominal par)',
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&SeriesCodes=IUAAMNPY&UsingCodes=Y&CSVF=TN&Datefrom=01/Jan/2024&Dateto=01/Jan/2027',
    { head: 300, tail: 150 });

// --- Memory share / NAND pricing: is any of it machine-readable? ---
console.log('\n########## 4. Memory share + NAND pricing ##########');
await probe('trendforce press release (HBM/DRAM share)', 'https://www.trendforce.com/presscenter/news/20260601-13070.html', { head: 600 });
await probe('trendforce presscenter index', 'https://www.trendforce.com/presscenter', { head: 300 });
await probe('counterpoint DRAM/HBM share', 'https://counterpointresearch.com/en/insights/global-dram-and-hbm-market-share', { head: 400 });
await probe('trendforce DRAM spot price page', 'https://www.trendforce.com/price/dram/dram_spot', { head: 400 });
await probe('dramexchange market activity', 'https://www.dramexchange.com/Market/market_activity', { head: 400 });
await probe('fred PCU33443344 (semis PPI — macro proxy only)',
    'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU33443344', { head: 180, tail: 150 });

console.log('\nprobe-sources(phase3): done');
