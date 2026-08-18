#!/usr/bin/env node
// Cross-check the per-source quote map and stamp verified flags.
// Comparator-style logic: verified=true iff ANY PAIR of distinct perSource
// values agrees within tolerance (Fix B, 2026-08-18 — see
// reports/designs/2026-08-18-scraper-fix.md) — not the old "all sources in
// range" check, which let one stale/outlier source (e.g. a carried-forward
// Yahoo miss) un-verify a symbol that two good sources already agreed on.
// `deltaPct` in the report is the tightest (best-agreeing) pairwise delta.

import { readJson, writeJsonAtomic, nowIso, todayUtc } from './lib/io.mjs';

// Fix B: verified iff ANY PAIR of distinct sources agrees within tolerance.
// Mirrors the identical helper in scripts/scrape-quotes.mjs.
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

async function main() {
    const pq = await readJson('data/price-quotes.json');
    const tolerance = pq.tolerance ?? 0.002;
    const compare = [];
    let verifiedCount = 0;
    let failedCount = 0;

    for (const [sym, row] of Object.entries(pq.quotes || {})) {
        const sources = row.perSource || {};
        const entries = Object.entries(sources).filter(([, v]) => v != null);
        if (entries.length < 2) {
            row.verified = false;
            failedCount++;
            compare.push({ symbol: sym, status: 'single-source', sources: Object.keys(sources) });
            continue;
        }
        const { verified: ok, minDelta } = pairwiseVerify(Object.fromEntries(entries), tolerance);
        row.verified = ok;
        row.sourceCount = entries.length;
        if (ok) verifiedCount++; else failedCount++;
        compare.push({
            symbol: sym,
            status: ok ? 'verified' : 'mismatch',
            deltaPct: Number.isFinite(minDelta) ? +minDelta.toFixed(5) : null,
            tolerance,
            sources: Object.fromEntries(entries)
        });
    }

    pq.updated = nowIso();
    await writeJsonAtomic('data/price-quotes.json', pq);

    const out = {
        agent: 'comparator',
        runAt: nowIso(),
        asOfDate: todayUtc(),
        tolerance,
        summary: { verified: verifiedCount, failed: failedCount, total: verifiedCount + failedCount },
        compare
    };
    await writeJsonAtomic(`reports/validation/${todayUtc()}-compare.json`, out);

    console.log(`verify-quotes: ${verifiedCount} verified, ${failedCount} failed (tolerance ${tolerance})`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
