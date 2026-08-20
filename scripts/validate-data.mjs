#!/usr/bin/env node
// Read-only integrity checks over the committed data layer. Runs no network
// calls and writes nothing, so it can attach a check to a PR head SHA.
//
// Why this exists: data-refresh.yml commits its own output, so its run always
// takes the PARENT as input and produces the head — the head SHA itself can
// never carry that workflow's check. A green refresh run is evidence the
// scrapers work, not evidence the committed tree is sound. This is the second.
//
// Assertions are the invariants the pipeline has actually violated before, not
// a generic schema walk:
//   - verified:true with fewer than 2 agreeing sources (the flag's whole claim)
//   - a published price that no source in verifiedBy backs
//   - forward P/E cross-verified across different EPS bases
//   - history rows duplicated on the same (country,tenor,date) key
// Exit 1 on any failure.

import { readFile, readdir } from 'node:fs/promises';

const fail = [];
const warn = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { fail.push(m); console.log(`  FAIL ${m}`); };

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

async function allJsonFiles(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...await allJsonFiles(p));
        else if (e.name.endsWith('.json')) out.push(p);
    }
    return out;
}

// --- 1. every data file parses -------------------------------------------
console.log('\n[1] JSON parse');
const files = await allJsonFiles('data');
for (const f of files) {
    try { await readJson(f); } catch (e) { bad(`${f}: ${e.message}`); }
}
if (!fail.length) ok(`${files.length} files parse`);

// --- 2. price-quotes: the verified flag must mean what it claims ----------
console.log('\n[2] price-quotes verified-flag integrity');
const pq = await readJson('data/price-quotes.json');
const tol = pq.toleranceByClass || { equity: 0.002, index: 0.005, fx: 0.001 };
let checked = 0;
for (const [sym, row] of Object.entries(pq.quotes || {})) {
    const per = Object.entries(row.perSource || {}).filter(([, v]) => v != null);
    if (row.verified) {
        checked++;
        if (per.length < 2) bad(`${sym}: verified:true with ${per.length} source(s)`);
        const t = tol[row.assetClass] ?? 0.002;
        const agrees = per.some(([a, x]) => per.some(([b, y]) =>
            a !== b && Math.abs(x - y) / Math.max(Math.min(x, y), 1e-6) <= t));
        if (per.length >= 2 && !agrees) bad(`${sym}: verified:true but no pair agrees within ${t}`);
        // the published price must come from a source that actually agreed
        if (Array.isArray(row.verifiedBy) && row.verifiedBy.length) {
            const backed = row.verifiedBy.some(n => row.perSource?.[n] === row.price);
            if (!backed) bad(`${sym}: published price ${row.price} is not any of verifiedBy ${JSON.stringify(row.verifiedBy)}`);
        }
    }
    if (row.changePct != null && row.prevClose == null) {
        warn.push(`${sym}: changePct without prevClose`);
    }
}
if (!fail.length) ok(`${checked} verified rows are backed by an agreeing pair`);

// --- 3. fundamentals: forward P/E is never cross-verified across bases ----
console.log('\n[3] fundamentals basis discipline');
try {
    const fu = await readJson('data/fundamentals.json');
    let fwd = 0;
    for (const [sym, r] of Object.entries(fu.fundamentals || {})) {
        if (r.notApplicable) continue;
        if (r.forwardVerified) {
            fwd++;
            const bases = new Set(Object.values(r.forwardPEByBasis || {}).map(b => b.basis).filter(Boolean));
            if (bases.size > 1) bad(`${sym}: forwardVerified across ${bases.size} different EPS bases`);
        }
        if (r.trailingVerified && r.trailingPE == null) bad(`${sym}: trailingVerified with null trailingPE`);
    }
    ok(`forward-verified entries: ${fwd} (all single-basis)`);
} catch { warn.push('data/fundamentals.json absent — skipped'); }

// --- 4. history: no duplicate key rows ------------------------------------
console.log('\n[4] history key uniqueness');
let shards = [];
try { shards = (await readdir('data/history')).filter(f => /^yields-\d{4}\.json$/.test(f)); } catch { /* none yet */ }
for (const f of shards) {
    const shard = await readJson(`data/history/${f}`);
    const seen = new Set();
    for (const r of shard.rows || []) {
        const k = `${r.country}|${r.tenor}|${r.date}`;
        if (seen.has(k)) bad(`data/history/${f}: duplicate row for ${k}`);
        seen.add(k);
    }
}
ok(`${shards.length} yield shards, no duplicate keys`);

// --- 5. valuations vs quotes: bands must not be on a stale split basis ----
console.log('\n[5] valuation band plausibility');
try {
    const val = (await readJson('data/valuations.json')).valuations || {};
    for (const [sym, v] of Object.entries(val)) {
        const px = pq.quotes?.[sym]?.price;
        if (px == null || v.fvMid == null) continue;
        const ratio = v.fvMid / px;
        // A band an order of magnitude away from a verified price is the
        // signature of an unadjusted stock split (KLAC sat at 10x for two
        // months before anyone noticed).
        if (ratio > 5 || ratio < 0.2) {
            bad(`${sym}: fvMid ${v.fvMid} vs verified price ${px} (${ratio.toFixed(1)}x) — check for an unadjusted split`);
        }
    }
    ok('no band is an order of magnitude off its price');
} catch { warn.push('data/valuations.json absent — skipped'); }

console.log('');
warn.forEach(w => console.log(`  warn ${w}`));
if (fail.length) {
    console.log(`\nvalidate-data: ${fail.length} FAILURES`);
    process.exit(1);
}
console.log(`validate-data: all checks passed (${warn.length} warnings)`);
