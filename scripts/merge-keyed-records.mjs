#!/usr/bin/env node
// Merge a `{ …meta, <container>: { <key>: record } }` data file as a RECORD
// store rather than a snapshot. Used for data/price-quotes.json (`quotes`,
// keyed by ticker) and data/fundamentals.json (`fundamentals`, same).
//
// The third file in this repo to need this, after news-feed.json (union by id)
// and the yields shards (upsert by country/tenor/date). The shape of the bug is
// identical every time: the refresh replay restores this run's whole file, and
// for anything that is a keyed store rather than a snapshot that drops records
// a competing run wrote. Reproduced end to end — base GOOGL 100 / CLS 200, this
// run moved GOOGL to 101, a competing run moved CLS to 202, and restoring our
// file wholesale put CLS back to 200 with its old session date, while
// checkQuotes() reported zero failures and zero warnings. A quote table missing
// an update it never saw is a perfectly valid quote table.
//
// The rule here is a delta, not a preference: take the competing run's file,
// then overlay only the tickers THIS run actually changed between BASE and its
// own commit. A ticker this run did not touch keeps whatever origin has, even
// if origin's is older — this run has no observation of it to offer.
//
// Usage: node scripts/merge-keyed-records.mjs <container> <base.json> <theirs.json> <ours.json>
//        (writes the merged result over <ours.json>)

import { readFile, writeFile } from 'node:fs/promises';

/** theirs, with the records ours changed relative to base laid over the top. */
export function mergeRecords(container, base, theirs, ours) {
    const bq = base?.[container] ?? {}, tq = theirs?.[container] ?? {}, oq = ours?.[container] ?? {};
    const merged = { ...tq };
    for (const [key, row] of Object.entries(oq)) {
        if (JSON.stringify(bq[key]) !== JSON.stringify(row)) merged[key] = row;
    }
    // A record this run DELETED (present in base, gone from ours) is dropped
    // only if the competing run left it as base had it — otherwise their newer
    // record stands.
    for (const key of Object.keys(bq)) {
        if (!(key in oq) && JSON.stringify(tq[key]) === JSON.stringify(bq[key])) delete merged[key];
    }
    // Everything outside the container is run metadata; the newer run's wins.
    const newer = (ours?.updated ?? '') >= (theirs?.updated ?? '') ? ours : theirs;
    return { ...newer, [container]: merged };
}

async function main() {
    const [container, basePath, theirsPath, oursPath] = process.argv.slice(2);
    if (!container || !basePath || !theirsPath || !oursPath) {
        console.error('usage: merge-keyed-records.mjs <container> <base.json> <theirs.json> <ours.json>');
        process.exit(2);
    }
    const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
    const [base, theirs, ours] = await Promise.all([read(basePath), read(theirsPath), read(oursPath)]);
    const out = mergeRecords(container, base, theirs, ours);
    const kept = Object.keys(out[container]).length;
    const fromThem = Object.keys(out[container])
        .filter(k => JSON.stringify(out[container][k]) === JSON.stringify(theirs?.[container]?.[k])
            && JSON.stringify(theirs?.[container]?.[k]) !== JSON.stringify(ours?.[container]?.[k])).length;
    await writeFile(oursPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`merge-keyed-records: ${container} -> ${kept} records (${fromThem} kept from the competing run)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
