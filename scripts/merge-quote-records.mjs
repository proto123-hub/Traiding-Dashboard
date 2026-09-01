#!/usr/bin/env node
// Merge data/price-quotes.json as a RECORD store keyed by ticker.
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
// Usage: node scripts/merge-quote-records.mjs <base.json> <theirs.json> <ours.json>
//        (writes the merged result over <ours.json>)

import { readFile, writeFile } from 'node:fs/promises';

/** theirs, with the tickers ours changed relative to base laid over the top. */
export function mergeQuotes(base, theirs, ours) {
    const bq = base?.quotes ?? {}, tq = theirs?.quotes ?? {}, oq = ours?.quotes ?? {};
    const quotes = { ...tq };
    for (const [sym, row] of Object.entries(oq)) {
        if (JSON.stringify(bq[sym]) !== JSON.stringify(row)) quotes[sym] = row;
    }
    // A ticker this run DELETED (present in base, gone from ours) is dropped
    // only if the competing run left it as base had it — otherwise their newer
    // record stands.
    for (const sym of Object.keys(bq)) {
        if (!(sym in oq) && JSON.stringify(tq[sym]) === JSON.stringify(bq[sym])) delete quotes[sym];
    }
    // Everything outside `quotes` is run metadata; the newer run's wins.
    const newer = (ours?.updated ?? '') >= (theirs?.updated ?? '') ? ours : theirs;
    return { ...newer, quotes };
}

async function main() {
    const [basePath, theirsPath, oursPath] = process.argv.slice(2);
    if (!basePath || !theirsPath || !oursPath) {
        console.error('usage: merge-quote-records.mjs <base.json> <theirs.json> <ours.json>');
        process.exit(2);
    }
    const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
    const [base, theirs, ours] = await Promise.all([read(basePath), read(theirsPath), read(oursPath)]);
    const merged = mergeQuotes(base, theirs, ours);
    const kept = Object.keys(merged.quotes).length;
    const fromThem = Object.keys(merged.quotes)
        .filter(s => JSON.stringify(merged.quotes[s]) === JSON.stringify(theirs?.quotes?.[s])
            && JSON.stringify(theirs?.quotes?.[s]) !== JSON.stringify(ours?.quotes?.[s])).length;
    await writeFile(oursPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    console.log(`merge-quote-records: ${kept} tickers (${fromThem} kept from the competing run)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
