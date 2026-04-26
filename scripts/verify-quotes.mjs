#!/usr/bin/env node
// Cross-check the per-source quote map and stamp verified flags.
// Comparator-style logic: if 2+ independent sources agree within tolerance,
// mark verified=true; else verified=false with reason in comparator drop.

import { readJson, writeJsonAtomic, nowIso, todayUtc } from './lib/io.mjs';

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
        const prices = entries.map(([, v]) => v);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const deltaPct = (max - min) / Math.max(min, 1e-6);
        const ok = deltaPct <= tolerance;
        row.verified = ok;
        row.sourceCount = entries.length;
        if (ok) verifiedCount++; else failedCount++;
        compare.push({
            symbol: sym,
            status: ok ? 'verified' : 'mismatch',
            deltaPct: +deltaPct.toFixed(5),
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
