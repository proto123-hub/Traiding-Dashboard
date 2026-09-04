#!/usr/bin/env node
// Collapse duplicate ids in data/news-feed.json, keeping the EARLIEST
// collectedAt for each.
//
// Why this exists as a shared script rather than an inline snippet: the same
// dedupe is needed by data-refresh.yml's replay path and by every hand
// resolution of a news-feed merge, and it had been written three times with
// three different semantics. Two of them said "keep the first occurrence",
// which is array order, not time order — and on 2026-08-24 that left two
// records holding a collectedAt 3 minutes LATER than the same id's first
// observation, because git had ordered the incoming side first.
//
// `collectedAt` means "when a scraper run first saw this item". Keeping the
// earliest is the only reading consistent with that; keeping whichever copy
// git happened to place first is not a rule at all. Order-independent, so two
// merges of the same two feeds cannot disagree.
//
// validate-data.mjs check [7] asserts the RESULT (ids are unique). It cannot
// assert the RETENTION, because once a later duplicate is dropped the evidence
// that an earlier one existed is gone. That is why the rule lives here, in the
// writer, and is tested here.
//
// Usage:
//   node scripts/dedupe-news-feed.mjs             # rewrite in place if needed
//   node scripts/dedupe-news-feed.mjs --check     # exit 1 if duplicates exist

import { readFile, writeFile } from 'node:fs/promises';

const PATH = 'data/news-feed.json';

/**
 * One record per id, each the earliest-collected copy. Input order does not
 * affect the result. Records with no collectedAt lose to any record that has
 * one, and fall back to first-seen among themselves.
 */
export function dedupeByEarliest(items) {
    const best = new Map();
    for (const it of items) {
        if (!it || it.id == null) continue;
        const prev = best.get(it.id);
        if (prev === undefined) { best.set(it.id, it); continue; }
        const a = prev.collectedAt, b = it.collectedAt;
        if (a == null && b != null) best.set(it.id, it);
        else if (a != null && b != null && b < a) best.set(it.id, it);
    }
    return [...best.values()];
}

async function main() {
    const check = process.argv.includes('--check');
    const feed = JSON.parse(await readFile(PATH, 'utf8'));
    const items = feed.items || [];
    const deduped = dedupeByEarliest(items);
    const dropped = items.length - deduped.length;

    // Also report records that are unique but not the earliest copy present —
    // impossible after this runs, but worth naming when --check is used on a
    // feed some other writer produced.
    if (dropped === 0) {
        console.log(`news-feed: ${items.length} items, no duplicate ids`);
        return;
    }
    if (check) {
        console.error(`news-feed: ${dropped} duplicate id(s) among ${items.length} items`);
        process.exit(1);
    }
    await writeFile(PATH, JSON.stringify({ ...feed, items: deduped }, null, 2) + '\n', 'utf8');
    console.log(`news-feed: ${items.length} -> ${deduped.length} (dropped ${dropped}, kept earliest collectedAt)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
