#!/usr/bin/env node
// Read-only integrity checks over the committed data layer. Runs no network
// calls and writes nothing, so it can attach a check to a PR head SHA.
//
// Why this exists: data-refresh.yml commits its own output, so its run always
// takes the PARENT as input and produces the head — the head SHA itself can
// never carry that workflow's check. A green refresh run is evidence the
// scrapers work, not evidence the committed tree is sound. This is the second.
//
// Assertions are the invariants the pipeline has actually violated before, not
// a generic schema walk:
//   - verified:true with fewer than 2 agreeing sources (the flag's whole claim)
//   - a published price that no AGREEING PAIR backs (see checkQuotes)
//   - forward P/E claimed verified off a basis that is not itself verified
//   - history rows duplicated on the same (country,tenor,date) key
//   - a fair-value band an order of magnitude off a verified price
//
// The check functions below are pure and exported so scripts/test/ can drive
// them with recorded fixtures of the real bugs. main() runs only under a
// direct invocation guard — importing this file must never touch the repo.
// (scrape-yields.mjs shipped without that guard and a parser unit test
// overwrote live data.)

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_TOLERANCE = { equity: 0.002, index: 0.005, fx: 0.001 };

/** Fractional gap between two prices, scaled to the smaller one. */
function gap(a, b) {
    return Math.abs(a - b) / Math.max(Math.min(a, b), 1e-6);
}

/**
 * The published price must be corroborated, not merely sourced.
 *
 * The 2026-08-18 bug: a fixed source priority published NASDAQ's 342.4922 for
 * GOOGL while Cboe and CNBC both said 344.00, and stamped verified:true. Two
 * weaker phrasings of this check both pass that data and must not be used:
 *
 *   "some pair in perSource agrees"     — cboe/cnbc agree, so it passes
 *   "some source in verifiedBy holds
 *    the published price"               — verifiedBy ["nasdaq"] holds it, passes
 *
 * Each is satisfied by a DIFFERENT pair of sources, which is exactly the
 * failure. The invariant that actually binds: at least two sources must agree
 * within tolerance WITH THE PUBLISHED PRICE ITSELF.
 */
export function corroboratorsOf(perSource, price, tolerance) {
    if (price == null) return [];
    return Object.entries(perSource || {})
        .filter(([, v]) => v != null && gap(v, price) <= tolerance)
        .map(([n]) => n);
}

export function checkQuotes(pq) {
    const fail = [];
    const warn = [];
    const tol = pq.toleranceByClass || DEFAULT_TOLERANCE;
    let checked = 0;

    for (const [sym, row] of Object.entries(pq.quotes || {})) {
        const per = Object.entries(row.perSource || {}).filter(([, v]) => v != null);
        const t = tol[row.assetClass] ?? DEFAULT_TOLERANCE.equity;

        if (row.verified) {
            checked++;
            if (per.length < 2) {
                fail.push(`${sym}: verified:true with ${per.length} source(s)`);
                continue;
            }

            const backing = corroboratorsOf(row.perSource, row.price, t);
            if (backing.length < 2) {
                const others = per.map(([n, v]) => `${n}=${v}`).join(', ');
                fail.push(
                    `${sym}: verified:true but published price ${row.price} is corroborated by ` +
                    `${backing.length} source(s) [${backing.join(', ') || 'none'}] within ${t} — ` +
                    `a pair may agree elsewhere, but not with what was published (${others})`
                );
                continue;
            }

            // verifiedBy is the audit trail for the above; it must say the same thing.
            if (Array.isArray(row.verifiedBy)) {
                if (row.verifiedBy.length < 2) {
                    fail.push(`${sym}: verifiedBy lists ${row.verifiedBy.length} source(s), needs 2+`);
                }
                const dissenting = row.verifiedBy.filter(n => !backing.includes(n));
                if (dissenting.length) {
                    fail.push(
                        `${sym}: verifiedBy names ${JSON.stringify(dissenting)}, which do not agree ` +
                        `with the published price ${row.price} within ${t}`
                    );
                }
            }
        }

        if (row.changePct != null && row.prevClose == null) {
            warn.push(`${sym}: changePct without prevClose`);
        }
    }
    return { fail, warn, checked };
}

/**
 * A forward P/E is only comparable within one EPS basis. GOOGL quotes 26.06
 * NTM, 16.77 FY2026E and 23.34 FY2027E — all correct, none interchangeable.
 *
 * The basis is the KEY of forwardPEByBasis ({NTM: {...}}); entries carry no
 * `basis` field. An earlier version of this check read `entry.basis`, got
 * undefined for every entry, and so could never fail — inert, not passing.
 */
export function checkFundamentals(fu) {
    const fail = [];
    let fwd = 0;

    for (const [sym, r] of Object.entries(fu.fundamentals || {})) {
        if (r.notApplicable) continue;
        const byBasis = Object.entries(r.forwardPEByBasis || {});

        // Per-basis: a verified basis needs 2+ sources of its own.
        for (const [name, e] of byBasis) {
            if (!e || !e.verified) continue;
            const n = Object.values(e.perSource || {}).filter(v => v != null).length;
            if (n < 2) fail.push(`${sym} forwardPEByBasis.${name}: verified:true with ${n} source(s)`);
        }

        if (r.forwardVerified) {
            fwd++;
            const verifiedBases = byBasis.filter(([, e]) => e && e.verified).map(([n]) => n);
            if (verifiedBases.length === 0) {
                fail.push(`${sym}: forwardVerified:true but no basis in forwardPEByBasis is itself verified`);
            } else if (verifiedBases.length > 1) {
                fail.push(
                    `${sym}: forwardVerified:true spans ${verifiedBases.length} EPS bases ` +
                    `${JSON.stringify(verifiedBases)} — bases are not comparable and must never be pooled`
                );
            } else {
                const [name] = verifiedBases;
                if (r.forwardPEBasis != null && r.forwardPEBasis !== name) {
                    fail.push(
                        `${sym}: published forwardPEBasis "${r.forwardPEBasis}" but the verified basis is "${name}"`
                    );
                }
                const value = r.forwardPEByBasis[name].value;
                if (r.forwardPE != null && value != null && r.forwardPE !== value) {
                    fail.push(
                        `${sym}: published forwardPE ${r.forwardPE} is not the verified ${name} value ${value}`
                    );
                }
            }
        }

        if (r.trailingVerified && r.trailingPE == null) {
            fail.push(`${sym}: trailingVerified with null trailingPE`);
        }
    }
    return { fail, fwd };
}

export function checkHistoryShard(shard, label) {
    const fail = [];
    const seen = new Set();
    for (const r of shard.rows || []) {
        const k = `${r.country}|${r.tenor}|${r.date}`;
        if (seen.has(k)) fail.push(`${label}: duplicate row for ${k}`);
        seen.add(k);
    }
    return { fail };
}

/**
 * A band an order of magnitude away from a verified price is the signature of
 * an unadjusted stock split. KLAC sat at 10x for two months before anyone
 * noticed; CRWD at 4x for six weeks.
 */
export function checkBands(valuations, quotes) {
    const fail = [];
    for (const [sym, v] of Object.entries(valuations || {})) {
        const px = quotes?.[sym]?.price;
        if (px == null || v.fvMid == null) continue;
        const ratio = v.fvMid / px;
        if (ratio > 5 || ratio < 0.2) {
            fail.push(`${sym}: fvMid ${v.fvMid} vs verified price ${px} (${ratio.toFixed(1)}x) — check for an unadjusted split`);
        }
    }
    return { fail };
}

/**
 * A book weight is prices × share counts. The prices here are cross-source
 * verified daily; the share counts come from portfolio-current.json, which is
 * hand-entered and was 107 days stale when MRVL's "crossed 20% of book" claim
 * was first written. Verified prices make such a figure look verified when
 * half its inputs are an assumption — and MRVL's own log carries a TRIM
 * recommendation that, if executed, makes the weight simply wrong.
 *
 * Per-share adjudication (stops, entry zones, targets) reads no share counts
 * and is deliberately not covered by this check.
 */
export function checkBookWeights(riskScores, portfolio, maxStaleDays = 7) {
    const fail = [];
    const asOf = portfolio?.asOf;
    const updated = riskScores?.portfolioBasis?.asOf ?? asOf;
    const stale = asOf && riskScores?.updatedAgainst
        ? (Date.parse(riskScores.updatedAgainst) - Date.parse(asOf)) / 86400000
        : null;

    for (const [sym, v] of Object.entries(riskScores?.scores || {})) {
        for (const risk of v.risks || []) {
            if (!/% of book/.test(risk.note || '')) continue;
            if (risk.provisional === true) continue;
            fail.push(
                `${sym}: asserts a book weight without provisional:true — share counts come from ` +
                `portfolio-current.json (asOf ${asOf || 'unknown'}), which is hand-entered and not ` +
                `broker-confirmed. Verified prices do not make the weight verified.`
            );
        }
    }
    if (updated !== asOf) {
        fail.push(`portfolioBasis.asOf ${updated} does not match portfolio-current.json asOf ${asOf}`);
    }
    if (stale != null && stale > maxStaleDays && !riskScores?.portfolioBasis) {
        fail.push(`portfolio is ${Math.round(stale)}d stale with no portfolioBasis block declaring it`);
    }
    return { fail };
}

// --- runner ---------------------------------------------------------------

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

async function allJsonFiles(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...await allJsonFiles(p));
        else if (e.name.endsWith('.json')) out.push(p);
    }
    return out;
}

async function main() {
    const fail = [];
    const warn = [];
    const ok = (m) => console.log(`  ok   ${m}`);
    const record = (msgs) => { msgs.forEach(m => { fail.push(m); console.log(`  FAIL ${m}`); }); };

    console.log('\n[1] JSON parse');
    const files = await allJsonFiles('data');
    for (const f of files) {
        try { await readJson(f); } catch (e) { record([`${f}: ${e.message}`]); }
    }
    if (!fail.length) ok(`${files.length} files parse`);

    console.log('\n[2] price-quotes verified-flag integrity');
    const pq = await readJson('data/price-quotes.json');
    const q = checkQuotes(pq);
    record(q.fail);
    warn.push(...q.warn);
    if (!q.fail.length) ok(`${q.checked} verified rows: published price corroborated by 2+ agreeing sources`);

    console.log('\n[3] fundamentals basis discipline');
    try {
        const f = checkFundamentals(await readJson('data/fundamentals.json'));
        record(f.fail);
        if (!f.fail.length) ok(`forward-verified entries: ${f.fwd} (each backed by exactly one verified basis)`);
    } catch (e) {
        if (e.code === 'ENOENT') warn.push('data/fundamentals.json absent — skipped'); else throw e;
    }

    console.log('\n[4] history key uniqueness');
    let shards = [];
    try { shards = (await readdir('data/history')).filter(f => /^yields-\d{4}\.json$/.test(f)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const f of shards) {
        record(checkHistoryShard(await readJson(`data/history/${f}`), `data/history/${f}`).fail);
    }
    ok(`${shards.length} yield shards, no duplicate keys`);

    console.log('\n[5] valuation band plausibility');
    try {
        const val = (await readJson('data/valuations.json')).valuations || {};
        record(checkBands(val, pq.quotes).fail);
        ok('no band is an order of magnitude off its price');
    } catch (e) {
        if (e.code === 'ENOENT') warn.push('data/valuations.json absent — skipped'); else throw e;
    }

    console.log('\n[6] book-weight provenance');
    try {
        const rs = await readJson('data/risk-scores.json');
        const pf = await readJson('data/portfolio-current.json');
        record(checkBookWeights(rs, pf).fail);
        ok(`book weights declared against portfolio asOf ${pf.asOf} (${rs.portfolioBasis?.status || 'no status'})`);
    } catch (e) {
        if (e.code === 'ENOENT') warn.push('risk-scores or portfolio-current absent — skipped'); else throw e;
    }

    console.log('');
    warn.forEach(w => console.log(`  warn ${w}`));
    if (fail.length) {
        console.log(`\nvalidate-data: ${fail.length} FAILURES`);
        process.exit(1);
    }
    console.log(`validate-data: all checks passed (${warn.length} warnings)`);
}

// Direct-invocation guard — see the header note about scrape-yields.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main();
}
