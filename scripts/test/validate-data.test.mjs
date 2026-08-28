#!/usr/bin/env node
// Regression fixtures for scripts/validate-data.mjs.
//
// Fixtures come in two kinds, and the distinction matters:
//
//   RECORDED (16) — a shape this repo actually shipped, e.g. the 2026-08-18
//     GOOGL row that published NASDAQ's outlier under a verified flag, or the
//     KLAC band left 10x high across a split. The note on each says RECORDED.
//   CONSTRUCTED (12) — a minimal instance of a defect path the code actually
//     permitted, built to the real schema. Each was validated by reproducing
//     `fail: []` against the pre-fix check before the fix landed, so it pins a
//     hole that existed rather than an imagined one.
//
// Neither kind is an invented edge case, but only the first is literally
// shipped data — do not describe the whole set as "shapes this repo shipped".
//
// The point is not that the checks reject SOMETHING — an obviously-wrong value
// like price 999 is rejected by a check too weak to catch the real bug. Each
// must-fail fixture's `expect` substring pins WHY it fails, so a check cannot
// be weakened later while still passing on a technicality.
//
// Run: node scripts/test/validate-data.test.mjs

import { readFile } from 'node:fs/promises';
import { checkQuotes, checkFundamentals, checkBands, checkBookWeights, checkNewsFeed } from '../validate-data.mjs';
import { dedupeByEarliest } from '../dedupe-news-feed.mjs';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = new URL('./fixtures/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, DIR), 'utf8'));

const CASES = [
    {
        file: 'quotes-source-backed-outlier.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: true,
        expect: 'corroborated by 1 source',
        why: 'source-backed outlier: a pair agrees, and verifiedBy holds the published price — but not the same pair',
    },
    {
        file: 'quotes-single-source-verified.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: true,
        expect: 'verified:true with 1 source',
        why: 'the flag claims 2+ independent sources',
    },
    {
        file: 'quotes-corroborated.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: false,
        why: 'consensus value published, dissenter recorded; unverified single-source row left honestly unverified',
    },
    {
        file: 'fundamentals-mixed-basis.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'spans 2 EPS bases',
        why: 'NTM and FY2026E are both correct and neither corroborates the other',
    },
    {
        file: 'fundamentals-unbacked-forward.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'no basis in forwardPEByBasis is itself verified',
        why: 'a verified claim with nothing under it',
    },
    {
        file: 'fundamentals-good.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: false,
        why: 'single unverified NTM source, stated rather than inflated',
    },
    {
        file: 'risk-book-weight-unflagged.json',
        run: (d) => checkBookWeights(d.riskScores, d.portfolio, d.adjudicationDate || '2026-08-19').fail,
        shouldFail: true,
        expect: 'without provisional:true',
        why: 'verified prices times 107-day-stale share counts, published as if the weight were verified',
    },
    {
        file: 'risk-book-weight-flagged.json',
        run: (d) => checkBookWeights(d.riskScores, d.portfolio, d.adjudicationDate || '2026-08-19').fail,
        shouldFail: false,
        why: 'provenance declared; watch-only "customer concentration" is not a book weight and is left alone',
    },
    {
        file: 'quotes-missing-verifiedby.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: true,
        expect: 'without a verifiedBy audit trail',
        why: 'an otherwise-correct row silently losing its audit trail — the corroboration check does not read that field',
    },
    {
        file: 'quotes-timestamp-session-date.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: true,
        expect: 'is not YYYY-MM-DD',
        why: 'CNBC returns a timestamp for index/FX symbols and a date for equities; the scraper trusted it verbatim',
    },
    {
        file: 'fundamentals-disagreeing-basis.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'agree with the published value',
        why: 'two sources inside one basis, 38% apart, standing as verified',
    },
    {
        file: 'fundamentals-disagreeing-trailing.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: "the pe leg's published value",
        why: 'no EPS available on either source, so the pe leg decides — and those disagree by 46%',
    },
    {
        file: 'fundamentals-trailing-eps-mismatch.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: "the eps leg's published value",
        why: 'identical P/E off 50%-apart EPS — the scraper decides this flag on the eps leg, so the validator must too',
    },
    {
        file: 'fundamentals-trailing-pe-outlier-published.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: "the pe leg's published value",
        why: 'any-pair verification plus fixed-priority publication — the GOOGL defect, in the fundamentals scraper',
    },
    {
        file: 'fundamentals-trailing-pe-consensus.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: false,
        why: 'pe leg publishing from the agreeing cluster with the dissenter named',
    },
    {
        file: 'fundamentals-trailing-audit-names-outlier.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'do not agree with the published value',
        why: 'correct published value, audit trail naming the source that dissented',
    },
    {
        file: 'fundamentals-forward-audit-missing.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'without a verifiedBy audit trail',
        why: 'the forward leg had no audit-trail check at all',
    },
    {
        file: 'fundamentals-forward-audit-names-outlier.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'do not agree with the published value',
        why: 'forward audit trail naming the dissenting source',
    },
    {
        file: 'fundamentals-forward-consensus.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: false,
        why: 'top-level forwardPE follows the basis entry, cluster and dissenter both named, forwardEps dropped with cnbc',
    },
    {
        file: 'quotes-duplicate-verifiedby.json',
        run: (d) => checkQuotes(d).fail,
        shouldFail: true,
        expect: 'one source is not two',
        why: 'array length accepted the same source twice as two independent ones',
    },
    {
        file: 'fundamentals-duplicate-audit-names.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'one source is not two',
        why: 'the same duplicate defect on both fundamentals legs, via the shared helper',
    },
    {
        file: 'fundamentals-forward-verified-nothing-published.json',
        run: (d) => checkFundamentals(d).fail,
        shouldFail: true,
        expect: 'no forwardPE is published',
        why: 'both consistency comparisons were guarded on != null, so publishing nothing skipped them all',
    },
    {
        file: 'risk-book-weight-stale-undeclared.json',
        run: (d) => checkBookWeights(d.riskScores, d.portfolio, d.adjudicationDate).fail,
        shouldFail: true,
        expect: 'with no portfolioBasis block declaring it',
        why: 'staleness was measured against a field the schema does not have, so the branch was dead',
    },
    {
        file: 'risk-book-weight-stale-mislabelled.json',
        run: (d) => checkBookWeights(d.riskScores, d.portfolio, d.adjudicationDate).fail,
        shouldFail: true,
        expect: 'must be "BROKER-REFRESH-REQUIRED"',
        why: 'staleness declared away rather than declared',
    },
    {
        file: 'news-feed-duplicate-id.json',
        run: (d) => checkNewsFeed(d.feed).fail,
        shouldFail: true,
        expect: 'duplicate id',
        why: "git's textual auto-merge kept both copies of one item; a clean merge is not a deduped merge",
    },
    {
        file: 'news-feed-unique.json',
        run: (d) => checkNewsFeed(d.feed).fail,
        shouldFail: false,
        why: 'union-by-id keeping the first occurrence',
    },
    {
        file: 'news-feed-note-placeholder.json',
        run: (d) => checkNewsFeed(d.feed).fail,
        shouldFail: true,
        expect: 'note is not the canonical contract',
        why: 'the writer set the note only when ABSENT, so a wrong committed value was never repaired and nothing read it',
    },
    {
        file: 'news-feed-note-inverted.json',
        run: (d) => checkNewsFeed(d.feed).fail,
        shouldFail: true,
        expect: 'note is not the canonical contract',
        why: 'roles swapped — every word the old search wanted, stating the opposite of the contract',
    },
    {
        file: 'news-feed-note-negated.json',
        run: (d) => checkNewsFeed(d.feed).fail,
        shouldFail: true,
        expect: 'note is not the canonical contract',
        why: 'both claims denied with both words present — a word-search cannot tell this from the real thing',
    },
    {
        file: 'news-feed-earliest-wins.json',
        run: (d) => {
            const out = dedupeByEarliest(d.items);
            const bad = [];
            if (out.length !== d.expect.count) bad.push(`collapsed to ${out.length}, expected ${d.expect.count}`);
            for (const it of out) {
                if (it.which === 'later') bad.push(`id "${it.id}" retained the later copy (${it.collectedAt})`);
            }
            return bad;
        },
        shouldFail: false,
        why: 'earliest collectedAt wins regardless of input order — array order is not a rule',
    },
    {
        // Not a data fixture: a wiring assertion. dedupe-news-feed.mjs was
        // written, tested, documented — and never called from the production
        // path, which kept its own origin-first merge and its own bug. The rule
        // existing is not the rule running.
        file: 'news-feed-unique.json',
        label: 'data-refresh.yml calls the shared dedupe, not its own',
        run: () => {
            const wf = readFileSync('.github/workflows/data-refresh.yml', 'utf8');
            const bad = [];
            // Match an INVOCATION, not a mention. The first version of this
            // check used wf.includes(), which the word "dedupe-news-feed.mjs"
            // in a nearby comment satisfied — so deleting the actual command
            // left the check green. A check that passes on prose is the same
            // defect it was written to catch.
            // `run: node x.mjs` (a one-line step) and a bare `node x.mjs`
            // (a line inside `run: |`) are both invocations; a mention in prose
            // is not.
            const invokes = (hay, cmd) =>
                new RegExp(`^\\s*(run:\\s+)?node\\s+${cmd.replace(/[.\/]/g, '\\$&')}\\s*$`, 'm').test(hay);

            // Scope to the retry loop. Searching the whole file was the same
            // mistake one level up: the pre-commit integrity step is also a
            // bare `node scripts/validate-data.mjs`, so it satisfied the
            // re-validation assertion on its own and the replay path could have
            // dropped its copy with the check still green. The two are separate
            // invariants over two different trees.
            const loopStart = wf.indexOf('for i in 1 2 3; do');
            const loopEnd = wf.indexOf('\n          done', loopStart);
            if (loopStart < 0 || loopEnd < 0) return ['cannot locate the push-retry loop in data-refresh.yml'];
            const replay = wf.slice(loopStart, loopEnd);
            const beforeLoop = wf.slice(0, loopStart);

            if (!invokes(replay, 'scripts/dedupe-news-feed.mjs')) {
                bad.push('replay path does not invoke scripts/dedupe-news-feed.mjs');
            }
            if (/\(a\.items\|\|\[\]\)\.forEach\(i=>m\.set/.test(replay)) {
                bad.push('an inline origin-first Map merge is back in the workflow');
            }
            if (!invokes(replay, 'scripts/validate-data.mjs')) {
                bad.push('replayed tree is committed without re-validation');
            }
            if (!invokes(beforeLoop, 'scripts/validate-data.mjs')) {
                bad.push('the first-attempt tree is committed without validation — the bot is exempt again');
            }

            // The change guard decides whether anything is committed at all,
            // and it must see UNTRACKED files — a run whose only output is a
            // new file must not exit reporting "no changes" before reaching its
            // own `git add`. Extracted and RUN against a scratch repository
            // rather than pattern-matched: the first version of this check was
            // a regex, and adding `--untracked-files=no` to the very command it
            // matched left it green while hiding exactly the file it exists to
            // catch. A check on the text of a command cannot speak for what the
            // command does.
            const guardLine = /^\s*if\s+(.+?);\s*then\s*$/m.exec(beforeLoop);
            if (!guardLine) {
                bad.push('cannot find the change guard before the retry loop — it decides whether anything is committed at all');
            } else {
                const scratch = mkdtempSync(join(tmpdir(), 'guard-'));
                try {
                    const git = (...a) => execFileSync('git', a, { cwd: scratch, stdio: 'pipe' });
                    git('init', '-q', '.');
                    git('config', 'user.email', 't@t');
                    git('config', 'user.name', 't');
                    // Every path the guard names must exist, or git exits
                    // fatal on the pathspec and the run below proves nothing.
                    // The first version of this test created only two of the
                    // three, so reverting the guard to `git diff` errored out
                    // and was scored as "proceeds" — passing for exactly the
                    // wrong reason.
                    for (const d of ['data', 'reports/raw', 'reports/validation']) {
                        mkdirSync(join(scratch, d), { recursive: true });
                        writeFileSync(join(scratch, d, '.keep'), '');
                    }
                    writeFileSync(join(scratch, 'data/seed.json'), '{}\n');
                    git('add', '-A');
                    git('commit', '-qm', 'seed');
                    // The case the guard got wrong: output that is ONLY a new file.
                    writeFileSync(join(scratch, 'reports/raw/2026-08-28-google-news.json'), '{"failures":[]}\n');
                    // Exit 0 => guard true => the workflow exits without committing.
                    // Exit 1 => guard false => it proceeds to `git add`.
                    // Anything else is git failing to run the guard at all, which
                    // is its own defect and must not read as "proceeds".
                    let status = 0;
                    try {
                        execFileSync('bash', ['-c', guardLine[1]], { cwd: scratch, stdio: 'pipe' });
                    } catch (e) {
                        status = e.status ?? -1;
                    }
                    if (status !== 0 && status !== 1) {
                        bad.push(`the change guard \`${guardLine[1]}\` exited ${status} — it does not run against the paths it names`);
                    } else if (status === 0) {
                        bad.push(
                            `the change guard \`${guardLine[1]}\` reports "no changes" for a run whose only output is a ` +
                            `new untracked file, so the workflow exits before its own \`git add\` and that output is never committed`
                        );
                    }
                } finally {
                    rmSync(scratch, { recursive: true, force: true });
                }
            }
            return bad;
        },
        shouldFail: false,
        why: 'the production writer uses the shared rule and re-validates what it replays',
    },
    {
        file: 'valuations-presplit-band.json',
        run: (d) => checkBands(d.valuations, d.quotes).fail,
        shouldFail: true,
        expect: 'unadjusted split',
        why: 'KLAC band kept pre-split share counts for two months',
    },
];

let bad = 0;
for (const c of CASES) {
    const fails = c.run(await load(c.file));
    const got = fails.length > 0;

    if (got !== c.shouldFail) {
        console.log(`  FAIL ${c.file}: expected ${c.shouldFail ? 'rejection' : 'acceptance'}, got ${got ? 'rejection' : 'acceptance'}`);
        fails.forEach(f => console.log(`         ${f}`));
        bad++;
        continue;
    }
    if (c.shouldFail && !fails.some(f => f.includes(c.expect))) {
        console.log(`  FAIL ${c.file}: rejected, but for the wrong reason — no message contains "${c.expect}"`);
        fails.forEach(f => console.log(`         ${f}`));
        bad++;
        continue;
    }
    console.log(`  ok   ${c.file} — ${c.shouldFail ? 'rejected' : 'accepted'}: ${c.why}`);
}

console.log('');
if (bad) {
    console.log(`validate-data.test: ${bad}/${CASES.length} FAILURES`);
    process.exit(1);
}
console.log(`validate-data.test: ${CASES.length}/${CASES.length} passed`);
