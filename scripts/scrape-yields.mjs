#!/usr/bin/env node
// Scrape sovereign 10Y yields: US Treasury (daily, full curve) + Japan MoF
// jgbcme.csv (daily, current month only) + Eurostat irt_lt_mcby_m (monthly,
// DE/FR/IT). Upserts data/history/yields-YYYY.json (dedupe-by
// country|tenor|date, last-write-wins) and regenerates
// data/history/yields-latest.json (wholesale trailing 24mo slice) every run.
// See reports/designs/2026-08-19-phase3-trackers.md §1a/§1b and
// reports/validation/2026-08-19-phase3-source-probe.md for the schema/source
// rationale this follows.
//
// FRED is DEAD from GitHub-runner IPs — all 8 candidate fredgraph.csv
// requests (DGS10/DGS2/DGS30 + 5 OECD IRLTLT01<CC>M156N series) timed out at
// 8s with no HTTP response at all (the connection itself never completes).
// Do NOT re-add a FRED adapter without re-probing from a runner IP first.
//
// UK is NOT scraped here. The BoE IADB endpoint
// (bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp, key-less,
// reachable) was tried with series code IUAAMNPY, which returns the ANNUAL
// average (2 rows total: 31 Dec 2024, 31 Dec 2025) — not a daily/monthly
// series usable for this tracker. UK stays a curated row (source:"manual",
// identical row shape) until a correct BoE series code is found — see the
// design doc §15.
//
// HBM share / NAND pricing are NOT scraped anywhere — every reachable
// source (TrendForce, Counterpoint, DRAMeXchange) is an HTML marketing page,
// not a machine-readable feed. Those stay collector→validator curated; see
// data/history/hbm-share.json / nand-price.json.

import { readJson, writeJsonAtomic, nowIso, todayUtc, withTimeout } from './lib/io.mjs';

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WINDOW_MONTHS = 24;
const P3_COUNTRIES = ['US', 'DE', 'FR', 'IT', 'UK', 'JP'];

async function fetchText(url, headers = {}) {
    return withTimeout(async (signal) => {
        const res = await fetch(url, { signal, headers: { 'User-Agent': UA, ...headers } });
        if (!res.ok) throw new Error(`http_${res.status}`);
        return await res.text();
    }, TIMEOUT_MS, url);
}

// Minimal CSV line parser — handles quoted fields (Treasury quotes maturity
// headers like "10 Yr"; MoF's CSV does not, but the parser is source-agnostic).
export function parseCsvLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
            else cur += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { out.push(cur); cur = ''; }
            else cur += c;
        }
    }
    out.push(cur);
    return out;
}

// ---------- US Treasury daily par yield curve ----------
// Year is in BOTH the URL path and the field_tdr_date_value query param —
// parameterized so this keeps working when the calendar year rolls over.
export function treasuryUrl(year) {
    return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

// MM/DD/YYYY -> YYYY-MM-DD
export function parseMdyDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim());
    if (!m) return null;
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Resolves the "10 Yr" column by header text, not position — column order
// has shifted before (e.g. a "4 Mo" maturity was added later) and a
// position-based read would silently start reading the wrong maturity.
export function parseTreasuryCsv(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]).map(h => h.trim());
    const dateIdx = header.findIndex(h => h.toLowerCase() === 'date');
    const tenIdx = header.findIndex(h => h === '10 Yr');
    if (dateIdx === -1 || tenIdx === -1) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        const cols = parseCsvLine(line);
        const date = parseMdyDate(cols[dateIdx]);
        const y = parseFloat(cols[tenIdx]);
        if (!date || !Number.isFinite(y)) continue;
        rows.push({ date, yield: y });
    }
    return rows;
}

// ---------- Japan MoF jgbcme.csv (English) ----------
// YYYY/M/D -> YYYY-MM-DD
export function parseMofDate(s) {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec((s || '').trim());
    if (!m) return null;
    const [, yyyy, mm, dd] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// First line is a title row ("Interest Rate (August 2026)"), last lines are
// a blank row and a notice — both are skipped naturally: we start scanning
// AFTER the header line (found by content, not a fixed index), and any row
// whose first column doesn't parse as a YYYY/M/D date (the notice text) is
// dropped rather than crashing the run.
export function parseMofCsv(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    const headerIdx = lines.findIndex(l => parseCsvLine(l)[0]?.trim() === 'Date');
    if (headerIdx === -1) return [];
    const header = parseCsvLine(lines[headerIdx]).map(h => h.trim());
    const tenIdx = header.findIndex(h => h === '10Y');
    if (tenIdx === -1) return [];
    const rows = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        const cols = parseCsvLine(line);
        const date = parseMofDate(cols[0]);
        if (!date) continue; // skips the trailing notice row
        const y = parseFloat(cols[tenIdx]);
        if (!Number.isFinite(y)) continue;
        rows.push({ date, yield: y });
    }
    return rows;
}

// ---------- Eurostat irt_lt_mcby_m (JSON-stat 2.0) ----------
// `value` is a flat object keyed by an integer offset computed row-major
// over `id`/`size`, with the LAST dimension in `id` varying fastest (the
// JSON-stat 2.0 spec) — decode it properly rather than index-guessing.
export function decodeJsonStat(js) {
    const ids = js.id || [];
    const sizes = js.size || [];
    if (!ids.length || ids.length !== sizes.length) return [];
    const dimCodesByPos = ids.map((id, i) => {
        const idxObj = js.dimension?.[id]?.category?.index;
        if (!idxObj) return [];
        const entries = Array.isArray(idxObj)
            ? idxObj.map((code, offset) => [offset, code])
            : Object.entries(idxObj).map(([code, offset]) => [Number(offset), code]);
        entries.sort((a, b) => a[0] - b[0]);
        const arr = new Array(sizes[i]);
        entries.forEach(([offset, code]) => { arr[offset] = code; });
        return arr;
    });
    const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1));
    const total = sizes.reduce((a, b) => a * b, 1);
    const out = [];
    for (let flat = 0; flat < total; flat++) {
        const raw = js.value[flat] ?? js.value[String(flat)];
        if (raw == null) continue; // sparse dataset — no observation at this cell
        const rec = { value: raw };
        for (let d = 0; d < ids.length; d++) {
            const idx = Math.floor(flat / strides[d]) % sizes[d];
            rec[ids[d]] = dimCodesByPos[d][idx];
        }
        out.push(rec);
    }
    return out;
}

// Eurostat's "time" dimension is a YYYY-MM label for this monthly series —
// mapped to that month's last calendar day as the row's reference `date`,
// matching assets-history.json's existing "always month-end" convention.
export function monthEndDate(yyyyMM) {
    const m = /^(\d{4})-(\d{2})$/.exec(yyyyMM || '');
    if (!m) return null;
    const [, y, mo] = m;
    const last = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
    return `${y}-${mo}-${String(last).padStart(2, '0')}`;
}

export function extractEurostatDeFrIt(js) {
    const decoded = decodeJsonStat(js);
    const wanted = new Set(['DE', 'FR', 'IT']);
    return decoded
        .filter(r => wanted.has(r.geo) && typeof r.value === 'number')
        .map(r => ({ country: r.geo, date: monthEndDate(r.time), yield: r.value }))
        .filter(r => r.date);
}

// ---------- Dedupe-by-(country,tenor,date) upsert ----------
function rowKey(r) { return `${r.country}|${r.tenor}|${r.date}`; }

export function upsertRow(rows, newRow) {
    const idx = rows.findIndex(r => rowKey(r) === rowKey(newRow));
    if (idx >= 0) rows[idx] = newRow;   // last-write-wins, wholesale replace
    else rows.push(newRow);
    return rows;
}

function sortRows(rows) {
    rows.sort((a, b) =>
        a.country.localeCompare(b.country) ||
        a.tenor.localeCompare(b.tenor) ||
        a.date.localeCompare(b.date));
    return rows;
}

async function main() {
    const ts = nowIso();
    const today = todayUtc();
    const year = Number(today.slice(0, 4));
    const failures = [];
    const newRows = [];
    const rawDrop = { agent: 'refresher', runAt: ts, asOfDate: today, perSourceRaw: {}, failures };

    // --- US: Treasury daily par yield curve ---
    try {
        const url = treasuryUrl(year);
        const text = await fetchText(url);
        const parsed = parseTreasuryCsv(text);
        rawDrop.perSourceRaw.treasury = { url, rowCount: parsed.length, latest: parsed[parsed.length - 1] || null };
        parsed.forEach(p => newRows.push({
            date: p.date, country: 'US', tenor: '10y', yield: p.yield,
            source: 'treasury-csv', agent: 'refresher', collectedAt: ts,
        }));
    } catch (e) {
        failures.push({ country: 'US', source: 'treasury-csv', reason: e.message });
    }

    // --- Japan: MoF jgbcme.csv (English, current month only) ---
    try {
        const url = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv';
        const text = await fetchText(url);
        const parsed = parseMofCsv(text);
        rawDrop.perSourceRaw.mof = { url, rowCount: parsed.length, latest: parsed[parsed.length - 1] || null };
        parsed.forEach(p => newRows.push({
            date: p.date, country: 'JP', tenor: '10y', yield: p.yield,
            source: 'mof-jgbcme-csv', agent: 'refresher', collectedAt: ts,
        }));
    } catch (e) {
        failures.push({ country: 'JP', source: 'mof-jgbcme-csv', reason: e.message });
    }

    // --- DE/FR/IT: Eurostat irt_lt_mcby_m (monthly, JSON-stat) ---
    try {
        const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/irt_lt_mcby_m?format=JSON&lang=EN';
        const text = await fetchText(url);
        const json = JSON.parse(text);
        const parsed = extractEurostatDeFrIt(json);
        rawDrop.perSourceRaw.eurostat = { url, rowCount: parsed.length };
        parsed.forEach(p => newRows.push({
            date: p.date, country: p.country, tenor: '10y', yield: p.yield,
            source: 'eurostat-irt_lt_mcby_m', agent: 'refresher', collectedAt: ts,
        }));
    } catch (e) {
        failures.push({ country: 'DE/FR/IT', source: 'eurostat-irt_lt_mcby_m', reason: e.message });
    }

    // UK: intentionally not fetched here — see header comment. A collector/
    // human curator can backfill UK rows with source:"manual" using the
    // identical row shape; nothing downstream needs to change when they do.

    // --- Upsert into per-year shards (dedupe-by country|tenor|date) ---
    const byYear = new Map();
    for (const row of newRows) {
        const y = row.date.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(row);
    }
    for (const [y, rowsForYear] of byYear) {
        const shardPath = `data/history/yields-${y}.json`;
        let shard;
        try { shard = await readJson(shardPath); } catch { shard = { rows: [] }; }
        const rows = shard.rows || [];
        rowsForYear.forEach(r => upsertRow(rows, r));
        sortRows(rows);
        await writeJsonAtomic(shardPath, {
            note: 'Owned by refresher agent + GitHub Actions data-refresh workflow (scripts/scrape-yields.mjs). Daily sovereign 10Y yield table, sharded one file per calendar year to keep any single file small. DEDUPE-BY-DATE, not append-only: each run UPSERTS one row per (country,tenor,date) key — if that exact key already has a row, the new row REPLACES it wholesale (last-write-wins on same-day double-writes, e.g. the 21:00 UTC post-close cron overwriting the 11:00 UTC pre-market cron\'s same-date row); rows are never duplicated for the same key. The row shape is IDENTICAL whether refresher-scraped or collector/human-curated (e.g. UK, source:"manual") — only source/agent differ.',
            year: Number(y),
            updated: ts,
            agent: 'refresher',
            rows,
        });
    }

    // --- Regenerate yields-latest.json (wholesale, trailing WINDOW_MONTHS) ---
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - WINDOW_MONTHS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const sourceYears = [...new Set([year, year - 1])].sort();
    const sourceFiles = sourceYears.map(y => `history/yields-${y}.json`);
    let allRows = [];
    for (const y of sourceYears) {
        try {
            const shard = await readJson(`data/history/yields-${y}.json`);
            allRows = allRows.concat(shard.rows || []);
        } catch { /* shard doesn't exist yet — fine, first run for that year */ }
    }
    const series = {};
    for (const c of P3_COUNTRIES) {
        const pts = allRows
            .filter(r => r.country === c && r.tenor === '10y' && r.date >= cutoffStr)
            .map(r => ({ date: r.date, yield: r.yield }))
            .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
        series[c] = { '10y': pts }; // present with an empty array, not omitted, when nothing scraped yet
    }
    await writeJsonAtomic('data/history/yields-latest.json', {
        note: 'Derived by scripts/scrape-yields.mjs each run from the current + prior year\'s history/yields-YYYY.json shards — a trailing ~24-month slice, regenerated WHOLESALE (not appended) every run, same shielding pattern as data/news-latest.json relative to data/news-feed.json. This is the ONLY yield file index.html fetches. Per-row provenance (source/agent/collectedAt) is dropped here to keep the file small — full provenance lives in the yearly shards.',
        updated: ts,
        agent: 'refresher',
        sourceFiles,
        windowMonths: WINDOW_MONTHS,
        asOf: today,
        series,
    });

    await writeJsonAtomic(`reports/raw/${today}-yields.json`, rawDrop);

    console.log(`scrape-yields: ${newRows.length} rows fetched (${Object.keys(rawDrop.perSourceRaw).length} sources ok), ${failures.length} failures`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
