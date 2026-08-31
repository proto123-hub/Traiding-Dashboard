#!/usr/bin/env node
// Merge two data/history/yields-YYYY.json shards by (country, tenor, date).
//
// Why this exists: the refresh replay restores this run's version of each file
// it changed. For a whole-file snapshot like price-quotes.json that is right —
// ours is the newer observation of the same live state. For an UPSERT STORE it
// is data loss, and the yields shards are an upsert store: `scrape-yields.mjs`
// merges rows per (country, tenor, date), and the schema explicitly allows
// hand-curated rows (UK is one). Reproduced against a real bare origin: this
// run added UK|10y|2026-08-30, a competing run added UK|10y|2026-08-31 to the
// same shard, and restoring our file wholesale dropped theirs — with the
// validator passing all seven checks and zero warnings, because a shard missing
// a row it never knew about is a perfectly valid shard.
//
// The retention rule matches upsertRow's: re-observing the same value is not a
// change, so the EARLIEST collectedAt is kept; a genuinely different value is a
// new observation, so the LATER collectedAt wins.
//
// Usage: node scripts/merge-yields-shard.mjs <theirs.json> <ours.json>
//        (merges theirs into ours, in place)

import { readFile, writeFile } from 'node:fs/promises';

const keyOf = (r) => `${r.country}|${r.tenor}|${r.date}`;

export function mergeRows(theirs, ours) {
    const out = new Map();
    for (const r of theirs || []) if (r && r.country) out.set(keyOf(r), r);
    for (const r of ours || []) {
        if (!r || !r.country) continue;
        const k = keyOf(r);
        const prev = out.get(k);
        if (!prev) { out.set(k, r); continue; }
        const same = prev.yield === r.yield && prev.source === r.source;
        const prevAt = prev.collectedAt ?? '', rAt = r.collectedAt ?? '';
        // same value: earliest observation wins. different value: newest wins.
        out.set(k, same ? (prevAt <= rAt ? prev : r) : (rAt >= prevAt ? r : prev));
    }
    return [...out.values()].sort((a, b) =>
        a.date.localeCompare(b.date) || a.country.localeCompare(b.country) || a.tenor.localeCompare(b.tenor));
}

async function main() {
    const [theirsPath, oursPath] = process.argv.slice(2);
    if (!theirsPath || !oursPath) {
        console.error('usage: merge-yields-shard.mjs <theirs.json> <ours.json>');
        process.exit(2);
    }
    const theirs = JSON.parse(await readFile(theirsPath, 'utf8'));
    const ours = JSON.parse(await readFile(oursPath, 'utf8'));
    const rows = mergeRows(theirs.rows, ours.rows);
    const gained = rows.length - (ours.rows || []).length;
    await writeFile(oursPath, JSON.stringify({ ...ours, rows }, null, 2) + '\n', 'utf8');
    console.log(`merge-yields-shard: ${oursPath} -> ${rows.length} rows (${gained >= 0 ? '+' : ''}${gained} from the competing run)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
