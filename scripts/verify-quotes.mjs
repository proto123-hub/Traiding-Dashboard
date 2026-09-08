#!/usr/bin/env node
// Cross-check the per-source quote map and stamp verified flags.
// Comparator-style logic: verified=true iff ANY PAIR of distinct perSource
// values agrees within tolerance (Fix B, 2026-08-18 — see
// reports/designs/2026-08-18-scraper-fix.md) — not the old "all sources in
// range" check, which let one stale/outlier source (e.g. a carried-forward
// Yahoo miss) un-verify a symbol that two good sources already agreed on.
// `deltaPct` in the report is the tightest (best-agreeing) pairwise delta.
//
// Session-aware since 2026-08-18 (reports/designs/2026-08-18-session-aware-quotes.md):
// tolerance is resolved per symbol from row.assetClass against
// pq.toleranceByClass (falls back to a synthesized map for files written
// before this field existed). `extended` (a live pre/after-hours print, when
// present) is verified independently from `regular` — the two are never
// compared against each other.

import { readJson, writeJsonAtomic, nowIso, todayUtc } from './lib/io.mjs';

// Publication priority, mirroring scripts/scrape-quotes.mjs. Kept in sync by
// hand rather than shared, per the house convention of duplicating small pure
// helpers between the zero-dependency scripts.
const SOURCE_PRIORITY = ['nasdaq', 'cboe', 'cnbc', 'kapture'];

// The published price must come from the sources that AGREE, not from a fixed
// priority order — otherwise a lone outlier reaches the dashboard under a
// verified:true flag, which is exactly the claim that flag is supposed to make
// impossible. scrape-quotes.mjs does this at write time; this script is also
// runnable standalone (and after a Kapture import), so it has to re-bind the
// price too or that path silently reintroduces the bug.
function consensusCluster(perSource, tolerance) {
    const names = SOURCE_PRIORITY.filter(n => perSource[n] != null);
    const agree = (a, b) => {
        const x = perSource[a], y = perSource[b];
        return Math.abs(x - y) / Math.max(Math.min(x, y), 1e-6) <= tolerance;
    };
    let best = [];
    for (let mask = 1; mask < (1 << names.length); mask++) {
        const subset = names.filter((_, i) => mask & (1 << i));
        if (subset.length < 2 || subset.length <= best.length) continue;
        let mutual = true;
        for (let i = 0; i < subset.length && mutual; i++) {
            for (let j = i + 1; j < subset.length; j++) {
                if (!agree(subset[i], subset[j])) { mutual = false; break; }
            }
        }
        if (mutual) best = subset;
    }
    return { verified: best.length >= 2, cluster: best };
}

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
    const toleranceByClass = pq.toleranceByClass || { equity: pq.tolerance ?? 0.002, index: 0.005, fx: 0.001 };
    const compare = [];
    let verifiedCount = 0;
    let failedCount = 0;

    for (const [sym, row] of Object.entries(pq.quotes || {})) {
        const cls = row.assetClass || 'equity';
        const tolerance = toleranceByClass[cls] ?? pq.tolerance ?? 0.002;
        const sources = row.perSource || {};
        const entries = Object.entries(sources).filter(([, v]) => v != null);
        if (entries.length < 2) {
            row.verified = false;
            failedCount++;
            compare.push({ symbol: sym, status: 'single-source', assetClass: cls, sources: Object.keys(sources) });
        } else {
            const perSource = Object.fromEntries(entries);
            const { verified: ok, minDelta } = pairwiseVerify(perSource, tolerance);
            const { cluster } = consensusCluster(perSource, tolerance);
            row.verified = ok;
            row.sourceCount = entries.length;
            if (ok && cluster.length >= 2) {
                // Re-bind the published price to the agreeing cluster, and record
                // who agreed / who dissented, so a standalone run cannot leave a
                // dissenting price sitting under verified:true.
                const winner = SOURCE_PRIORITY.find(n => cluster.includes(n));
                if (winner != null && perSource[winner] != null) row.price = perSource[winner];
                row.verifiedBy = cluster;
                const outliers = Object.keys(perSource).filter(n => !cluster.includes(n));
                if (outliers.length) row.outlierSources = outliers; else delete row.outlierSources;
            } else {
                delete row.verifiedBy;
                delete row.outlierSources;
            }
            if (ok) verifiedCount++; else failedCount++;
            compare.push({
                symbol: sym,
                status: ok ? 'verified' : 'mismatch',
                deltaPct: Number.isFinite(minDelta) ? +minDelta.toFixed(5) : null,
                tolerance,
                assetClass: cls,
                sources: Object.fromEntries(entries)
            });
        }

        // extended is a sibling of the regular close — verified independently,
        // same assetClass tolerance, never blended into the compare[] entry above.
        if (row.extended?.perSource) {
            const extEntries = Object.entries(row.extended.perSource).filter(([, v]) => v != null);
            if (extEntries.length >= 2) {
                const { verified: extOk, minDelta: extDelta } = pairwiseVerify(Object.fromEntries(extEntries), tolerance);
                row.extended.verified = extOk;
                compare.push({
                    symbol: sym,
                    scope: 'extended',
                    status: extOk ? 'verified' : 'mismatch',
                    deltaPct: Number.isFinite(extDelta) ? +extDelta.toFixed(5) : null,
                    tolerance,
                    assetClass: cls,
                    sources: Object.fromEntries(extEntries)
                });
            } else {
                row.extended.verified = false;
            }
        }
    }

    pq.updated = nowIso();
    await writeJsonAtomic('data/price-quotes.json', pq);

    const out = {
        agent: 'comparator',
        runAt: nowIso(),
        asOfDate: todayUtc(),
        tolerance: pq.tolerance ?? toleranceByClass.equity,
        toleranceByClass,
        summary: { verified: verifiedCount, failed: failedCount, total: verifiedCount + failedCount },
        compare
    };
    await writeJsonAtomic(`reports/validation/${todayUtc()}-compare.json`, out);

    console.log(`verify-quotes: ${verifiedCount} verified, ${failedCount} failed (per-class tolerance)`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
