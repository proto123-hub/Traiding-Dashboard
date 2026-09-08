# Design — `scripts/scrape-fundamentals.mjs` (cron-verified P/E)

Grounded in `reports/validation/2026-08-18-fundamentals-probe.md` (CI ground
truth — CNBC's `FundamentalData` block, the forward-P/E basis trap, SEC XBRL
and stockanalysis.com viability, the NASDAQ `OneYrTarget` bonus find),
`reports/validation/2026-08-18-source-probe.md` (why yahoo/stooq are gone,
CNBC's session-tagging quality), `reports/designs/2026-08-18-session-aware-quotes.md`
(the sibling design landing alongside this one — per-class tolerance
convention, ANY-PAIR `verified` semantics, raw-drop audit trail, tombstone
header style, hard phase-budget pattern), `data/fundamentals.json` (current,
100% WebSearch-synthesis, all unverified), `data/README.md`, `scripts/scrape-quotes.mjs`
+ `scripts/lib/io.mjs` (house adapter/semaphore/timeout/atomic-write
patterns), `scripts/probe-sources.mjs` (the exact CNBC/SEC URLs already
probed), and `index.html` L1000-1043 / L1137-1141 / L1249-1261 (the only
reads of `data/fundamentals.json` — `trailingPE`, `forwardPE`, `verified`,
`notApplicable`, `reason`; confirmed via grep that `perSource`, `sourceCount`,
and `tolerance` are **never read** by `index.html` — their internal shape is
free to evolve).

**This design assumes the sibling session-aware-quotes design has landed**
(`scripts/scrape-quotes.mjs` roster is NASDAQ+Cboe+CNBC, `data/price-quotes.json`
carries `quotes[sym].price`/`.verified` as the official regular-session
close). If it has not yet merged when this is built, the fundamentals script
only needs `data/price-quotes.json`'s `quotes[sym].price`/`.verified` fields,
which are stable across both the old and new quote schema — no blocking
dependency either way.

---

## 0. What's wrong today, in one line

`data/fundamentals.json` is validator-written from WebSearch synthesis
("AI-generated snapshot of a snapshot," per the file's own `collectionMethod`
note) — every entry is `verified: false` and there is no cron refresh. This
design replaces it with three key-less, directly-fetched sources, cross-
verified where the metric is unambiguous (trailing P/E, via EPS agreement)
and explicitly basis-separated where it isn't (forward P/E).

---

## 1. Source roster and exact request shapes

Four independent phases, run **concurrently** (`Promise.all`), each with its
own hard phase-budget deadline so a slow/hanging source can never blow the
runtime budget — the same pattern `scrape-quotes.mjs` already uses for the
Yahoo v8-chart fallback (`YAHOO_PHASE_BUDGET_MS`).

### 1a. CNBC batched `quote.htm` — primary, all 20 stock tickers in one request

```
https://quote.cnbc.com/quote-html-webservice/quote.htm
  ?symbols=GOOGL|CLS|AVGO|MRVL|MU|TSM|PLTR|NVDA|AMD|ARM|AMAT|LRCX|KLAC|MSFT|META|TSLA|ORCL|SNOW|CRWD|INTC
  &requestMethod=quick&noform=1&partnerId=2&fund=1&exthrs=1&output=json&symbolType=symbol
```
Headers: `User-Agent` (existing UA constant), `Accept: application/json`,
`Referer: https://www.cnbc.com/` — identical pattern to `fetchCnbcIndicesOnce`
in `scrape-quotes.mjs`. Excludes SOXL/TSMU (ETFs — no PE, see §5). 8s timeout,
1 retry on failure (matches the CNBC quote-scraper's own retry pattern).

Per-symbol fields consumed (all strings, per the probe):
`FundamentalData.pe` (trailing PE), `.eps` (TTM diluted EPS), `.fpe`
(forward PE, NTM basis), `.feps` (forward EPS, NTM basis).

**UNCONFIRMED — flag for first CI dispatch:** the probe only exercised a
single symbol (`symbols=GOOGL`). The multi-symbol pipe-batch envelope shape
for `requestMethod=quick` has not been probed. Parse defensively, trying
known CNBC envelope shapes in priority order, and never throw on an
unexpected shape:

```js
function extractCnbcQuickRows(j) {
  // UNCONFIRMED for multi-symbol batches — single-symbol GOOGL probe only.
  const c = j?.QuickQuoteResult?.QuickQuote;      // primary guess — matches
                                                    // requestMethod=quick naming
  if (Array.isArray(c)) return c;
  if (c && typeof c === 'object') return [c];      // single-result requests may
                                                    // return an object, not an array
  if (Array.isArray(j)) return j;                  // fallback: bare top-level array
  return null;                                     // unexpected shape
}
```
If `extractCnbcQuickRows` returns `null`, push one failure
`{ symbol: 'ALL', source: 'cnbc', reason: 'cnbc:unexpected_shape', raw: JSON.stringify(j).slice(0,200) }`
(the raw snippet makes the real path a 1-line fix on the next pass, matching
the "flag unconfirmed assumption, validate on first dispatch" discipline the
sibling design uses throughout for NASDAQ's `"Market Open"` row and CNBC's
`AFTER_HOURS` extended-type mapping).

Trailing-PE sign guard: CNBC returns an empty/zero/negative string for
loss-making issuers (SNOW, CRWD are GAAP-loss TTM per the current file).
`parseCnbcPE(raw)` must return `null` — not a negative or zero number — when
the cleaned value is `<= 0` or non-finite, matching the existing SNOW/CRWD
"not meaningful" convention already in the file.

### 1b. SEC XBRL — authoritative second source for TRAILING P/E only

Two-step, no persisted cache (see rationale below), one phase, budget-capped.

**Step 1 — ticker → CIK, refetched every run (not cached):**
```
https://www.sec.gov/files/company_tickers.json
```
Headers: `User-Agent: 'Traiding-Dashboard research contact: pebrikai67@gmail.com'`
— **reuse the exact string already shipped in `scripts/probe-sources.mjs`**
(this is the established, working convention in this repo; SEC's fair-access
policy requires a descriptive UA with a contact, not a generic browser UA —
using a fake browser UA here would violate SEC's own terms, unlike the other
sources where UA-spoofing is just anti-bot evasion). Response shape (stable,
public, well-documented SEC format):
```jsonc
{ "0": { "cik_str": 1652044, "ticker": "GOOGL", "title": "Alphabet Inc." }, "1": {...}, ... }
```
Build `TICKER -> String(cik_str).padStart(10, '0')` for just our 20 stock
tickers (ignore the other ~10,000 entries).

**Why refetch every run instead of caching:** the file is ~1MB and this
mapping almost never changes (new tickers only on IPO/rename). A persisted
cache would need a staleness TTL, a cache-file location that doesn't fit
`reports/raw/`'s dated-drop-per-collector-event convention (it's refresher-
owned, undated, in-place-overwritten — a genuine exception to
`reports/README.md`'s naming rule), and invalidation logic — real complexity
for saving one ~3-5s HTTP request per run, well inside the phase budget
(§9). Simplicity First: just refetch it. If `www.sec.gov` is unreachable
this run, the whole SEC phase is skipped for all 20 tickers (non-fatal,
logged) and self-heals next run — no stale-cache state to reason about.

10s timeout, 1 retry on 5xx/network only (no retry on 404 — the file either
exists or the endpoint changed, retrying won't help).

**Step 2 — per-ticker TTM diluted EPS:**
```
https://data.sec.gov/api/xbrl/companyconcept/CIK{cik10}/us-gaap/EarningsPerShareDiluted.json
```
Same UA header as step 1 (SEC's fair-access UA requirement applies to all of
`sec.gov`/`data.sec.gov`). Concurrency 5 (SEC's documented fair-access
guidance is ≤10 req/s; 5 concurrent 10s-timeout requests stays well under
that even in the worst case), 10s timeout, 1 retry on 5xx/network only
(no retry on 404 — CIK covers a company with no XBRL EPS facts, e.g. a
foreign private issuer, see below).

**TTM computation (the standard technique for this exact SEC shape):**
```js
function computeTtmEpsDiluted(json) {
  const facts = json?.units?.['USD/shares'];
  if (!Array.isArray(facts)) throw new Error('sec:no_data');

  // Isolate SINGLE-QUARTER facts by duration, not by the `fp` label —
  // annual (fp:"FY") facts span ~365 days; some filers also report 6/9-month
  // YTD cumulative facts. Filtering by (end-start) in [80,100] days robustly
  // keeps only true discrete-quarter figures regardless of label quirks.
  const quarterly = facts.filter(f => {
    if (f.val == null || !f.start || !f.end) return false;
    const days = (new Date(f.end) - new Date(f.start)) / 86400000;
    return days >= 80 && days <= 100;
  });
  if (!quarterly.length) throw new Error('sec:insufficient_quarters');

  // Dedupe by `end` date, keeping the LATEST `filed` (amendments/restatements
  // supersede the original filing for the same period).
  const byEnd = new Map();
  for (const f of quarterly) {
    const prev = byEnd.get(f.end);
    if (!prev || new Date(f.filed) > new Date(prev.filed)) byEnd.set(f.end, f);
  }
  const last4 = [...byEnd.values()].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 4);
  if (last4.length < 4) throw new Error('sec:insufficient_quarters');

  const ttmEps = +last4.reduce((s, f) => s + f.val, 0).toFixed(4);
  return { ttmEps, quartersUsed: last4.map(f => ({ end: f.end, val: f.val, form: f.form, filed: f.filed })) };
}
```
Hard phase budget: `SEC_PHASE_BUDGET_MS = 60_000` — checked before issuing
each companyconcept fetch (identical pattern to `YAHOO_PHASE_BUDGET_MS` in
`scrape-quotes.mjs`); once the deadline passes, remaining tickers are logged
as `sec:phase_budget_exhausted` and skipped, never blocking the run.

**Expected, named gap — foreign private issuers file annually, not
quarterly:** TSM (Taiwan, 20-F), ARM (UK, 20-F), and CLS (Canada, 40-F) are
foreign private issuers that generally do not furnish quarterly
`us-gaap:EarningsPerShareDiluted` facts the same way domestic 10-Q/10-K
filers do. Expect `sec:insufficient_quarters` for these three specifically —
this is a **named, justified expectation**, not a bug (see §8). CNBC and
stockanalysis.com remain their trailing-PE sources.

**Anchoring to the verified close (apples-to-apples, per requirement #4):**
SEC gives EPS only, never a price. The computed PE must use **our own**
verified close, not blend in any vendor's own price timestamp:
```js
const pq = await readJson('data/price-quotes.json');   // already written this
                                                          // run by scrape-quotes.mjs
const anchorPrice = pq.quotes?.[sym]?.price ?? null;
const anchorVerified = pq.quotes?.[sym]?.verified ?? false;
if (anchorPrice == null) throw new Error('sec:no_anchor_price');
const secComputedPE = +(anchorPrice / ttmEps).toFixed(2);   // only if ttmEps > 0
```
If `ttmEps <= 0` (loss-making), do not compute a PE — `perSource['sec-xbrl'].trailingPE = null`
with a note, matching the SNOW/CRWD "not meaningful" convention.

### 1c. stockanalysis.com HTML — best-effort tertiary, fails safe

```
https://stockanalysis.com/stocks/{symbol.toLowerCase()}/statistics/
```
`Accept: text/html`, existing UA, 8s timeout, **no retry** (best-effort,
protects the phase budget — see §9). The probe confirms HTTP 200 / 121KB but
flags this as "fragile to redesign." Extraction, in priority order, never
throwing:

1. Look for a `<script id="__NEXT_DATA__" type="application/json">...</script>`
   payload (most modern SSR stat sites embed structured data this way) and,
   if found, regex-scope a `"peRatio":([\d.]+)` / `"forwardPE":([\d.]+)`-style
   key inside just that captured blob (safer than parsing the full rendered
   HTML — a markup redesign is far less likely to touch the embedded JSON
   than the visible table).
2. Fallback: a labeled-row regex over the raw HTML, e.g.
   `/PE Ratio<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i` and
   `/Forward PE<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i`.
3. If neither matches: `failures.push({symbol, source:'stockanalysis', reason:'stockanalysis:extract_miss'})`,
   omit that source's `perSource` entry entirely — **never** crash the run
   over one fragile regex. This source's exact key names/markup are
   **unconfirmed** (the probe captured raw bytes, not a parsed structure) —
   the builder must inspect the actual first-dispatch HTML/JSON to finalize
   the regex; ship whatever pattern is written here as a best guess subject
   to that first-run correction (see §8 falsification #2).

stockanalysis's extracted `forwardPE` is tagged `basis: "NTM"` with
`basisConfidence: "assumed"` (see §2) — its own page does not explicitly
label the fiscal basis the way CNBC's `feps`/NASDAQ's chart do.

Concurrency 4, phase budget `STOCKANALYSIS_PHASE_BUDGET_MS = 45_000`.

### 1d. NASDAQ — FY-basis forward P/E (peg-ratio) + ETF metadata (summary)

```
https://api.nasdaq.com/api/analyst/{sym}/peg-ratio
```
Same headers/pattern as `fetchNasdaqOne` (Origin/Referer `nasdaq.com`).
Concurrency 3 (reuse the existing `nasdaqSem`-style semaphore convention),
16s timeout (matches `TIMEOUT_MS * 2` already used for NASDAQ elsewhere), 1
retry on 5xx only. Returns a chart of P/E by fiscal year, e.g.
`per.peRatioChart: [{category:"2025 Actual", value:31.82}, {category:"2026 Estimates", value:16.77}, {category:"2027 Estimates", value:23.34}]`
(exact key names **unconfirmed** — probe reported the values in prose, not
raw JSON; parse defensively and log `nasdaq-peg:unexpected_shape` rather than
throw if the expected keys are absent).

Only rows matching `/(\d{4})\s+Estimates?/i` are forward-looking — skip
`"* Actual"` rows entirely (already-reported, not forward). Derive
`basis = "FY" + year + "E"` from the matched year.

`earnings-forecast` is explicitly **not** fetched in v1 — `peg-ratio` already
gives P/E directly with no re-derivation needed, and adding a second NASDAQ
endpoint has no schema requirement backing it this pass (see the v1.1 note
in §2).

**ETF metadata**, same host/phase, 2 requests (SOXL, TSMU):
```
https://api.nasdaq.com/api/quote/{sym}/summary?assetclass=etf
```
Fields per the probe: `ExpenseRatio` (e.g. "0.90%"), `AUM` (e.g. "$1.2B"),
`Beta`. **Exact JSON key casing unconfirmed** — the probe quoted these in
prose, not a raw payload. Parse defensively, trying both `PascalCase` and
`camelCase` variants under `data.summaryData.*.value`, matching the same
`{label, value}` shape already established for `OneYrTarget` in the probe;
log `nasdaq-etf:unexpected_shape` and leave the fields `null` rather than
guess wrong. This shares the NASDAQ phase (same host, same budget).

NASDAQ phase budget: `NASDAQ_PHASE_BUDGET_MS = 45_000` (peg-ratio + ETF
summary combined).

---

## 2. The forward-P/E basis problem — core design decision

**Rule: a forward P/E is only ever compared against another forward P/E on
the exact same `basis` string. Never averaged, never cross-verified across
bases.** This is enforced by one gate in the verification function — no
tolerance math ever runs on a pair whose `basis` differs.

- CNBC `fpe`/`feps` → `basis: "NTM"`, `basisConfidence: "confirmed"` (CNBC's
  own field semantics are next-twelve-months consensus, unambiguous).
- NASDAQ peg-ratio `"20XX Estimates"` rows → `basis: "FY20XXE"`,
  `basisConfidence: "confirmed"` (explicitly fiscal-year-labeled on the
  source page).
- stockanalysis.com's extracted forward PE → `basis: "NTM"` (assumed — most
  retail stat sites default "Forward P/E" to NTM consensus, matching CNBC's
  convention), `basisConfidence: "assumed"` — **not verified against a
  labeled fiscal year on the page**. `basisConfidence` is audit metadata
  only; it never gates the tolerance math (that's `basis` string equality
  alone) — keeping the actual verification logic single-dimensional.

```js
function pairwiseVerify(perSource, tolerance) { /* identical to scrape-quotes.mjs's helper — duplicated locally, not shared, matching house convention */ }

function verifyForwardByBasis(entries) {
  // entries: [{ source, value, basis }]
  const byBasis = {};
  for (const e of entries) (byBasis[e.basis] ??= []).push(e);
  const out = {};
  for (const [basis, group] of Object.entries(byBasis)) {
    const perSource = Object.fromEntries(group.map(g => [g.source, g.value]));
    const { verified, minDelta } = group.length >= 2
      ? pairwiseVerify(perSource, TOLERANCE.forwardPE)
      : { verified: false, minDelta: null };
    out[basis] = { value: group[0].value, verified, sourceCount: group.length, perSource, deltaPct: minDelta };
  }
  return out;
}
```

**Expected reality at ship time:** CNBC is the only source reliably
publishing NTM (`feps`/`fpe`); NASDAQ only publishes FY-basis. So
`forwardPEByBasis.NTM.verified` will almost always be `false`
(single-source) unless stockanalysis's assumed-NTM figure happens to parse
AND land within tolerance — this is **honest, not broken** (see §8).

**What `index.html` displays when only one basis is available** (requirement
#2, and it must keep working with zero code change — confirmed via grep
that only `r.trailingPE`/`r.forwardPE`/`r.peVerified`/`r.peNA`/`r.peReason`
are read):

- Top-level `forwardPE`/`forwardPEBasis` (kept for back-compat) resolve via a
  priority chain: `cnbc.fpe (NTM) ?? stockanalysis.forwardPE (assumed NTM) ?? nearestFYBasisFromNasdaq ?? null`.
  In practice this means `forwardPE` is the NTM figure almost every cycle —
  identical in spirit to what the current single-source data already
  approximates (the current file's GOOGL `forwardPE: 26.91` is close to the
  probe's CNBC NTM figure `26.06` — same basis, same neighborhood).
- `forwardPEBasis` is **always** populated whenever `forwardPE` is non-null,
  so a value's basis is never ambiguous even though `index.html` doesn't
  render it yet.
- `forwardPEBasisNote` is populated **only** in the fallback case (basis !=
  "NTM") — e.g. `"No NTM consensus available this cycle — showing FY2026E
  (NASDAQ consensus) instead."` — kept absent in the common case to avoid
  clutter, present only when it matters.
- The full `forwardPEByBasis` object (all bases, each independently
  verified) is additive and **not consumed by `index.html`** — this is
  deliberately deferred UI work, exactly like the sibling design's `extended`
  block (§6 there). A future small patch to the PER detail block (L1255-1257)
  could render each basis on its own line, e.g. `Fwd(NTM) 26.1 · Fwd(FY26E) 16.8`
  — noted for a future builder, not implemented here.

**v1.1 follow-up noted, not implemented:** NASDAQ's `earnings-forecast`
endpoint may carry an explicit NTM consensus EPS figure, which would give
`forwardPEByBasis.NTM` a genuine second source and let it actually verify.
Skipped in v1 for the reason in §1d (no schema requirement backing it yet,
keeps the request count down).

---

## 3. Full schema

### `data/fundamentals.json`

```jsonc
{
  "note": "Owned by refresher agent + GitHub Actions data-refresh workflow (scripts/scrape-fundamentals.mjs). Supersedes the prior validator/WebSearch-synthesis phase — see data/README.md for the ownership history. trailingPE = CNBC's reported TTM PE (falls back to stockanalysis.com, then a SEC-XBRL-computed figure anchored to the verified close in data/price-quotes.json). trailingVerified = TTM diluted EPS agreement (CNBC vs SEC-XBRL, and stockanalysis when it exposes EPS) within tolerance.trailingEps — see tolerance.trailingPE for the wider raw-PE fallback comparison used only when no source exposes a separate EPS figure. forwardPE/forwardPEBasis = the NTM-basis consensus figure when available (CNBC feps, falls back to stockanalysis, then the nearest NASDAQ FY-basis estimate — see forwardPEBasisNote when that fallback fires). forwardPEByBasis carries every basis independently, each verified only against another source on the SAME basis — forward P/Es on different bases are NEVER cross-verified or averaged (see reports/designs/2026-08-18-fundamentals-scraper.md §2). verified (top-level, back-compat) is UNCHANGED semantics: true only if BOTH trailingVerified AND forwardVerified pass — expect this to be rare under basis-aware forward verification; trailingVerified is the more informative signal going forward. ETFs get notApplicable plus real expenseRatio/aum/etfBeta from NASDAQ's ETF summary.",
  "updated": "2026-08-18T21:07:00Z",
  "asOfDate": "2026-08-18",
  "agent": "refresher",
  "sources": ["cnbc", "sec-xbrl", "stockanalysis", "nasdaq-peg"],
  "tolerance": {
    "trailingEps": 0.01,   // PRIMARY — EPS-vs-EPS, price-timing-independent. Reuses validator.md's
                            // already-documented "1% for fundamentals (EPS/rev)" convention.
    "trailingPE": 0.05,    // FALLBACK ONLY — raw PE-vs-PE, used when no second source exposes EPS
                            // directly. Widened from the old 0.03 specifically to absorb cross-vendor
                            // price-timestamp drift (see §4) — reuses the file's own pre-existing 0.05,
                            // not a new invented number.
    "forwardPE": 0.05      // UNCHANGED value; semantics now scoped to same-basis pairs only (§2)
  },
  "fundamentals": {
    "GOOGL": {
      "updated": "2026-08-18",
      "agent": "refresher",
      "asOf": "2026-08-18",
      "trailingPE": 17.26,
      "eps": 19.93,                     // TTM diluted EPS backing trailingPE (CNBC's own figure)
      "trailingVerified": true,         // NEW split flag — see §4
      "forwardPE": 26.06,
      "forwardPEBasis": "NTM",          // REQUIRED whenever forwardPE is non-null
      "forwardEps": 13.199,
      "forwardVerified": false,         // NEW split flag — see §4
      "verified": false,                // UNCHANGED semantics: trailingVerified AND forwardVerified
      "sourceCount": 3,                 // NOW MEANS: distinct sources with a non-null trailingPE
      "notApplicable": false,
      "perSource": {
        "cnbc": { "trailingPE": 17.2604, "eps": 19.93, "forwardPE": 26.0626, "forwardPEBasis": "NTM", "forwardEps": 13.199 },
        "sec-xbrl": {
          "trailingPE": 17.31, "epsUsed": 19.87,
          "quartersUsed": ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"],
          "anchorPrice": 344.00, "anchorVerified": true, "anchorSource": "data/price-quotes.json"
        },
        "stockanalysis": { "trailingPE": 17.94, "forwardPE": 26.91, "forwardPEBasis": "NTM", "basisConfidence": "assumed" }
      },
      "forwardPEByBasis": {
        "NTM":     { "value": 26.06, "verified": false, "sourceCount": 2, "perSource": { "cnbc": 26.0626, "stockanalysis": 26.91 }, "deltaPct": 0.0326 },
        "FY2026E": { "value": 16.77, "verified": false, "sourceCount": 1, "perSource": { "nasdaq-peg": 16.77 } },
        "FY2027E": { "value": 23.34, "verified": false, "sourceCount": 1, "perSource": { "nasdaq-peg": 23.34 } }
      }
    },
    "TSM": {
      "updated": "2026-08-18",
      "agent": "refresher",
      "asOf": "2026-08-18",
      "trailingPE": 29.62,
      "eps": 11.62,
      "trailingVerified": false,
      "forwardPE": 19.10,
      "forwardPEBasis": "NTM",
      "forwardVerified": false,
      "verified": false,
      "sourceCount": 2,
      "notApplicable": false,
      "perSource": {
        "cnbc": { "trailingPE": 29.62, "eps": 11.62, "forwardPE": 19.10, "forwardPEBasis": "NTM" },
        "stockanalysis": { "trailingPE": 29.70, "forwardPE": 19.27, "forwardPEBasis": "NTM", "basisConfidence": "assumed" }
      },
      "note": "TSM is a Taiwan 20-F foreign private issuer — SEC XBRL companyconcept has no quarterly EarningsPerShareDiluted facts (annual-only reporting); sec-xbrl leg not attempted for this reason, not a fetch failure."
    },
    "SOXL": {
      "updated": "2026-08-18",
      "agent": "refresher",
      "trailingPE": null,
      "forwardPE": null,
      "notApplicable": true,
      "reason": "Leveraged ETF — PE not meaningful (NAV tracks 3x SOX basket, no issuer earnings)",
      "expenseRatio": 0.0090,
      "aum": "$1.2B",
      "etfBeta": 5.73,
      "etfAsOf": "2026-08-18"
    }
  },
  "failures": [
    { "symbol": "ARM", "source": "sec-xbrl", "reason": "sec:insufficient_quarters" },
    { "symbol": "CLS", "source": "sec-xbrl", "reason": "sec:insufficient_quarters" },
    { "symbol": "SNOW", "source": "stockanalysis", "reason": "stockanalysis:extract_miss" }
  ]
}
```

Notes on field semantics changes (all confirmed safe — grep shows `perSource`,
`sourceCount`, `tolerance` are never read by `index.html`):
- `perSource`'s per-entry shape is free to evolve (it was already a loosely-
  typed bag of optional keys — `excluded`/`excludedReason`/`forwardPENote`
  in the current file). Adding `forwardPEBasis`/`epsUsed`/etc. per entry is
  additive in spirit even though the literal old keys aren't all preserved.
- `sourceCount` is **redefined** (documented, not silently changed) to mean
  "distinct sources with a non-null `trailingPE`" — the old file used it
  loosely for the same rough purpose already.
- The old `excluded`/`excludedReason` outlier-rejection pattern is **retired**:
  Fix-B-style ANY-PAIR verification (already the house convention for quotes,
  now reused here) means one stale/wrong source among 3 no longer needs a
  manual exclusion flag to avoid falsely un-verifying a pair that already
  agrees.

### `data/README.md` delta

Update the ownership table row:
```diff
-| `fundamentals.json` | Trailing/forward P/E per ticker; ETFs marked notApplicable | validator (phase 1) / scripts/scrape-fundamentals.mjs (phase 2) |
+| `fundamentals.json` | Trailing/forward P/E per ticker (basis-aware, cross-verified) + ETF expense ratio/AUM | refresher agent + GH Actions (`scripts/scrape-fundamentals.mjs`) |
```

Replace the `### fundamentals.json` section (current lines 232-272) with:

~~~markdown
### fundamentals.json
Owner: **refresher agent + GitHub Actions data-refresh workflow**
(`scripts/scrape-fundamentals.mjs`) — same ownership model as
`price-quotes.json`. This **supersedes** the prior validator/WebSearch-
synthesis phase entirely; the validator no longer writes this file (the
whole point of this revision is to replace "AI-generated snapshot of a
search snapshot" provenance with direct-fetch, cron-refreshed, cross-
verified data — see `reports/designs/2026-08-18-fundamentals-scraper.md`).

Sources: **CNBC** batched `quote.htm` (primary — `pe`/`eps`/`fpe`/`feps`),
**SEC XBRL** `companyconcept` (authoritative TTM diluted EPS, computed PE
anchored to the verified close in `price-quotes.json` — domestic 10-Q/10-K
filers only; foreign private issuers like TSM/ARM/CLS file annually and are
expected to miss this leg, see their `note`), **stockanalysis.com**
statistics page (best-effort HTML regex extraction, fails safe), **NASDAQ**
`peg-ratio` (FY-basis forward P/E estimates) + `summary?assetclass=etf`
(expense ratio/AUM/beta for SOXL/TSMU).

**Forward P/E is basis-aware, not one number** (see the design doc §2 for
the full rationale): every forward P/E carries an explicit `forwardPEBasis`
(`"NTM"` or `"FY20XXE"`) and is **only ever cross-verified against another
source on the identical basis** — never averaged or compared across bases.
`forwardPEByBasis` carries every basis independently; the top-level
`forwardPE`/`forwardPEBasis` (kept for `index.html` back-compat) resolve to
the NTM figure when available, falling back to the nearest FY-basis estimate
(flagged via `forwardPEBasisNote`) only when no NTM source succeeded that
cycle.

**Trailing P/E verification is EPS-based, not PE-based**, at a **1%**
tolerance (`tolerance.trailingEps` — reuses validator.md's already-
documented "1% for fundamentals (EPS/rev)" convention): comparing TTM
diluted EPS directly removes cross-vendor price-timestamp noise (each raw
source's own PE divides by its OWN last-price snapshot, which may not match
our verified close's timestamp). A wider **5%** raw-PE fallback
(`tolerance.trailingPE`) applies only when a second source exposes a PE with
no separate EPS figure to compare instead. `verified: true` (top-level,
combined) requires **both** legs (`trailingVerified` AND `forwardVerified`)
— per the basis-purity rule above, `forwardVerified` will be single-source-
false most cycles, so **`trailingVerified` is the more informative signal**
day to day; a future `index.html` patch may switch the PER-block badge to
read it directly (documented, not implemented — see the design doc §2).

```jsonc
{
  "updated": "2026-08-18T21:07:00Z",
  "asOfDate": "2026-08-18",
  "agent": "refresher",
  "sources": ["cnbc", "sec-xbrl", "stockanalysis", "nasdaq-peg"],
  "tolerance": { "trailingEps": 0.01, "trailingPE": 0.05, "forwardPE": 0.05 },
  "fundamentals": {
    "GOOGL": {
      "updated": "2026-08-18", "agent": "refresher", "asOf": "2026-08-18",
      "trailingPE": 17.26, "eps": 19.93, "trailingVerified": true,
      "forwardPE": 26.06, "forwardPEBasis": "NTM", "forwardEps": 13.199, "forwardVerified": false,
      "verified": false, "sourceCount": 3, "notApplicable": false,
      "perSource": {
        "cnbc": { "trailingPE": 17.2604, "eps": 19.93, "forwardPE": 26.0626, "forwardPEBasis": "NTM" },
        "sec-xbrl": { "trailingPE": 17.31, "epsUsed": 19.87, "anchorPrice": 344.00, "anchorVerified": true }
      },
      "forwardPEByBasis": {
        "NTM": { "value": 26.06, "verified": false, "sourceCount": 1, "perSource": { "cnbc": 26.0626 } },
        "FY2026E": { "value": 16.77, "verified": false, "sourceCount": 1, "perSource": { "nasdaq-peg": 16.77 } }
      }
    },
    "SOXL": {
      "updated": "2026-08-18", "agent": "refresher",
      "trailingPE": null, "forwardPE": null, "notApplicable": true,
      "reason": "Leveraged ETF — PE not meaningful",
      "expenseRatio": 0.0090, "aum": "$1.2B", "etfBeta": 5.73
    }
  },
  "failures": [ { "symbol": "ARM", "source": "sec-xbrl", "reason": "sec:insufficient_quarters" } ]
}
```
~~~

### `reports/raw/YYYY-MM-DD-fundamentals.json` (audit-trail drop)

```jsonc
{
  "agent": "refresher",
  "runAt": "2026-08-18T21:07:00Z",
  "asOfDate": "2026-08-18",
  "perSourceRaw": {
    "cnbc": { "GOOGL": { "pe": "17.2604", "eps": "19.93", "fpe": "26.0626", "feps": "13.199", "last": "344.00" } },
    "sec-xbrl": {
      "GOOGL": {
        "cik": "0001652044",
        "quartersUsed": [
          { "end": "2026-06-30", "val": 5.10, "form": "10-Q", "filed": "2026-07-25" },
          { "end": "2026-03-31", "val": 4.95, "form": "10-Q", "filed": "2026-04-25" },
          { "end": "2025-12-31", "val": 5.20, "form": "10-K", "filed": "2026-02-01" },
          { "end": "2025-09-30", "val": 4.68, "form": "10-Q", "filed": "2025-10-25" }
        ],
        "ttmEps": 19.93, "anchorPrice": 344.00, "anchorVerified": true, "computedPE": 17.26
      }
    },
    "stockanalysis": { "GOOGL": { "extracted": true, "trailingPE": 17.94, "forwardPE": 26.91, "method": "next-data-json" } },
    "nasdaq-peg": { "GOOGL": { "chart": [ { "category": "2025 Actual", "value": 31.82 }, { "category": "2026 Estimates", "value": 16.77 }, { "category": "2027 Estimates", "value": 23.34 } ] } },
    "nasdaq-etf": { "SOXL": { "expenseRatio": "0.90%", "aum": "$1.2B", "beta": "5.73" } }
  },
  "failures": [ { "symbol": "ARM", "source": "sec-xbrl", "reason": "sec:insufficient_quarters" } ]
}
```
Every ticker attempted appears under every source it was attempted against
— on extraction failure the entry is `{ "extracted": false, "reason": "..." }`,
never an omitted key (matches the "failure is data" convention already
stated in `refresher.md`).

### `reports/validation/YYYY-MM-DD-fundamentals-compare.json`

Produced by the same script (no separate `verify-fundamentals.mjs` — see
§6 rationale), `agent: "refresher"` (accurate — no distinct comparator
invocation happens here, unlike quotes' two-script split which exists partly
to re-verify after a manual Kapture import; fundamentals has no equivalent
manual-import path):
```jsonc
{
  "agent": "refresher",
  "runAt": "2026-08-18T21:07:00Z",
  "tolerance": { "trailingEps": 0.01, "trailingPE": 0.05, "forwardPE": 0.05 },
  "summary": { "trailingVerified": 17, "trailingTotal": 20, "forwardVerifiedAnyBasis": 1, "forwardTotal": 20 },
  "compare": [
    { "symbol": "GOOGL", "leg": "trailing", "basis": "eps", "status": "verified", "deltaPct": 0.003, "sources": { "cnbc": 19.93, "sec-xbrl": 19.87 } },
    { "symbol": "GOOGL", "leg": "forward", "basis": "NTM", "status": "mismatch", "deltaPct": 0.0326, "sources": { "cnbc": 26.0626, "stockanalysis": 26.91 } }
  ]
}
```

---

## 4. Tolerances — full rationale

**Trailing P/E — two-tier, EPS-basis primary:**
1. **Primary (`tolerance.trailingEps = 0.01`, 1%):** compare TTM diluted EPS
   directly (CNBC's `eps` vs SEC-XBRL's computed `ttmEps`, and
   stockanalysis's EPS if it happens to expose one). This is the genuinely
   apples-to-apples check requirement #4 asks for — EPS is the one input
   that shouldn't depend on WHICH vendor's price snapshot was used, so
   comparing EPS directly strips out the price-timing noise entirely. 1% is
   not a new invented number — it's `validator.md`'s already-documented,
   already-in-production tolerance for "fundamentals (EPS/rev)."
2. **Fallback (`tolerance.trailingPE = 0.05`, 5%, only when no second source
   exposes a separate EPS):** compare raw PE-vs-PE (e.g. CNBC's `pe` vs
   stockanalysis's scraped PE, if SEC-XBRL failed for that ticker). This
   *must* be wider than the EPS check because it inherits a second, real
   error source the task explicitly flags: **different sources may compute
   PE against their own last-price snapshot, taken at different times of
   day**, on top of any EPS-methodology (GAAP vs non-GAAP) difference. 5%
   was chosen over inventing a new number because it's the file's own
   pre-existing `forwardPE` tolerance — reusing an already-shipped constant
   for a comparably noisy ratio, rather than introducing a third distinct
   magic number (widened from the old file's `trailingPE: 0.03`, which was
   set when the entire file was single-provenance WebSearch synthesis with
   no real cross-vendor timing analysis behind it).

**Anchoring, precisely (requirement #4):** the SEC leg's PE is **always**
computed as `data/price-quotes.json`'s `quotes[sym].price` (our own verified
regular-session close, written earlier in the same workflow run) divided by
the SEC-computed `ttmEps` — never SEC's own price (SEC XBRL doesn't supply
one) and never CNBC's price. `perSource['sec-xbrl'].anchorVerified` carries
through `price-quotes.json`'s own `verified` flag for that symbol, so a
downstream reader can see whether the anchor itself was cross-source-
verified (e.g. if `price-quotes.json`'s quote pipeline had a bad day for
that symbol, the SEC-computed PE inherits that uncertainty transparently
rather than silently).

**Forward P/E (`tolerance.forwardPE = 0.05`, unchanged value, narrowed
scope):** same 5% as before, but now gated by the `basis` equality check in
§2 — it is a comparison error, not a tolerance error, that the old schema
made possible (comparing NTM against FY-based numbers). The tolerance value
itself didn't need to change; the comparison eligibility did.

---

## 5. ETFs

SOXL and TSMU keep `notApplicable: true` (unchanged trigger condition and
`reason` text) — CNBC/SEC/stockanalysis/NASDAQ-peg are never attempted for
these two symbols (no PE work to do). New, additive fields sourced from
NASDAQ's ETF summary (§1d):
- `expenseRatio` — fraction (e.g. `0.0090` for "0.90%"), matching the repo's
  "percents as fractions in JSON" convention (CLAUDE.md).
- `aum` — **raw string as scraped** (e.g. `"$1.2B"`). Deliberately not
  parsed to a number — AUM figures use inconsistent suffix formats (`B`/`M`,
  occasionally full digits) across NASDAQ's own pages over time, and nothing
  in `index.html` consumes this field numerically (it isn't read at all
  today), so a fragile parser would be speculative complexity for zero
  current benefit (Simplicity First). A future consumer that needs a number
  can parse the string itself.
- `etfBeta` — number, optional (present only if NASDAQ's summary returns it
  for that ETF).
- `etfAsOf` — `YYYY-MM-DD` of the ETF-metadata scrape.

---

## 6. Wiring

### Workflow placement

```yaml
      - name: Scrape quotes (nasdaq+cboe+cnbc)     # (sibling design's renamed step)
        run: node scripts/scrape-quotes.mjs

      - name: Scrape news (Google News RSS)
        run: node scripts/scrape-news.mjs
        continue-on-error: true

      - name: Verify quotes (cross-source)
        run: node scripts/verify-quotes.mjs

      - name: Scrape fundamentals (cnbc+sec-xbrl+stockanalysis+nasdaq)   # NEW
        if: github.event_name == 'workflow_dispatch' || github.event.schedule == '0 21 * * 1-5'
        run: node scripts/scrape-fundamentals.mjs
        continue-on-error: true

      - name: Validate JSON
        run: |
          for f in data/*.json; do
            node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f"
          done
```

**Placement rationale:** runs after `Verify quotes` so it reads
`data/price-quotes.json`'s fully-finalized `verified` stamp for the SEC
anchor (scrape-quotes.mjs already computes the same value inline, so before-
vs-after `verify-quotes.mjs` is equivalent in practice — placed after purely
for read-order clarity, not correctness).

**`continue-on-error: true`:** matches the existing `Scrape news` step, not
`Scrape quotes`/`Verify quotes` (which are hard-fail). `data/fundamentals.json`
is explicitly documented in `data/README.md` as "Optional / progressive
enhancement (missing ⇒ that column/detail-block renders `—` or `N/A`, the
rest of the panel still works)" — this step failing must never block the
commit of quotes/news, which are required data.

**Cadence — post-close slot only, not both:** fundamentals inputs (SEC
quarterly filings, analyst consensus, CNBC's own PE calc) don't change
intraday or between a pre-market and post-close run on the same day; running
twice a day only doubles load on rate-limited/goodwill-based sources (SEC's
fair-access policy, stockanalysis.com's scraping surface) for zero
freshness benefit. The `if:` condition restricts the scheduled cron to the
21:00 UTC (post-close) slot only, while `workflow_dispatch` always runs it
regardless of trigger — required for the CI-dispatch acceptance testing in
§8, since the dev sandbox cannot reach any of these hosts. Post-close was
picked over pre-market for the anchor price specifically: at 21:00 UTC the
`price-quotes.json` anchor is the **just-completed today's** regular close
(the cleanest, most current anchor); at 11:00 UTC pre-market it would be
**yesterday's** close (also valid, but a day stale relative to the
same-day post-close alternative).

### Ownership conflict — resolved

`data/fundamentals.json` was "owned by validator agent (phase 1) /
scripts/scrape-fundamentals.mjs (phase 2), agent field reflects whichever
wrote last" — an explicitly hedged, ambiguous contract. This design
**retires the validator's phase-1 role for this file entirely** and adopts
the exact ownership precedent `price-quotes.json` already establishes:
**refresher agent + GitHub Actions workflow**, full stop. `agent: "refresher"`
is the only value written going forward (see the README delta in §3). The
validator should not hand-write this file again once the script ships — no
more "whichever wrote last" ambiguity.

`validator.md` requires **no change** — its job description only covers
`data/news-feed.json`, never mentions `fundamentals.json` by name.
`refresher.md` is not touched by this design either, matching the sibling
design's own precedent of leaving `refresher.md`/`comparator.md` alone —
worth flagging (not fixing here, per Surgical Changes) that `refresher.md`'s
step list (§1) does not yet mention `scrape-fundamentals.mjs`, and its
header comment is already known-stale re: quote sources per CLAUDE.md's
Gotchas section; both are pre-existing drift outside this design's scope.

---

## 7. Scope boundary — analyst-targets follow-up (NOT in this design)

The probe found `api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks`
→ `summaryData.OneYrTarget` gives a single machine-readable analyst target
figure (`$430.00` GOOGL, `$1,500.00` MU) alongside `PreviousClose`,
`MarketCap`, `AnnualizedDividend`, `Yield`, and 52-week range — the same
`/summary` endpoint family this design already uses for ETF metadata (§1d,
§5). This could let `data/analyst-targets.json` move off pure WebSearch
synthesis the same way this design moves fundamentals off it. It is
explicitly **out of scope here**: `OneYrTarget` alone doesn't supply the
existing schema's `low`/`high`/`numAnalysts` spread (only a single mean-like
figure), so it needs its own second source and its own architect pass to
decide how the spread gets populated — recorded here so it isn't
rediscovered from scratch.

---

## 8. Acceptance gates

**Expected verified counts (20 stock tickers; SOXL/TSMU excluded, always
`notApplicable`):**
- `trailingPE` populated: ~20/20 (CNBC batched request covers the full
  stock universe in one call — matches the sibling design's confirmed
  full-coverage CNBC pattern for quotes).
- `trailingVerified: true`: **~17/20** — expect TSM, ARM, CLS to miss
  specifically because they're foreign private issuers with no quarterly
  XBRL EPS facts (§1b, §3 `note` field). If **more** than these three miss,
  investigate the CIK-resolution step or the quarterly-span filter — not
  assumed broken by default, but not expected either.
- `forwardPE` populated: ~20/20 (same CNBC batch supplies `fpe`/`feps`).
- `forwardPEByBasis.NTM.verified`: expect **mostly false** (single-source,
  CNBC only, unless stockanalysis's assumed-NTM figure both extracts AND
  lands within 5%) — **this is not a failure signal**, it's the direct,
  correct consequence of the basis-purity rule in §2. Do not read a low
  count here as broken.
- Top-level `verified` (AND of both legs): expect **near-zero** true counts
  for the same reason — again, not a failure signal; `trailingVerified` is
  the metric to actually watch (see the README delta's explicit callout).
- `expenseRatio`/`aum` populated: 2/2 (SOXL, TSMU).
- `stockanalysis` extraction hit rate: **genuinely unknown** until the first
  CI dispatch — don't gate the run's success on it; only its hit rate is
  logged for future regex tuning.

**What would falsify this design:**
1. CNBC's `quote.htm` batch returns 0/20 parseable rows on two consecutive
   dispatch runs — the `QuickQuoteResult.QuickQuote` envelope guess (§1a) is
   wrong; check the logged raw-snippet failure and fix the extraction path
   in a 1-line follow-up.
2. `stockanalysis:extract_miss` fires for 20/20 tickers across two
   consecutive dispatch runs while the fetch itself returns HTTP 200 — the
   regex/`__NEXT_DATA__` guess in §1c needs a real look at the returned HTML
   (CI-only, the dev sandbox cannot fetch it).
3. `trailingVerified` stays below ~10/20 across two consecutive dispatch
   runs — the 1% EPS tolerance is systematically too tight, or the SEC
   quarter-duration filter (§1b) is picking the wrong facts (e.g.
   accidentally including an annual figure) — a logic/tolerance revisit,
   not a data problem.
4. Any of TSM/ARM/CLS unexpectedly succeeds on the SEC leg — harmless
   (bonus, not a bug), but worth noting since it means the filer-type
   assumption in §1b was wrong for that issuer.
5. Any ETF (SOXL/TSMU) shows a non-null `trailingPE`/`forwardPE` — schema
   regression, `notApplicable` gate broken.
6. `sec:no_anchor_price` fires for a ticker that DOES have a
   `data/price-quotes.json` entry — the anchor-read wiring (§1b) is broken,
   not a genuine missing-quote case.
7. Total script wall time exceeds 2 minutes on a clean run with no
   widespread timeouts — the phase-budget/concurrency tuning in §9 needs
   revisiting (should not happen given the hard budget caps, but worth a
   named tripwire per the runtime constraint).

---

## 9. Runtime budget

Four phases run **concurrently** via `Promise.all` — total wall time is the
**max**, not the sum, of the phase budgets:

| Phase | Requests | Concurrency | Per-request timeout | Hard phase budget |
|---|---|---|---|---|
| CNBC | 1 (+1 retry) | — | 8s | ≤16s |
| SEC XBRL | 1 CIK-map + 20 companyconcept | 5 | 10s | 60s (hard cap, `SEC_PHASE_BUDGET_MS`) |
| stockanalysis | 20 | 4 | 8s | 45s (hard cap) |
| NASDAQ (peg + ETF) | 20 + 2 | 3 | 16s | 45s (hard cap) |

Worst-case total ≈ **max(16, 60, 45, 45) + merge/write (~1s) ≈ 61s** — well
inside the ≤2-minute constraint and the workflow's 8-minute job timeout, and
consistent with the sibling design's own ≈2-minute worst-case budget for the
quotes pipeline running in the same job. In practice most requests succeed
in 1-3s, so real-world runtime should be well under 30s.

---

## 10. Backward compatibility summary

- `trailingPE` / `forwardPE` / `verified` / `notApplicable` / `reason` — same
  keys, same types, confirmed via grep as the **only** fields `index.html`
  reads. Zero code change required.
- `verified`'s **semantics are unchanged** (AND of both legs) — deliberately
  kept exactly as documented rather than silently redefined, per CLAUDE.md's
  stated preference for additive-over-breaking. The new `trailingVerified`/
  `forwardVerified` split fields are additive and carry the more useful
  day-to-day signal; a future UI patch may adopt them (documented, not
  implemented).
- `perSource` / `sourceCount` / `tolerance` — confirmed via grep as **never
  read** by `index.html`; free to reshape. `sourceCount`'s meaning is
  narrowed to "trailing" specifically (documented above, not silently).
- `agent` — now always `"refresher"` going forward; the old
  `"validator"`/hedged-ambiguous convention is retired (§6).
- New top-level fields (`asOfDate`, `sources`) and new per-ticker fields
  (`eps`, `forwardEps`, `trailingVerified`, `forwardVerified`,
  `forwardPEBasis`, `forwardPEBasisNote`, `forwardPEByBasis`, `expenseRatio`,
  `aum`, `etfBeta`, `etfAsOf`) are all additive/optional — a consumer
  written against the pre-2026-08-18 schema keeps working unmodified.
- `tolerance.trailingPE`'s numeric value changes (0.03 → 0.05) — confirmed
  safe, this field is never read by `index.html`.
- No changes to `index.html`, `data/tickers-universe.json`,
  `data/price-quotes.json` schema (read-only dependency, already landing via
  the sibling design), `validator.md`, or `refresher.md`.

## 11. Test plan

1. `node -e "JSON.parse(require('fs').readFileSync('data/fundamentals.json'))"`
   and the same over `reports/raw/*.json` / `reports/validation/*.json` —
   existing CI "Validate JSON" step, unchanged, must stay green.
2. `node scripts/scrape-fundamentals.mjs` via `workflow_dispatch` — **must**
   run in CI (dev sandbox cannot reach any of these hosts). Confirm console
   summary line reports trailing/forward counts matching §8's expectations.
3. Inspect the resulting `reports/raw/YYYY-MM-DD-fundamentals.json` for:
   CNBC envelope shape actually matched (§1a), SEC `quartersUsed` looking
   like 4 genuinely distinct fiscal quarters (not duplicates, not an
   accidental annual figure), stockanalysis extraction hit rate, NASDAQ
   peg-ratio chart shape.
4. Inspect `data/fundamentals.json` for: GOOGL (or any large-cap) showing
   `trailingVerified: true` with a sub-1% EPS delta in `perSource`; TSM/ARM/
   CLS showing the expected `sec:insufficient_quarters` note; SOXL/TSMU
   showing non-null `expenseRatio`/`aum` and still-null `trailingPE`.
5. Confirm `forwardPEByBasis` never mixes a `NTM` value into a `FY20XXE`
   group or vice versa — spot-check one ticker with both bases present.
6. Open the dashboard (`python3 -m http.server 8765`), expand a few PER
   detail rows, confirm the existing Trail/Fwd/verified-badge rendering
   still works with no console errors — proves the additive schema didn't
   disturb `index.html`.
7. Confirm total job wall time for the fundamentals step stays under 2
   minutes in the Actions log.
8. Two consecutive green `workflow_dispatch` runs with no falsification
   trigger from §8 → mark ready; re-run once more organically on the next
   scheduled 21:00 UTC slot to confirm the `if:` cadence gate behaves.

## 12. File-by-file change list (for the builder)

- **`scripts/scrape-fundamentals.mjs`** (new) — implements all four phases
  (§1), the basis-aware forward-PE verification (§2), the two-tier trailing
  tolerance (§4), ETF metadata (§5), writes `data/fundamentals.json` +
  `reports/raw/YYYY-MM-DD-fundamentals.json` +
  `reports/validation/YYYY-MM-DD-fundamentals-compare.json` atomically via
  `scripts/lib/io.mjs`'s existing `writeJsonAtomic`/`readJson`/`withTimeout`/
  `Semaphore` helpers (no new shared-lib code needed — everything required
  already exists there). Exits non-zero only on a genuinely fatal error
  (e.g. can't read `data/tickers-universe.json`); per-source failures are
  data (`failures[]`), never a process exit.
- **`data/README.md`** — ownership table row + `### fundamentals.json`
  section replacement (§3).
- **`.github/workflows/data-refresh.yml`** — new step, placed after
  `Verify quotes`, `continue-on-error: true`, `if:` gated to
  `workflow_dispatch` or the 21:00 UTC cron only (§6).
- No changes to `index.html`, `data/tickers-universe.json`,
  `data/price-quotes.json`, `validator.md`, `refresher.md`,
  `scripts/scrape-quotes.mjs`, `scripts/verify-quotes.mjs`.
