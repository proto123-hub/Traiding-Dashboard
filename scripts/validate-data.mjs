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

            // verifiedBy is the audit trail for the above; it must be PRESENT and
            // must say the same thing. Making it optional meant a row could lose
            // the field entirely and still pass — the corroboration invariant
            // above does not depend on it, so nothing else would have noticed.
            if (!Array.isArray(row.verifiedBy)) {
                fail.push(`${sym}: verified:true without a verifiedBy audit trail`);
            } else {
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

        // Session dates are compared as dates (staleness, prior-session carry).
        // CNBC returns a full ISO timestamp for index/FX symbols, which reached
        // this field for US10Y and DXY and silently skewed those comparisons.
        if (row.regularSessionDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(row.regularSessionDate)) {
            fail.push(`${sym}: regularSessionDate "${row.regularSessionDate}" is not YYYY-MM-DD`);
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
/**
 * Mirror of scrape-fundamentals.mjs `resolveTrailingVerification`: the trailing
 * flag is decided on the EPS leg at 1% whenever two EPS figures exist, and only
 * falls back to the P/E leg at 5% when they do not.
 *
 * The validator originally compared trailingPE at 5% unconditionally, which is
 * a DIFFERENT claim from the one the scraper makes. Two sources reporting the
 * same P/E off materially different EPS (60 = 6/0.1 and 60 = 4/0.0667) would
 * satisfy the validator while the scraper's own rule rejects them.
 *
 * `trailingLeg` is not persisted in fundamentals.json — it only reaches the
 * reports/validation compare drop — so the leg is re-derived here from the same
 * inputs and in the same precedence.
 */
export function trailingLegOf(record) {
    const per = record.perSource || {};
    const eps = {};
    if (per.cnbc?.eps != null) eps.cnbc = per.cnbc.eps;
    if (per['sec-xbrl']?.epsUsed != null) eps['sec-xbrl'] = per['sec-xbrl'].epsUsed;
    if (Object.keys(eps).length >= 2) {
        return { leg: 'eps', values: eps, published: record.eps };
    }
    const pe = {};
    for (const name of ['cnbc', 'stockanalysis', 'sec-xbrl']) {
        const v = per[name]?.trailingPE;
        if (v != null) pe[name] = v;
    }
    if (Object.keys(pe).length >= 2) {
        return { leg: 'pe', values: pe, published: record.trailingPE };
    }
    return { leg: null, values: {}, published: null };
}

export function checkFundamentals(fu) {
    const fail = [];
    const tol = fu.tolerance || {};
    const fwdTol = tol.forwardPE ?? 0.05;
    const trailTol = tol.trailingPE ?? 0.05;
    const trailEpsTol = tol.trailingEps ?? 0.01;
    let fwd = 0;

    for (const [sym, r] of Object.entries(fu.fundamentals || {})) {
        if (r.notApplicable) continue;
        const byBasis = Object.entries(r.forwardPEByBasis || {});

        // Per-basis: a verified basis needs 2+ sources that AGREE with the value
        // it publishes. Counting sources alone let NTM cnbc=26 and
        // stockanalysis=16 stand as "verified" — two sources, no agreement.
        // Same invariant as checkQuotes, same reason.
        for (const [name, e] of byBasis) {
            if (!e || !e.verified) continue;
            const n = Object.values(e.perSource || {}).filter(v => v != null).length;
            if (n < 2) {
                fail.push(`${sym} forwardPEByBasis.${name}: verified:true with ${n} source(s)`);
                continue;
            }
            const backing = corroboratorsOf(e.perSource, e.value, fwdTol);
            if (backing.length < 2) {
                const spread = Object.entries(e.perSource).map(([k, v]) => `${k}=${v}`).join(', ');
                fail.push(
                    `${sym} forwardPEByBasis.${name}: verified:true with ${n} sources but only ` +
                    `${backing.length} agree with the published value ${e.value} within ${fwdTol} (${spread})`
                );
            }
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

        if (r.trailingVerified) {
            if (r.trailingPE == null) {
                fail.push(`${sym}: trailingVerified with null trailingPE`);
            } else {
                const { leg, values, published } = trailingLegOf(r);
                if (leg == null) {
                    fail.push(`${sym}: trailingVerified:true with fewer than 2 sources on either the eps or pe leg`);
                } else if (published == null) {
                    fail.push(
                        `${sym}: trailingVerified:true on the ${leg} leg but the record publishes no ` +
                        `${leg === 'eps' ? 'eps' : 'trailingPE'} value for those sources to corroborate`
                    );
                } else {
                    const legTol = leg === 'eps' ? trailEpsTol : trailTol;
                    const backing = corroboratorsOf(values, published, legTol);
                    // The pe leg can see three sources, so the agreeing pair need
                    // not contain the priority pick; the scraper publishes from
                    // the cluster and must record which sources those were.
                    if (leg === 'pe' && !Array.isArray(r.trailingVerifiedBy)) {
                        fail.push(`${sym}: trailingVerified:true on the pe leg without a trailingVerifiedBy audit trail`);
                    }
                    if (backing.length < 2) {
                        const spread = Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
                        fail.push(
                            `${sym}: trailingVerified:true but the ${leg} leg's published value ${published} ` +
                            `is corroborated by ${backing.length} source(s) within ${legTol} (${spread}) — ` +
                            `the scraper decides this flag on the ${leg} leg, so that is what must agree`
                        );
                    }
                }
            }
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
export function checkBookWeights(riskScores, portfolio, adjudicationDate, maxStaleDays = 7) {
    const fail = [];
    const asOf = portfolio?.asOf;
    const basis = riskScores?.portfolioBasis;

    // Staleness must be measured against the prices the weights actually
    // multiply. An earlier version read riskScores.updatedAgainst — a field
    // that does not exist in this schema — so `stale` was always null and the
    // whole branch was dead: deleting portfolioBasis, or flipping its status to
    // CURRENT, both still returned zero failures.
    if (!asOf) return { fail: ['portfolio-current.json has no asOf — staleness cannot be established'] };
    const anchor = adjudicationDate
        ?? Object.values(riskScores?.scores || {}).map(v => v.updated).filter(Boolean).sort().pop();
    if (!anchor) return { fail: ['no adjudication date available to measure portfolio staleness against'] };
    const staleDays = Math.round((Date.parse(anchor) - Date.parse(asOf)) / 86400000);

    for (const [sym, v] of Object.entries(riskScores?.scores || {})) {
        for (const risk of v.risks || []) {
            if (!/% of book/.test(risk.note || '')) continue;
            if (risk.provisional === true) continue;
            fail.push(
                `${sym}: asserts a book weight without provisional:true — share counts come from ` +
                `portfolio-current.json (asOf ${asOf}), which is hand-entered and not broker-confirmed. ` +
                `Verified prices do not make the weight verified.`
            );
        }
    }

    if (staleDays > maxStaleDays) {
        if (!basis) {
            fail.push(
                `portfolio is ${staleDays}d stale (asOf ${asOf} vs adjudication ${anchor}) with no ` +
                `portfolioBasis block declaring it`
            );
        } else {
            if (basis.status !== 'BROKER-REFRESH-REQUIRED') {
                fail.push(
                    `portfolio is ${staleDays}d stale but portfolioBasis.status is ` +
                    `"${basis.status}" — must be "BROKER-REFRESH-REQUIRED"`
                );
            }
            if (basis.asOf !== asOf) {
                fail.push(`portfolioBasis.asOf ${basis.asOf} does not match portfolio-current.json asOf ${asOf}`);
            }
        }
    } else if (basis && basis.asOf !== asOf) {
        fail.push(`portfolioBasis.asOf ${basis.asOf} does not match portfolio-current.json asOf ${asOf}`);
    }
    return { fail, staleDays };
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
        // Anchor staleness to the LATER of the quote session whose prices the
        // weights multiply and the date risk-scores claims to be adjudicated
        // for. Taking the max means backdating `updated` cannot shrink the
        // measured staleness.
        //
        // Scan only the HELD symbols: DXY and US10Y are in the same file but
        // are not in the book, and their fresher pre-market session made the
        // reported figure 107d when the prices behind the weights are 106d old.
        const held = new Set((pf.positions || []).map(p => p.symbol));
        const session = Object.entries(pq.quotes || {})
            .filter(([sym]) => held.has(sym))
            .map(([, r]) => r.regularSessionDate).filter(Boolean).sort().pop();
        // Held symbols only, same as the session scan above: a watch-only entry
        // refreshed a day later would otherwise inflate the figure by a day.
        const adjudicated = Object.entries(rs.scores || {})
            .filter(([sym]) => held.has(sym))
            .map(([, v]) => v.updated).filter(Boolean).sort().pop();
        const anchor = [session, adjudicated].filter(Boolean).sort().pop();
        const r = checkBookWeights(rs, pf, anchor);
        record(r.fail);
        ok(`book weights: portfolio asOf ${pf.asOf} is ${r.staleDays}d behind session ${session} (${rs.portfolioBasis?.status || 'no status'})`);
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
