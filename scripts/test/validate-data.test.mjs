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
import { join, dirname } from 'node:path';
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
        // Not a data fixture: a wiring assertion. The writer used to live
        // inline in this workflow and was tested by pattern-matching the YAML;
        // every round of that was bypassable, so it now lives in
        // scripts/commit-refresh.sh and is executed end-to-end by
        // scripts/test/commit-refresh.test.mjs. All that remains to check here
        // is that the workflow actually calls it — a script nothing invokes is
        // exactly the defect dedupe-news-feed.mjs had for seven rounds.
        file: 'news-feed-unique.json',
        label: 'data-refresh.yml invokes the checked-in writer',
        run: () => {
            const wf = readFileSync('.github/workflows/data-refresh.yml', 'utf8').replace(/\r/g, '');
            const bad = [];
            if (!/^\s*run: bash scripts\/commit-refresh\.sh\s*$/m.test(wf)) {
                bad.push('data-refresh.yml does not run `bash scripts/commit-refresh.sh` — the writer is orphaned or has moved back inline');
            }
            // Order, not just presence: the integrity gate has to run BEFORE
            // the writer, or the bot commits a tree nothing checked. Moving
            // validation after commit-refresh.sh left this suite green. Found
            // by the PR #19 session; ported. Compared by line index, so it does
            // not depend on where either sits in the file.
            const vAt = wf.split('\n').findIndex(l => /^\s*run: node scripts\/validate-data\.mjs\s*$/.test(l));
            const wAt = wf.split('\n').findIndex(l => /^\s*run: bash scripts\/commit-refresh\.sh\s*$/.test(l));
            if (vAt < 0) bad.push('data-refresh.yml never runs scripts/validate-data.mjs — the bot is exempt from the integrity gate');
            else if (wAt >= 0 && vAt > wAt) {
                bad.push('scripts/validate-data.mjs runs AFTER the writer — the tree is committed before anything checks it');
            }
            if (/^\s*git (commit|push)\b/m.test(wf)) {
                bad.push('data-refresh.yml commits or pushes inline again — that path is untestable and belongs in commit-refresh.sh');
            }
            // Invocation text is not reachability: `if: false` on the step
            // leaves the `run:` line exactly as it is while the writer never
            // runs. Assert the step carries no condition.
            // Job level too: `if:` or `continue-on-error:` on the refresh JOB
            // silences every step in it, and a step-only check reads green.
            // Key order is not fixed in YAML, so slicing between two landmarks
            // misses `if: false` placed before `name:` on the step or after
            // `steps:` on the job — both left this green. Scan by INDENTATION
            // instead: 4 spaces is job level, 8 is a step key, and the writer is
            // whichever step block contains the run: line.
            const lines = wf.split('\n');
            const jobStart = lines.findIndex(l => /^  refresh:/.test(l));
            const jobKeys = [];
            for (let i = jobStart + 1; i < lines.length && !/^  \S/.test(lines[i]); i++) {
                const m = /^ {4}([A-Za-z-]+)\s*:/.exec(lines[i]);
                if (m) jobKeys.push(m[1]);
            }
            if (jobKeys.includes('if') || jobKeys.includes('continue-on-error')) {
                bad.push('the refresh job is conditional — `if:`/`continue-on-error:` at job level silences the writer while every step still reads correctly');
            }
            // Step blocks start at `      - `; find the one holding the writer.
            const starts = lines.map((l, i) => /^ {6}- /.test(l) ? i : -1).filter(i => i >= 0);
            // Every step whose reachability matters, not just the writer: an
            // `if: false` on the Data integrity step left this suite 32/32
            // while the bot committed a tree nothing had checked.
            const stepKeysAt = (runLine) => {
                const at = lines.findIndex(l => runLine.test(l));
                if (at < 0) return null;
                const st = [...starts].reverse().find(i => i < at);
                const en = starts.find(i => i > at) ?? lines.length;
                const keys = [];
                for (let i = st; i < en; i++) {
                    const m = /^ {6}- ([A-Za-z-]+)\s*:/.exec(lines[i]) || /^ {8}([A-Za-z-]+)\s*:/.exec(lines[i]);
                    if (m) keys.push(m[1]);
                }
                return keys;
            };
            const vKeys = stepKeysAt(/^\s*run: node scripts\/validate-data\.mjs\s*$/);
            if (vKeys && (vKeys.includes('if') || vKeys.includes('continue-on-error'))) {
                bad.push('the Data integrity step is conditional — `if:`/`continue-on-error:` lets the bot commit a tree nothing checked');
            }

            const writerAt = lines.findIndex(l => /^\s*run: bash scripts\/commit-refresh\.sh\s*$/.test(l));
            const blockStart = [...starts].reverse().find(i => i < writerAt);
            const blockEnd = starts.find(i => i > writerAt) ?? lines.length;
            const stepKeys = [];
            for (let i = blockStart; i < blockEnd; i++) {
                // The first key sits on the `- ` line at 6 spaces; every later
                // key is at 8. Matching only the first form missed
                // `continue-on-error:` entirely.
                const m = /^ {6}- ([A-Za-z-]+)\s*:/.exec(lines[i]) || /^ {8}([A-Za-z-]+)\s*:/.exec(lines[i]);
                if (m) stepKeys.push(m[1]);
            }
            if (stepKeys.includes('if') || stepKeys.includes('continue-on-error')) {
                bad.push('the writer step is conditional — `if:`/`continue-on-error:` can silence it entirely while the run: line still reads correctly');
            }
            return bad;
        },
        shouldFail: false,
        why: 'the workflow delegates writing to the script the end-to-end test drives',
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
