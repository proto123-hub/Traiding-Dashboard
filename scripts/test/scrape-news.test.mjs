#!/usr/bin/env node
// Regression tests for the data/news-feed.json WRITER.
//
// validate-data.test.mjs covers the reader — checks over a feed that already
// exists. Nothing covered the path that produces it, and every defect this file
// pins was found by reading, not by a failing test:
//
//   - a missing feed was rebuilt from one day of headlines, exit 0
//   - `{"items": null}` parses, so the does-not-parse branch never fired, and
//     `feed.items = feed.items || []` turned 9,046 records into 0, exit 0
//   - NEWS_FEED_BOOTSTRAP=0 enabled bootstrap, because "0" is a truthy string
//   - the continuity gate compared one array's length to itself, so the branch
//     could not fire under any input
//
// Two kinds of case here. The `unit` cases call the exported gates directly.
// The `script` cases run scripts/scrape-news.mjs as a real subprocess in a
// temp directory with a real feed file on disk, and assert both the exit code
// and that the bytes on disk are unchanged — an exception that still wrote is
// not a refusal. The final case drives main() against a stubbed fetch, which
// is the only one that exercises the append and its superset gate.
//
// Provenance, on the same standard as validate-data.test.mjs: four of these
// were verified by re-introducing the defect and watching them go red —
// BOOTSTRAP=0, BOOTSTRAP=yes, items:null, and items missing all exited 0 under
// the pre-fix writer. The rest are not reproductions: the two gate functions
// did not exist before, so their unit cases pin the new behaviour rather than a
// hole that was open. `no bootstrap`, `does not parse` and the append case
// passed pre-fix too — they are there to keep the paths that already worked
// from being lost to a later edit, not as evidence of a bug.
//
// Run: node scripts/test/scrape-news.test.mjs

import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { feedShapeFaults, continuityFaults } from '../scrape-news.mjs';
import { NEWS_FEED_NOTE } from '../lib/io.mjs';

const run = promisify(execFile);
const REPO = process.cwd();
const SCRIPT = join(REPO, 'scripts/scrape-news.mjs');

const UNIVERSE = { tickers: [{ symbol: 'CLS' }] };
const FEED = {
    // The CANONICAL note, not a paraphrase. With a wrong note here every case
    // satisfied `noteWasWrong`, so the write happened for that reason and the
    // `collected.length > 0` arm was never exercised on its own — mutating the
    // condition to `if (noteWasWrong)` alone left the suite 15/15 green while
    // silently discarding every headline a real run collects. A fixture that
    // does not hold the contract cannot test code that branches on it.
    note: NEWS_FEED_NOTE,
    items: [
        { id: '2026-08-01-cls-alpha', ticker: 'CLS', headline: 'Alpha', collectedAt: '2026-08-01T00:00:00Z' },
        { id: '2026-08-02-cls-beta', ticker: 'CLS', headline: 'Beta', collectedAt: '2026-08-02T00:00:00Z' },
    ],
};

/** A temp repo root with the two files the scraper reads. `feed === null` = absent. */
async function scratch(feedText) {
    const dir = await mkdtemp(join(tmpdir(), 'news-writer-'));
    await mkdir(join(dir, 'data'), { recursive: true });
    await writeFile(join(dir, 'data/tickers-universe.json'), JSON.stringify(UNIVERSE), 'utf8');
    if (feedText !== null) await writeFile(join(dir, 'data/news-feed.json'), feedText, 'utf8');
    return dir;
}

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// Every variable the writer reads. The suite must not inherit them: a shell
// exporting NEWS_FEED_BOOTSTRAP=1 bootstrapped the missing feed the
// `no bootstrap` case requires to be REFUSED, and the suite went red with no
// code changed. Found by the PR #19 session; ported here.
const WRITER_ENV = ['NEWS_FEED_BOOTSTRAP'];
const envFor = (over = {}) => {
    const env = { ...process.env, ...over };
    for (const k of WRITER_ENV) if (!(k in over)) delete env[k];
    return env;
};
// The in-process cases call main() in THIS process, which reads this directly.
for (const k of WRITER_ENV) delete process.env[k];

let bad = 0;
const fail = (label, msg) => { console.log(`  FAIL ${label}: ${msg}`); bad++; };
const ok = (label, why) => console.log(`  ok   ${label} — ${why}`);

// ---------------------------------------------------------------- unit gates

const UNIT = [
    {
        label: 'feedShapeFaults: items null',
        run: () => feedShapeFaults({ note: 'x', items: null }),
        expect: '"items" is null',
        why: 'the shape that parsed, coalesced to [], and wiped the feed inside a green run',
    },
    {
        label: 'feedShapeFaults: items missing',
        run: () => feedShapeFaults({ note: 'x' }),
        expect: 'no "items" key',
        why: 'a truncated write leaves an object with no items at all',
    },
    {
        label: 'feedShapeFaults: items is an object',
        run: () => feedShapeFaults({ items: {} }),
        expect: '"items" is object',
        why: 'an object is not an array, and .length on it is undefined, not 0',
    },
    {
        label: 'feedShapeFaults: top level is an array',
        run: () => feedShapeFaults([]),
        expect: 'top level is an array',
        why: 'a bare item array would take the `items` key from nowhere',
    },
    {
        label: 'feedShapeFaults: valid feed',
        run: () => feedShapeFaults(FEED),
        expect: null,
        why: 'the committed shape is accepted',
    },
    {
        label: 'continuityFaults: an id read is absent from the write',
        run: () => continuityFaults(new Set(['a', 'b']), [{ id: 'b' }, { id: 'c' }]),
        expect: 'An append-only feed cannot lose records',
        why: 'the gate this replaces compared one array\'s length to itself and could not fire',
    },
    {
        label: 'continuityFaults: append is a superset',
        run: () => continuityFaults(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
        expect: null,
        why: 'the normal path stays silent',
    },
];

for (const c of UNIT) {
    const out = c.run();
    if (c.expect === null) {
        if (out.length) fail(c.label, `expected no fault, got: ${out.join('; ')}`);
        else ok(c.label, c.why);
        continue;
    }
    if (!out.length) fail(c.label, 'expected a fault, got none');
    else if (!out.some(f => f.includes(c.expect))) fail(c.label, `rejected, but no message contains "${c.expect}" — got: ${out.join('; ')}`);
    else ok(c.label, c.why);
}

// ------------------------------------------------------- script, real files

const SCRIPTS = [
    {
        label: 'missing feed, no bootstrap',
        feed: null,
        env: {},
        expect: 'is missing',
        why: 'absence of a committed file is a bad checkout, not a first run',
    },
    {
        label: 'missing feed, NEWS_FEED_BOOTSTRAP=0',
        feed: null,
        env: { NEWS_FEED_BOOTSTRAP: '0' },
        expect: 'is missing',
        why: '"0" is a truthy string; only "1" may enable a rebuild',
    },
    {
        label: 'missing feed, NEWS_FEED_BOOTSTRAP=1 creates one',
        feed: null,
        env: { NEWS_FEED_BOOTSTRAP: '1' },
        expect: null,          // the opt-in must SUCCEED, not refuse
        why: 'the deliberate opt-in is the only way a feed is created, so it has to work',
    },
    {
        label: 'missing feed, NEWS_FEED_BOOTSTRAP=yes',
        feed: null,
        env: { NEWS_FEED_BOOTSTRAP: 'yes' },
        expect: 'is missing',
        why: 'an opt-in this destructive takes exactly the value that spells it',
    },
    {
        label: 'feed does not parse',
        feed: '{"items": [',
        env: {},
        expect: 'does not parse',
        why: 'a truncated write must not be rebuilt from one day of headlines',
    },
    {
        label: 'feed parses, items null',
        feed: '{"note":"x","items":null}',
        env: {},
        expect: 'is not a news feed',
        why: 'corruption that happens to be valid JSON is as loud as corruption that is not',
    },
    {
        label: 'feed parses, items missing',
        feed: '{"note":"x"}',
        env: {},
        expect: 'is not a news feed',
        why: 'the gate runs before the network, while the feed is still what was on disk',
    },
];

for (const c of SCRIPTS) {
    const dir = await scratch(c.feed);
    const target = join(dir, 'data/news-feed.json');
    let code = 0, stderr = '';
    try {
        await run(process.execPath, [SCRIPT], { cwd: dir, env: envFor(c.env) });
    } catch (e) {
        code = e.code;
        stderr = `${e.stderr || ''}${e.stdout || ''}`;
    }
    if (c.expect === null) {
        // A success case. Exit 0 alone is not enough — an early return before
        // the feed is created passes that, so assert the artefact: a parseable
        // feed carrying the canonical note and an items array.
        let feed = null, why = null;
        if (code !== 0) why = `the deliberate opt-in was refused (exit ${code}): ${stderr.trim().slice(0, 200)}`;
        else if (!await exists(target)) why = 'exited 0 without creating data/news-feed.json — the opt-in did nothing';
        else {
            try { feed = JSON.parse(await readFile(target, 'utf8')); }
            catch (e) { why = `created a feed that does not parse: ${e.message}`; }
            if (feed && !Array.isArray(feed.items)) why = `created a feed whose items is ${typeof feed.items}`;
            else if (feed && feed.note !== NEWS_FEED_NOTE) why = `created a feed whose note is not the canonical contract: ${JSON.stringify(feed.note)}`;
        }
        if (why) fail(c.label, why); else ok(c.label, c.why);
        await rm(dir, { recursive: true, force: true });
        continue;
    }
    if (code === 0) {
        fail(c.label, 'exited 0 — the run reported success');
    } else if (!stderr.includes(c.expect)) {
        fail(c.label, `exited ${code}, but no message contains "${c.expect}" — got: ${stderr.trim().slice(0, 300)}`);
    } else if (c.feed === null && await exists(target)) {
        fail(c.label, 'refused, but created data/news-feed.json anyway');
    } else if (c.feed !== null && await readFile(target, 'utf8') !== c.feed) {
        fail(c.label, 'refused, but the file on disk changed — an exception that still wrote is not a refusal');
    } else {
        ok(c.label, c.why);
    }
    await rm(dir, { recursive: true, force: true });
}

// --------------------------------------------- append path, stubbed network
//
// The only case that reaches the write. Nothing else here can: with no network
// the scrape collects nothing and the writer is skipped, so a green run over
// the fail-closed cases says nothing about whether appending preserves history.

const RSS = (titles) => `<?xml version="1.0"?><rss><channel>${titles.map(t =>
    `<item><title><![CDATA[${t}]]></title><link>https://example.test/${encodeURIComponent(t)}</link>` +
    `<pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate><source url="https://example.test">Example Wire</source></item>`
).join('')}</channel></rss>`;

{
    const label = 'append preserves every id already on disk';
    const dir = await scratch(JSON.stringify(FEED, null, 2) + '\n');
    const realFetch = globalThis.fetch;
    const realCwd = process.cwd();
    globalThis.fetch = async () => new Response(RSS(['Gamma headline', 'Delta headline']), {
        status: 200, headers: { 'content-type': 'application/rss+xml' },
    });
    try {
        process.chdir(dir);
        const { main } = await import('../scrape-news.mjs');
        await main();
        const after = JSON.parse(await readFile(join(dir, 'data/news-feed.json'), 'utf8'));
        const ids = new Set(after.items.map(i => i.id));
        const lost = FEED.items.map(i => i.id).filter(id => !ids.has(id));
        if (lost.length) fail(label, `lost ${JSON.stringify(lost)}`);
        else if (after.items.length !== FEED.items.length + 2) {
            fail(label, `expected ${FEED.items.length + 2} items, got ${after.items.length}`);
        } else if (after.note !== NEWS_FEED_NOTE) {
            // The note is a contract, not data: the writer now sets it on every
            // run rather than only when absent, because the old form meant a
            // wrong committed value was never repaired.
            fail(label, `the written note is not the canonical contract — got ${JSON.stringify(after.note)}`);
        } else {
            ok(label, 'the written feed is a superset of the one read, keys and all');
        }
    } catch (e) {
        fail(label, `threw: ${e.message}`);
    } finally {
        process.chdir(realCwd);
        globalThis.fetch = realFetch;
        await rm(dir, { recursive: true, force: true });
    }
}

// ----------------------------------- a note-only repair still reaches the disk
//
// `feed.note = NEWS_FEED_NOTE` runs on every invocation, but the write was
// gated on `collected.length > 0` — so a run that found no headlines repaired
// the note in memory and exited 0 with the wrong bytes still on disk. The
// validator fails closed on that either way; what was false is the claim that
// the writer fixes it. This drives main() with a stub that yields NOTHING.

{
    const label = 'a run that collects no headlines still repairs a wrong note';
    const dir = await scratch(JSON.stringify({ ...FEED, note: 'x' }, null, 2) + '\n');
    const realFetch = globalThis.fetch;
    const realCwd = process.cwd();
    globalThis.fetch = async () => new Response(RSS([]), {
        status: 200, headers: { 'content-type': 'application/rss+xml' },
    });
    try {
        process.chdir(dir);
        const { main } = await import('../scrape-news.mjs');
        await main();
        const after = JSON.parse(await readFile(join(dir, 'data/news-feed.json'), 'utf8'));
        if (after.note !== NEWS_FEED_NOTE) {
            fail(label, `collected nothing and left the note as ${JSON.stringify(after.note)} — the repair never reached the disk`);
        } else if (after.items.length !== FEED.items.length) {
            fail(label, `the repair changed the item count: ${FEED.items.length} -> ${after.items.length}`);
        } else {
            ok(label, 'the contract is restored on disk even by a run that found no news');
        }
    } catch (e) {
        fail(label, `threw: ${e.message}`);
    } finally {
        process.chdir(realCwd);
        globalThis.fetch = realFetch;
        await rm(dir, { recursive: true, force: true });
    }
}

// -------------------------------------- the gate is wired, not just present
//
// Deleting the continuityFaults() CALL from main() left this suite green: the
// unit cases exercise the helper directly, and the append case is a clean
// append that loses nothing either way. Between them they proved the rule
// exists, not that the writer runs it — the same shape dedupe-news-feed.mjs
// carried for seven rounds. Found by the PR #19 session; ported here.

{
    const label = 'main() runs the continuity gate, not just the helper';
    const APPEND = 'items: [...feed.items, ...collected]';
    const REBUILD = 'items: [...collected]';
    const source = await readFile(SCRIPT, 'utf8');
    if (!source.includes(APPEND)) {
        fail(label, `scrape-news.mjs no longer contains ${JSON.stringify(APPEND)} — this case mutates that expression and must be updated with it`);
    } else {
        const dir = await scratch(JSON.stringify(FEED, null, 2) + '\n');
        const before = await readFile(join(dir, 'data/news-feed.json'), 'utf8');
        await mkdir(join(dir, 'scripts/lib'), { recursive: true });
        await copyFile(join(REPO, 'scripts/lib/io.mjs'), join(dir, 'scripts/lib/io.mjs'));
        const mutant = join(dir, 'scripts/scrape-news.mjs');
        await writeFile(mutant, source.replace(APPEND, REBUILD), 'utf8');
        const realFetch = globalThis.fetch;
        const realCwd = process.cwd();
        globalThis.fetch = async () => new Response(RSS(['Epsilon headline']), {
            status: 200, headers: { 'content-type': 'application/rss+xml' },
        });
        let threw = null;
        try {
            process.chdir(dir);
            const mod = await import(pathToFileURL(mutant).href);
            await mod.main();
        } catch (e) { threw = e; }
        finally { process.chdir(realCwd); globalThis.fetch = realFetch; }
        const after = await readFile(join(dir, 'data/news-feed.json'), 'utf8');
        if (!threw) fail(label, 'a write that drops every id already on disk completed — main() does not run continuityFaults()');
        else if (!String(threw.message).includes('An append-only feed cannot lose records')) {
            fail(label, `threw, but not the continuity fault — got: ${threw.message}`);
        } else if (after !== before) fail(label, 'refused, but the file on disk changed');
        else ok(label, 'the rule the helper defines is the rule the writer enforces');
        await rm(dir, { recursive: true, force: true });
    }
}

const total = UNIT.length + SCRIPTS.length + 3;
console.log('');
if (bad) {
    console.log(`scrape-news.test: ${bad}/${total} FAILURES`);
    process.exit(1);
}
console.log(`scrape-news.test: ${total}/${total} passed`);
