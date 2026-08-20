#!/usr/bin/env node
// Regression fixtures for scripts/validate-data.mjs.
//
// Every fixture under fixtures/ is a shape this repo actually shipped, not an
// invented edge case. The point is not that the checks reject SOMETHING — an
// obviously-wrong value like price 999 is rejected by a check that is too weak
// to catch the real bug. Each must-fail fixture is the real data, and the
// `expect` substring pins WHY it fails, so a check cannot be weakened later
// while still passing on a technicality.
//
// Run: node scripts/test/validate-data.test.mjs

import { readFile } from 'node:fs/promises';
import { checkQuotes, checkFundamentals, checkBands, checkBookWeights } from '../validate-data.mjs';

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
        expect: 'corroborated by 1 source',
        why: 'same failure on the trailing side, where perSource entries are objects',
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
