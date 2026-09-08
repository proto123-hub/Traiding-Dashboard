# Design — Phase 3 trackers (yields, HBM share, NAND price, Anthropic funding events)

Grounded in `data/README.md` (schema house style, the `news-latest.json`
derived-slice precedent, the `analyst-targets.json` collector-raw-drop →
validator-writes ownership model), `reports/designs/2026-08-18-session-aware-quotes.md`
§6 (the dim/amber "reported, not verified" visual convention — documented
there, not yet implemented in `index.html`, first real consumer is this
design), `index.html` (`:root` vars L12-47, `.card`/`.card-head`/`.card-body`
L179-198, `renderGauge()`/`regime-spark` L710-817 — the only existing
Chart.js usage in the file, `fetchJsonSafe` L844-852, `bootValuations()`
L975-1051, breakpoints L164-177/370/412-425), `scripts/scrape-quotes.mjs`
(refresher write pattern: `readJson`/`writeJsonAtomic` from `lib/io.mjs`,
raw-drop-then-atomic-write, upsert-into-prior-file idiom), and
`.github/workflows/data-refresh.yml`. The planner has already fixed the four
architecture decisions in the task; this document fills in the schema, UI,
data-flow and test-plan detail needed to build without further questions.

The planner's four decisions (not relitigated):
1. New `data/history/` directory, cadence-aware sharding (daily-sharded
   yields + a browser-facing `yields-latest.json`; quarterly/monthly
   unsharded HBM/NAND; a curated sparse Anthropic event log).
2. `corroborated`/`corroboratedBy`, never `verified`/`verifiedBy`, for
   Anthropic data.
3. One new collapsible card in `index.html` — not a new page, not a tab.
4. Anthropic renders as a citation-badged event list, never a smooth line.

---

## 0. Two findings from reading the existing Chart.js code (load-bearing for the builder)

These aren't design choices — they're facts about the existing codebase that
change how the pseudocode in §7 must be written. Flagging them up front so
the builder doesn't rediscover them the hard way.

**Finding A — Chart.js canvas colors cannot be `var(--cyan)`.** `gaugeChart`
and `sparkChart` (`index.html` L722-798) both use literal hex strings
(`'#00B7C7'`, `'#0F1A2A'`, `'#FCE4E4'`...) that *match* `:root` values —
never the CSS `var()` reference itself. This is because canvas 2D context
properties (`fillStyle`/`strokeStyle`) require a resolved color string; they
do not participate in CSS custom-property cascade resolution the way DOM
element styles do. "No new hex colors — use the palette" therefore means,
for Chart.js configs specifically: **hardcode the hex value that already
exists in `:root`, with a comment naming which var it mirrors** — not
`var(--cyan)` literally in the JS. §7 below follows this.

**Finding B — no Chart.js time adapter is loaded.** `index.html` L10 loads
only `chart.umd.min.js`, no date-adapter script (`chartjs-adapter-date-fns`
etc). `scales.x.type: 'time'` will throw ("This method is not implemented:
Check that a complete date adapter is provided") if used. The yields chart
therefore uses a **category** x-axis built from a shared, sorted, de-duped
date-label array with `null` gap-filling per series (§7) — not a linear/time
scale with `{x,y}` points. This also correctly renders a real gap (a
national holiday in one country but not another) as a break in that one
line, rather than interpolating across it.

---

## 1. Schemas — `data/history/*.json`

All five files are new; nothing in `data/*.json` (top level) changes.
`data/history/` is a new subdirectory.

### 1a. `history/yields-YYYY.json` — daily, sharded by year

Owner: **refresher agent + GitHub Actions** (new script
`scripts/scrape-yields.mjs`, same `readJson`/`writeJsonAtomic` idiom as
`scrape-quotes.mjs`). One file per calendar year
(`yields-2026.json`, `yields-2025.json`, ...); a new shard is created
automatically the first time a row for a new year is written.

```jsonc
{
  "note": "Owned by refresher agent + GitHub Actions data-refresh workflow (scripts/scrape-yields.mjs). Daily sovereign 10Y yield table, sharded one file per calendar year to keep any single file small (see reports/designs/2026-08-19-phase3-trackers.md §4 for the size/retention rationale). DEDUPE-BY-DATE, not append-only: each run UPSERTS one row per (country,tenor,date) key — if that exact key already has a row, the new row REPLACES it wholesale (last-write-wins on same-day double-writes, e.g. the 21:00 UTC post-close cron overwriting the 11:00 UTC pre-market cron's same-date row, or two ad-hoc workflow_dispatch runs the same afternoon); rows are never duplicated for the same key. The row shape is IDENTICAL whether refresher-scraped or collector/human-curated — only source/agent differ — so a scraper outage never blocks a manual backfill using the same shape.",
  "year": 2026,
  "updated": "2026-08-19T21:05:00Z",     // ISO timestamp of the last write to THIS shard
  "agent": "refresher",
  "rows": [
    {
      "date": "2026-08-19",              // YYYY-MM-DD — the trading/reference date this yield belongs to
      "country": "US",                    // "US" | "DE" | "FR" | "IT" | "UK" | "JP" today — additive, extend the set freely
      "tenor": "10y",                     // "10y" only today; "2y"/"30y" slot in later as new VALUES of this same field — zero schema change
      "yield": 4.32,                      // percent (4.32 means 4.32%), NOT a fraction — matches the existing US10Y convention already live in price-quotes.json (Cboe _TNX, normalized)
      "source": "fred-csv",               // "fred-csv" | "cboe-tnx" | "cnbc" | "manual" | any future adapter name — free string, not an enum
      "agent": "refresher",               // "refresher" | "collector" | "human" — whoever actually produced this row
      "collectedAt": "2026-08-19T21:04:58Z"
    }
  ]
}
```

**Dedupe key**: `` `${country}|${tenor}|${date}` ``. Upsert algorithm (runs
inside `scrape-yields.mjs` after fetching new rows, before the atomic
write):

```js
// pseudocode — not production code
function upsertRow(rows, newRow) {
  const key = r => `${r.country}|${r.tenor}|${r.date}`;
  const idx = rows.findIndex(r => key(r) === key(newRow));
  if (idx >= 0) rows[idx] = newRow;   // last-write-wins, wholesale replace
  else rows.push(newRow);
  return rows;
}
// After all upserts, sort rows by (country, tenor, date) ascending before
// writing — keeps git diffs stable/reviewable instead of order depending on
// fetch-completion timing.
```

Two same-date writes in one day (the two weekday cron slots, or an ad-hoc
`workflow_dispatch`) never produce two rows — the second write's `updated`/
`collectedAt` simply supersede the first's for that `(country,tenor,date)`
key. This is a deliberate departure from the news-feed/decisionLog
"append-only, never rewrite" convention: a sovereign yield is a *fact about
a date* that has exactly one correct value once the source settles it, not
an append-only observation log — storing two rows for the same date would
just be scraper noise, not signal.

**Why FRED's key-less CSV likely covers only the US leg (open item):**
`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10` is confirmed
key-less (distinct from the credentialed FRED *API*) and is a live candidate
for the `US` row's `source:"fred-csv"`. Whether DE/FR/IT/UK/JP 10y yields
can be scraped key-lessly from an equivalent public endpoint is being probed
separately and is **not resolved by this design** — see §9. The row shape
above is deliberately source-agnostic so that outcome only changes which
adapter fills a given country's `source`/`agent` fields, never the row
shape itself.

### 1b. `history/yields-latest.json` — derived trailing slice

Owner: **refresher** (regenerated by the same `scrape-yields.mjs` run that
writes the yearly shard — no separate script, no separate agent step,
mirroring how `scrape-quotes.mjs` writes both the raw drop and the final
merged file in one run). **This is the ONLY yield file `index.html`
fetches** — same shielding pattern as `data/news-latest.json` relative to
`data/news-feed.json`.

```jsonc
{
  "note": "Derived by scripts/scrape-yields.mjs each run from the current + prior year's history/yields-YYYY.json shards — a trailing ~24-month slice, regenerated WHOLESALE (not appended) every run, same shielding pattern as data/news-latest.json relative to data/news-feed.json. This is the ONLY yield file index.html fetches. Per-row provenance (source/agent/collectedAt) is dropped here to keep the file small — full provenance lives in the yearly shards; index.html never needs it.",
  "updated": "2026-08-19T21:05:00Z",
  "agent": "refresher",
  "sourceFiles": ["history/yields-2026.json", "history/yields-2025.json"],
  "windowMonths": 24,
  "asOf": "2026-08-19",
  "series": {
    "US": { "10y": [ { "date": "2026-08-19", "yield": 4.32 }, { "date": "2026-08-18", "yield": 4.30 } ] },
    "DE": { "10y": [ { "date": "2026-08-19", "yield": 2.41 } ] },
    "FR": { "10y": [] },
    "IT": { "10y": [] },
    "UK": { "10y": [] },
    "JP": { "10y": [] }
  }
}
```

`series[country][tenor]` is deliberately nested one level deeper than
strictly needed today (a flat `series[country]` array would suffice while
only `10y` exists) so that adding `2y`/`30y` later is additive — a new key
under an existing country, not a schema break, and old chart code that only
ever reads `series[c]['10y']` keeps working unmodified. Countries with zero
points in the trailing window (nothing scraped yet, e.g. DE/FR/IT/UK/JP on
day one) are present with an **empty array**, not omitted — same "empty is
valid, not an error" convention as `news-latest.json`'s `TSMU: {items: []}`.

### 1c. `history/hbm-share.json` — quarterly, unsharded, append-only

Owner: **collector (raw) → validator (writes)** — reuses the exact
`analyst-targets.json` ownership pattern (collector drops raw vendor
market-share figures to `reports/raw/YYYY-MM-DD-hbm-share.json`; validator
cross-checks ≥2 sources and appends here). Quarterly cadence, small,
slow-growing (4 vendors × 4 quarters/yr ≈ 16 rows/yr) — no sharding needed,
ever; see §4 for the growth-rate math.

```jsonc
{
  "note": "Owned by validator (collector drops raw vendor share figures to reports/raw/YYYY-MM-DD-hbm-share.json; validator cross-checks ≥2 sources and appends here — same ownership pattern as data/analyst-targets.json). APPEND-ONLY: a revised estimate for an already-published quarter is a NEW row with the same quarter+vendor+metric and a later `updated`, never an edit to the prior row (matches the decisionLog[]/SESSION_LOG.md append-only convention). Readers must resolve duplicates by taking the LAST array occurrence of a given (quarter,vendor,metric) key — see the design doc §7 latestByKey() helper.",
  "updated": "2026-08-19T12:00:00Z",
  "agent": "validator",
  "tolerance": 0.05,                    // fractional — reuses analyst-targets.json's 5% rationale: research-firm market-share estimates drift more than same-tick price quotes
  "rows": [
    {
      "quarter": "2026-Q2",              // YYYY-Q[1-4]
      "vendor": "SK Hynix",              // "SK Hynix" | "Samsung" | "Micron" | "Other"
      "metric": "revenue-share",         // "revenue-share" | "bit-shipment-share" — MUST stay identical across rows to be one comparable series; a metric change starts a visually distinct line, not a continuation
      "sharePct": 0.62,                  // fraction 0-1 (repo convention: percents as fractions in JSON)
      "source": "TrendForce",
      "url": "https://...",
      "asOf": "2026-07-15",              // date the estimate was published
      "verified": true,                  // ≥2 perSource entries agree within `tolerance`
      "verifiedBy": ["validator"],
      "perSource": { "TrendForce": 0.62, "Counterpoint": 0.60 },
      "updated": "2026-08-19",
      "agent": "validator"
    }
  ]
}
```

Single-source rows keep `verified: false` but still populate `sharePct` (one
`perSource` entry) — same "single-source stays visible, just flagged"
convention as `analyst-targets.json`/`price-quotes.json` DXY.

### 1d. `history/nand-price.json` — monthly, unsharded, append-only

Owner: **collector (raw) → validator (writes)**, identical ownership
pattern to §1c. ~12 rows/yr — trivially small forever; see §4.

```jsonc
{
  "note": "Owned by validator (collector drops raw pricing figures to reports/raw/YYYY-MM-DD-nand-price.json; validator cross-checks and appends here — same pattern as history/hbm-share.json and data/analyst-targets.json). APPEND-ONLY — a later revision of a published month is a NEW row, never an edit; readers resolve duplicates by taking the LAST array occurrence of a given (month,metric) key, same as hbm-share.json.",
  "updated": "2026-08-19T12:00:00Z",
  "agent": "validator",
  "tolerance": 0.05,
  "rows": [
    {
      "month": "2026-07",                          // YYYY-MM
      "metric": "128Gb TLC NAND contract price",    // human-readable, source-defined — MUST stay identical across rows for one continuous series (same caveat as hbm-share.json's metric field)
      "unit": "USD",
      "priceUsd": 3.85,
      "changeMoMPct": 0.021,                        // optional, fraction — month-over-month, source-reported or self-derived vs the prior row; null if unknown
      "source": "TrendForce",
      "url": "https://...",
      "asOf": "2026-07-31",
      "verified": false,                            // typical case — spot/contract NAND pricing usually has one authoritative tracker, not two independent live feeds
      "perSource": { "TrendForce": 3.85 },
      "updated": "2026-08-05",
      "agent": "validator"
    }
  ]
}
```

### 1e. `history/anthropic-funding-events.json` — curated sparse event log

Owner: **collector (raw) → validator (writes)**, reusing the
`analyst-targets.json` ownership pattern one more time — but see the naming
rule in §2, this file **never** uses `verified`/`verifiedBy`. The collector
side of this pipeline is not hypothetical: `reports/raw/2026-08-19-anthropic-ipo-debt.json`
already exists (written today, 2026-08-19) and is exactly the shape of raw
material this file's validator pass consumes — it already contains a
`corroborated by CNBC` / `treat as corroborated but not fully independent`
vocabulary in its prose, which this schema formalizes into structured
fields.

```jsonc
{
  "note": "Owned by validator (collector drops raw press claims to reports/raw/YYYY-MM-DD-<slug>.json — see the existing example reports/raw/2026-08-19-anthropic-ipo-debt.json; validator groups claims into distinct real-world events and cross-checks outlet independence — same ownership pattern as data/analyst-targets.json). Anthropic is a private company: there is no live, independently-verifiable primary feed the way there is for price-quotes.json. Every entry here is PRESS-REPORTED, not independently verifiable the same way a cross-source quote is. This file therefore uses corroborated/corroboratedBy, NEVER verified/verifiedBy — see the '`verified` vs `corroborated`' rule below. `corroborated:true` requires ≥2 INDEPENDENTLY-BYLINED outlets — same-wire reprints of one original story (e.g. five outlets all reprinting one Bloomberg piece) count as ONE source, per the collector's existing dedup convention. Curated, not append-only-raw: entries are UPSERTED BY id (a new corroborating source found later is merged into the existing event's sources[]/corroboratedBy[], not appended as a duplicate event) — see the design doc §7.",
  "updated": "2026-08-19T12:00:00Z",
  "agent": "validator",
  "events": [
    {
      "id": "2026-06-01-confidential-s1-filing",     // kebab-date-slug, same id convention as news-feed.json items[].id
      "date": "2026-06-01",                           // event date
      "category": "filing-status",                    // "ipo-timing" | "ipo-valuation" | "ipo-size" | "filing-status" | "underwriters" | "debt-size" | "debt-structure" | "debt-purpose"
      "headline": "Anthropic confidentially files draft S-1 with the SEC",
      "detail": "Pending SEC review, this gives Anthropic the option to pursue an IPO. No share price, share count, or listing date disclosed.",
      "figureUSD": null,                              // numeric USD figure this event centers on, if any (e.g. 35000000000 for the $35B XPV deal); null when the event has no single dollar figure
      "corroborated": true,                            // ≥2 independently-bylined outlets
      "corroboratedBy": ["Anthropic (company statement)", "CNBC"],
      "sources": [
        { "outlet": "Anthropic (company X post)", "url": "https://x.com/anthropicai/status/2061478052257841495", "publishedAt": "2026-06-01", "attribution": "company-statement" },
        { "outlet": "CNBC", "url": "https://www.cnbc.com/2026/06/01/anthropic-ipo-s1-prospectus.html", "publishedAt": "2026-06-01", "attribution": "named-source" }
      ],
      "updated": "2026-08-19",
      "agent": "validator"
    },
    {
      "id": "2026-08-17-2t-valuation-target",
      "date": "2026-08-17",
      "category": "ipo-valuation",
      "headline": "Investors/bankers reportedly targeting a $2T+ IPO valuation for an October debut",
      "detail": "Figure attributed to unnamed investors/bankers circling the deal, not to Anthropic's own guidance; execs have not confirmed a valuation target even privately.",
      "figureUSD": 2000000000000,
      "corroborated": false,                           // single distinct chain of reporting (qz.com/Motley Fool/PYMNTS/Forbes all cite the same underlying anonymous sourcing — one source-chain, not independent corroboration)
      "corroboratedBy": [],
      "sources": [
        { "outlet": "Motley Fool / Yahoo Finance", "url": "https://www.fool.com/investing/2026/08/17/anthropic-is-reportedly-aiming-for-a-valuation-of/", "publishedAt": "2026-08-17", "attribution": "anonymous-source" }
      ],
      "updated": "2026-08-19",
      "agent": "validator"
    }
  ]
}
```

---

## 2. Naming rule — `verified` vs `corroborated`

**Exact rule (also goes into `data/README.md`, §6):**

> `verified`/`verifiedBy` mean specifically what `price-quotes.json` and
> `analyst-targets.json` already mean by them: ≥2 **independent, live,
> queryable data feeds** agreeing within a stated numeric tolerance. Never
> apply these field names to press-reported information about a private
> company — there is no live feed to cross-query, only journalism about a
> single underlying event.
>
> `corroborated`/`corroboratedBy` mean: ≥2 **independently-bylined news
> outlets** reported the same claim, where same-wire reprints of one
> original story count as one source (per the collector's existing
> "Investing.com/MarketScreener/Invezz/SRN News/93.3 The Drive [are] one
> source [Bloomberg]" convention, already in use in
> `reports/raw/2026-08-19-anthropic-ipo-debt.json`). `corroborated:false`
> does not mean "false" or "debunked" — it means "reported once, not yet
> independently corroborated," and the UI must render it visibly dimmer
> than a corroborated entry, never with the green "verified" visual
> language used elsewhere in the dashboard (§8).
>
> This rule applies to `data/history/anthropic-funding-events.json` today
> and to any future tracker of privately-reported (non-exchange-quoted)
> information.

---

## 3. Data flow

```
scripts/scrape-yields.mjs (refresher, GH Actions, both weekday cron slots)
  → upserts history/yields-YYYY.json  (dedupe-by (country,tenor,date), §1a)
  → regenerates history/yields-latest.json (wholesale, trailing 24mo, §1b)
       │
       └─(fetch, boot-once)→ index.html #phase3-trackers → p3-yields-chart

collector (interactive — WebSearch/WebFetch, quarterly/monthly cadence, no cron)
  → reports/raw/YYYY-MM-DD-hbm-share.json
  → reports/raw/YYYY-MM-DD-nand-price.json
validator (interactive, cross-checks ≥2 sources, tolerance 0.05)
  → appends history/hbm-share.json   (§1c)
  → appends history/nand-price.json  (§1d)
       │
       └─(fetch, boot-once)→ index.html #phase3-trackers → p3-hbm-chart, p3-nand-chart

collector (interactive — same pipeline that already produced
           reports/raw/2026-08-19-anthropic-ipo-debt.json today)
  → reports/raw/YYYY-MM-DD-<slug>.json
validator (interactive, groups claims into events, stamps corroboration)
  → upserts-by-id history/anthropic-funding-events.json (§1e)
       │
       └─(fetch, boot-once)→ index.html #phase3-trackers → p3-anthropic-events
```

**Load order at boot**: `data/history/*.json → hard "no data yet" empty
state`. **No `localStorage` layer for any of these four files** — unlike
`portfolio-current.json`/`assets-history.json`, there is no manual-entry UI
for phase-3 trackers in this phase; they are read-only, agent/cron-authored
displays, matching `news-latest.json`/`analyst-targets.json`'s read-only
treatment, not `portfolio-current.json`'s editable one. All four files are
fetched **once**, at page load, via a new `bootTrackers()` function (§7) —
no polling, no re-fetch loop, same boot-once behavior as `valuations.json`/
`risk-scores.json`/`analyst-targets.json`/`fundamentals.json` today (only
the mock `MarketData` regime/glance data has a live tick; real data files
require a page reload to refresh, and that is unchanged by this design).

---

## 4. Size budget and retention

**`yields-latest.json` — the file actually paid for on every page load.**
Trailing 24 months, weekday-only cadence ≈ 21 rows/month × 24 = ~504 points
per country. 6 countries × 1 tenor (today) × 504 points, each point
pretty-printed (`JSON.stringify(obj, null, 2)`, matching `writeJsonAtomic`'s
existing 2-space-indent convention) as roughly 70 bytes including
indentation/braces/newlines (`{ "date": "2026-08-19", "yield": 4.32 },` at
8-space nesting depth) ≈ **~210 KB today**. Once 2y/30y ship (§9, phase 4),
3 tenors × the same math ≈ **~630 KB**.

**Concrete ceiling: 500 KB soft, 1 MB hard, for `yields-latest.json`.**
Rationale for picking these numbers: `news-feed.json` reaching 6.5 MB is the
specific failure this must not repeat — that file grew unbounded because it
was both append-only *and* browser-fetched directly. `yields-latest.json`
structurally cannot repeat that failure (it's wholesale-regenerated to a
fixed 24-month window every run, not append-only), but a window/tenor
combination could still grow past a reasonable per-page-load budget if
tenors or countries are added carelessly. If a future addition pushes past
500 KB: **shrink `windowMonths` from 24 to 12 before adding another
tenor/country** — documented here as the release valve, not implemented
now (no country/tenor addition is in scope for this design beyond the 6
countries × 1 tenor already specified).

**Yearly shards (`yields-YYYY.json`) — never browser-fetched, so no
page-load size concern**, only git-repo-size concern. Growth: ~260
weekdays/yr × 6 countries × 1 tenor ≈ 1,560 rows/yr/shard ≈ **~600 KB/year**
uncompressed (git's own delta/pack compression will do significantly
better than that on the repeated JSON structure). At 3 tenors: ~1.8 MB/yr.
**Retention**: shards are retained indefinitely — git history is a complete
audit trail regardless of file size, and old shards are read only by
`scrape-yields.mjs` (to build `yields-latest.json`'s trailing window when
it crosses a year boundary) and never by the browser. **Documented-but-not-
implemented compaction rule**: shards older than the most recent 3 calendar
years MAY be down-sampled from daily to Friday-only (weekly) granularity by
a future `scripts/compact-yield-shards.mjs`, cutting old-shard size ~5x —
not needed until multi-year accumulation makes it worth building; tracked
as a phase-4 item (§10), not built now.

**`hbm-share.json`/`nand-price.json`** — even at 10 years of accumulation:
HBM ≈ 4 vendors × 4 quarters × 10yr = 160 rows; NAND ≈ 12 rows/yr × 10yr =
120 rows. Both trivially small (tens of KB) forever — this is *why* they
get no `-latest` derivation and `index.html` fetches them directly, exactly
like `analyst-targets.json`'s direct-fetch pattern, not `news-feed.json`'s
derived-slice pattern.

**`anthropic-funding-events.json`** — a curated, sparse, human/agent-vetted
list (dozens of events over the company's IPO run-up, not thousands) —
negligible size, direct-fetched, no `-latest` derivation, no retention
concern.

---

## 5. `data/README.md` delta

### 5a. New rows for the `## Files` table (insert after the existing
`news-latest.json` row)

```markdown
| `history/yields-YYYY.json` | Daily sovereign 10Y yield table, sharded by year | refresher agent + GH Actions (`scripts/scrape-yields.mjs`) |
| `history/yields-latest.json` | Trailing ~24-month yield slice — the ONLY yield file index.html fetches | refresher agent (derived each run) |
| `history/hbm-share.json` | Quarterly HBM market share by vendor | collector (raw) + validator (writes) |
| `history/nand-price.json` | Monthly NAND contract/spot price | collector (raw) + validator (writes) |
| `history/anthropic-funding-events.json` | Curated sparse event log — Anthropic IPO/funding/debt events, press-reported (corroborated, not verified) | collector (raw) + validator (writes) |
```

### 5b. New top-level section (insert after `## Resolution order at boot`,
before `## Schemas`)

```markdown
## `verified` vs `corroborated`

`verified`/`verifiedBy` (used in `price-quotes.json`, `analyst-targets.json`,
`fundamentals.json`, `history/hbm-share.json`, `history/nand-price.json`)
mean ≥2 independent, live, queryable data feeds agreeing within a stated
numeric tolerance. Never apply these field names to press-reported
information about a private company — there is no live feed to
cross-query, only journalism about a single underlying event.

`corroborated`/`corroboratedBy` (used ONLY in
`history/anthropic-funding-events.json` today) mean ≥2 independently-bylined
news outlets reported the same claim — same-wire reprints of one original
story count as one source. `corroborated:false` means "reported once, not
yet independently corroborated," not "false" — the UI renders it visibly
dimmer than a corroborated entry and never with the "verified" green visual
language used elsewhere in the dashboard.

This rule applies to any future tracker of privately-reported,
non-exchange-quoted information — pick `corroborated`, not `verified`.

### Phase 3 trackers panel (`index.html` `#phase3-trackers`)

Fetches these files directly via `bootTrackers()` (separate from, and
independent of, `bootValuations()`'s fetch group above — a slow/missing
history file never blocks the watchlist panel):

- `data/history/yields-latest.json`
- `data/history/hbm-share.json`
- `data/history/nand-price.json`
- `data/history/anthropic-funding-events.json`

All four are optional/progressive-enhancement — missing (404, first deploy
before any of these files exist yet) ⇒ that chart/list renders a "데이터
없음" (no data yet) placeholder, the rest of the panel and the rest of the
dashboard are unaffected. No `localStorage` key is used by this panel —
these are read-only agent/cron-authored trackers, no manual-entry UI exists
for them in this phase.
```

### 5c. New schema sections (append at the end of `## Schemas`, after the
existing `### Kapture import shape` section)

Insert the five `### history/*.json` subsections using the exact jsonc
blocks in §1a-§1e above, verbatim, under headers `### history/yields-YYYY.json`,
`### history/yields-latest.json`, `### history/hbm-share.json`,
`### history/nand-price.json`, `### history/anthropic-funding-events.json`.

---

## 6. UI surface — `index.html`

### 6a. Placement

One new `<div class="card" id="phase3-trackers">` inserted in the main
scroll flow between the closing `</div>` of `#analytics-panel` (L629) and
the `<!-- Whale + Trump -->` comment (L631) — i.e. right after Watchlist
Analytics, before the Whale/Trump row. Add one sidebar link in the
"대시보드" (Dashboard) section, after the existing `sectors` link (L445),
before the "인사이트" section header (L447):

```html
<div class="side-link" data-scroll="phase3-trackers"><span class="dot"></span><span class="ko">거시 트래커</span><span class="en">Macro Trackers</span></div>
```

No change to the existing `data-scroll` click handler (L922-937) — it
already generically scrolls to any `#id` and flashes its containing
`.card`, so the new card works with zero JS changes to that handler.

### 6b. Card skeleton (pseudocode HTML)

```html
<div class="card" id="phase3-trackers" style="margin-bottom: 16px;">
  <div class="card-head">
    <h3><span class="ko">거시 트래커</span><span class="en">Macro Trackers</span></h3>
    <span class="sub" id="p3-updated">history/yields-latest.json + hbm-share.json + nand-price.json + anthropic-funding-events.json</span>
    <span class="spacer"></span>
    <span class="card-toggle" id="p3-collapse-toggle">▾</span>
  </div>
  <div class="card-body">
    <div class="p3-yields-wrap" id="p3-yields-canvas-wrap">
      <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">
        <span class="ko">10년물 국채금리 (24개월)</span><span class="en">10Y Sovereign Yields (24mo)</span>
      </div>
      <canvas id="p3-yields-chart"></canvas>
    </div>
    <div class="p3-row-3">
      <div>
        <div class="p3-panel-title"><span class="ko">HBM 시장 점유율</span><span class="en">HBM Market Share</span></div>
        <div class="p3-chart-wrap" id="p3-hbm-canvas-wrap"><canvas id="p3-hbm-chart"></canvas></div>
      </div>
      <div>
        <div class="p3-panel-title"><span class="ko">NAND 계약가</span><span class="en">NAND Contract Price</span></div>
        <div class="p3-chart-wrap" id="p3-nand-canvas-wrap"><canvas id="p3-nand-chart"></canvas></div>
      </div>
      <div>
        <div class="p3-panel-title"><span class="ko">Anthropic 펀딩 이벤트</span><span class="en">Anthropic Funding Events</span></div>
        <div class="p3-events-list" id="p3-anthropic-events"></div>
      </div>
    </div>
  </div>
</div>
```

Note the yields canvas is initialized while the card is in its **default
expanded** state — never inside a `display:none` container — satisfying the
planner's Chart.js-sizing constraint without needing lazy/on-scroll
initialization.

### 6c. New CSS (additive only — no existing rule touched)

```css
.p3-panel-title { font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
.p3-yields-wrap { height: 260px; margin-bottom: 16px; }
.p3-row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.p3-chart-wrap { height: 200px; }
.p3-events-list { max-height: 200px; overflow-y: auto; }
.p3-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--faint); font-size: 11px; }

.card-toggle { cursor: pointer; color: var(--muted); font-size: 14px; transition: transform .15s; user-select: none; }
.card.collapsed .card-toggle { transform: rotate(-90deg); }
.card.collapsed .card-body { display: none; }

.p3-event-item { padding: 8px 0; border-bottom: 1px solid var(--line-2); font-size: 11px; }
.p3-event-item:last-child { border-bottom: none; }
.p3-event-head { display: flex; align-items: center; gap: 6px; }
.p3-event-badge { font-family: var(--mono); font-size: 9px; font-weight: 700; letter-spacing: .04em; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
.p3-event-badge.corroborated  { background: var(--amber-soft); color: var(--amber); }
.p3-event-badge.single-source { background: var(--line-2);     color: var(--faint); }
.p3-event-date { font-family: var(--mono); font-size: 10px; color: var(--faint); }
.p3-event-headline { margin-top: 4px; color: var(--ink-2); line-height: 1.4; }
.p3-event-sources { margin-top: 4px; color: var(--muted); font-size: 10px; }
.p3-event-sources a { color: var(--cyan-2); }

@media (max-width: 768px) {
  .p3-row-3 { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .p3-yields-wrap { height: 300px; }   /* legend wraps to 2-3 rows at this width — give it room */
}
```

`.card-toggle`/`.card.collapsed` are generic (not `p3-`-prefixed) — they're
written as a reusable card-level affordance in case a future card wants the
same collapse behavior, but nothing else is wired to use it in this change
(no other `.card` gets a `.card-toggle` element added).

**Deliberate color choice for `--amber`/`--amber-soft` on the corroborated
badge, never `--green`/`--green-soft`**: `--green`/`.pill.live` are the
dashboard's existing "verified/live" visual language (used for the SYNCED
pill, verified news dots, etc). Reusing green here — even for a
`corroborated:true` Anthropic event — would visually claim the same
confidence level as a cross-source-verified live quote, which is exactly
the misrepresentation the planner's decision #4 rules out. Amber (already
the dashboard's "flag, pay attention" color — stale banners, RRR warnings)
is the correct register for "multiple outlets reported this, still not the
same thing as a verified feed."

### 6d. Collapse-toggle behavior

Default state: **expanded** (no `.collapsed` class on page load) — required
so the three charts initialize with real, non-zero layout dimensions (§0
Finding, restated: a `display:none` ancestor at chart-creation time is
exactly what breaks Chart.js sizing).

```js
// pseudocode
document.getElementById('p3-collapse-toggle').addEventListener('click', () => {
  const card = document.getElementById('phase3-trackers');
  const wasCollapsed = card.classList.contains('collapsed');
  card.classList.toggle('collapsed');
  if (wasCollapsed) {
    // Re-expanding: if the window was resized while the card body was
    // display:none, Chart.js did not see that resize (hidden canvases
    // don't fire resize observers). Force a resize now that real layout
    // dimensions are available again.
    [yieldsChart, hbmChart, nandChart].forEach(c => c && c.resize());
  }
});
```

Collapse state is **ephemeral** (resets on reload) — no `localStorage` key —
matching the existing watchlist row expand/collapse convention
(`CLAUDE.md`/`data/README.md`: "expand/collapse UI state is ephemeral").

---

## 7. Chart.js dataset shapes and options

All three charts: `type: 'line'`, `responsive: true`,
`maintainAspectRatio: false` (mandatory — CLAUDE.md convention, and the
`.p3-*-wrap` divs are explicitly sized per §6c to host it), wrapped in a
sized div per the existing `.regime-spark`/`.regime-gauge` pattern.

### 7a. Yields chart — `p3-yields-chart`

6 series today (US/DE/FR/IT/UK/JP), category x-axis built from the union of
dates present (§0 Finding B — no time adapter loaded), `null`-gap-filled
per series so a country-specific holiday renders as a real gap, not an
interpolated line.

```js
// pseudocode
let yieldsChart, hbmChart, nandChart;
const P3_COUNTRIES = ['US', 'DE', 'FR', 'IT', 'UK', 'JP'];
// Canvas fillStyle/strokeStyle cannot resolve CSS var() — literal hex
// mirrors :root, same convention as gaugeChart/sparkChart (index.html
// ~L722-798, see design doc §0 Finding A). Do not invent new hex; these six
// are all pre-existing --cyan/--cyan-2/--gold/--gold-2/--blue/--amber
// values, repurposed here as 6 categorical (not semantic) line colors —
// --green/--red are deliberately reserved (not used for country lines) to
// avoid implying "good/bad" on a metric where that reading doesn't apply;
// they're available for a future spread/differential series instead.
const P3_YIELD_COLOR = { US: '#00B7C7', DE: '#C9A227', FR: '#1D4ED8', IT: '#B45309', UK: '#0892A0', JP: '#8C6D14' };

function renderYieldsChart(data) {
  const wrap = document.getElementById('p3-yields-canvas-wrap');
  const series = data && data.series;
  const anyPoints = series && P3_COUNTRIES.some(c => (series[c]?.['10y'] || []).length);
  if (!anyPoints) {
    wrap.innerHTML = '<div class="p3-empty">데이터 없음 — 아직 수집되지 않음</div>';
    return;
  }
  const dateSet = new Set();
  P3_COUNTRIES.forEach(c => (series[c]?.['10y'] || []).forEach(p => dateSet.add(p.date)));
  const labels = [...dateSet].sort();          // YYYY-MM-DD string-sorts chronologically
  const multiTenor = false;                    // flip true once a 2nd tenor exists (§9) — controls label suffix below
  const datasets = P3_COUNTRIES.map(c => {
    const byDate = new Map((series[c]?.['10y'] || []).map(p => [p.date, p.yield]));
    return {
      label: multiTenor ? (c + ' 10Y') : c,     // compact single-tenor label today; disambiguates once 2y/30y ship
      data: labels.map(d => byDate.has(d) ? byDate.get(d) : null),
      borderColor: P3_YIELD_COLOR[c],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      spanGaps: false,                          // null = a real visible gap, never interpolated across
    };
  });
  yieldsChart = new Chart(document.getElementById('p3-yields-chart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        // Chart.js's BUILT-IN legend click-to-toggle — no custom show/hide UI, per planner decision #3.
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#EEF1F4' } },  // #EEF1F4 mirrors --line-2
      },
    },
  });
}
```

**Legibility at 380px for 6 (later up to 9) series** — three concrete
tactics, not "let Chart.js figure it out":
1. `legend.position: 'bottom'` + small `boxWidth`/`font.size: 10` lets
   Chart.js's own legend wrap to 2-3 rows instead of overflowing
   horizontally — Chart.js does this automatically, no custom layout code
   needed.
2. `.p3-yields-wrap` grows from 260px → 300px at ≤480px (§6c) specifically
   to give that wrapped legend room without squeezing the plot area to
   near-zero height.
3. Labels are the bare country code (`"US"`, not `"US 10Y"`) as long as
   only one tenor exists — shorter legend entries wrap into more compact
   rows. The `multiTenor` flag documents exactly where to switch this back
   on once 2y/30y ship and disambiguation is actually needed (§9).

### 7b. HBM share chart — `p3-hbm-chart`

3-4 series (vendors), quarterly category x-axis, same `null`-gap technique
if a vendor is missing a quarter (a smaller, simpler case of §7a — reuse the
same `latestByKey` + label-union approach, not written out twice here).
Built-in legend toggle also enabled here for consistency with §7a (the
planner mandated it for yields specifically; extending the same,
already-loaded mechanism to a second multi-series chart is the
lowest-code-consistent choice, not a new pattern).

```js
// pseudocode
const P3_VENDOR_COLOR = { 'SK Hynix': '#00B7C7', 'Samsung': '#C9A227', 'Micron': '#1D4ED8', 'Other': '#94A0B0' }; // #94A0B0 mirrors --faint

function latestByKey(rows, keyFn) {
  const m = new Map();
  for (const r of rows) m.set(keyFn(r), r);   // later array occurrences overwrite earlier ones — resolves append-only revisions, §1c/§1d
  return [...m.values()];
}

function renderHbmChart(data) {
  const wrap = document.getElementById('p3-hbm-canvas-wrap');
  const rows = (data && data.rows) || [];
  if (!rows.length) { wrap.innerHTML = '<div class="p3-empty">데이터 없음 — 아직 수집되지 않음</div>'; return; }
  const resolved = latestByKey(rows, r => `${r.quarter}|${r.vendor}|${r.metric}`);
  const quarters = [...new Set(resolved.map(r => r.quarter))].sort();
  const vendors = [...new Set(resolved.map(r => r.vendor))];
  const datasets = vendors.map(v => {
    const byQuarter = new Map(resolved.filter(r => r.vendor === v).map(r => [r.quarter, r.sharePct]));
    return {
      label: v,
      data: quarters.map(q => byQuarter.has(q) ? byQuarter.get(q) * 100 : null),  // fraction -> percent for the axis
      borderColor: P3_VENDOR_COLOR[v] || '#6B7889',  // #6B7889 mirrors --muted, fallback for an unmapped vendor string
      backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.15, spanGaps: false,
    };
  });
  hbmChart = new Chart(document.getElementById('p3-hbm-chart').getContext('2d'), {
    type: 'line',
    data: { labels: quarters, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 9 } } } },
      scales: {
        x: { ticks: { font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { font: { size: 9 }, callback: v => v + '%' }, grid: { color: '#EEF1F4' }, min: 0 },
      },
    },
  });
}
```

### 7c. NAND price chart — `p3-nand-chart`

Single series — styled like `sparkChart` (filled area, cyan, no legend,
matching the existing sparkline convention exactly since there's nothing to
disambiguate with only one line).

```js
// pseudocode
function renderNandChart(data) {
  const wrap = document.getElementById('p3-nand-canvas-wrap');
  const rows = (data && data.rows) || [];
  if (!rows.length) { wrap.innerHTML = '<div class="p3-empty">데이터 없음 — 아직 수집되지 않음</div>'; return; }
  const resolved = latestByKey(rows, r => `${r.month}|${r.metric}`);
  // Chart the metric with the most rows (today there is only one metric in
  // practice; documented for the day a benchmark change, e.g. 128Gb->256Gb,
  // would otherwise silently mix two non-comparable series).
  const counts = {};
  resolved.forEach(r => counts[r.metric] = (counts[r.metric] || 0) + 1);
  const primaryMetric = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const filtered = resolved.filter(r => r.metric === primaryMetric).sort((a, b) => a.month.localeCompare(b.month));
  nandChart = new Chart(document.getElementById('p3-nand-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: filtered.map(r => r.month),
      datasets: [{
        data: filtered.map(r => r.priceUsd),
        borderColor: '#00B7C7', backgroundColor: 'rgba(0,183,199,0.15)',   // literal values mirroring --cyan, identical to sparkChart L785-786
        fill: true, borderWidth: 1.5, tension: 0.3, pointRadius: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { ticks: { font: { size: 9 }, maxTicksLimit: 6 }, grid: { display: false } },
        y: { ticks: { font: { size: 9 }, callback: v => '$' + v }, grid: { color: '#EEF1F4' } },
      },
    },
  });
}
```

---

## 8. Anthropic events list (non-canvas)

```js
// pseudocode — reuses the existing escapeHtml() helper (index.html L835-842) unmodified
function renderAnthropicEvents(data) {
  const wrap = document.getElementById('p3-anthropic-events');
  const events = (data && data.events) || [];
  if (!events.length) {
    wrap.innerHTML = '<div class="p3-empty">데이터 없음 — 아직 수집되지 않음</div>';
    return;
  }
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));  // most recent first
  wrap.innerHTML = sorted.map(e => {
    const n = (e.corroboratedBy || []).length;
    const badge = e.corroborated
      ? '<span class="p3-event-badge corroborated">CORROB · ' + n + ' SRC</span>'
      : '<span class="p3-event-badge single-source">SINGLE-SOURCE</span>';
    const srcLinks = (e.sources || [])
      .map(s => '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.outlet) + '</a>')
      .join(' · ');
    return '<div class="p3-event-item">' +
        '<div class="p3-event-head">' + badge + '<span class="p3-event-date">' + escapeHtml(e.date) + '</span></div>' +
        '<div class="p3-event-headline">' + escapeHtml(e.headline) + '</div>' +
        '<div class="p3-event-sources">' + srcLinks + '</div>' +
      '</div>';
  }).join('');
}
```

**Hard rule, restated from the planner's decision #4**: no smooth
interpolated line, no continuous chart, no `.news-dot.verified` green dot,
no `.pill.live` anywhere in this panel — a citation-badged discrete list is
the entire UI for this data, by design, because it is the only
representation that doesn't visually overstate certainty about sparse,
single-source-capable press reporting on a private company.

---

## 9. Boot integration

```js
// pseudocode — replaces the single line at index.html L1361
document.addEventListener('DOMContentLoaded', () => {
  bootValuations();
  bootTrackers();
});

async function bootTrackers() {
  const [yields, hbm, nand, anthropic] = await Promise.all([
    fetchJsonSafe('data/history/yields-latest.json'),
    fetchJsonSafe('data/history/hbm-share.json'),
    fetchJsonSafe('data/history/nand-price.json'),
    fetchJsonSafe('data/history/anthropic-funding-events.json'),
  ]);
  renderYieldsChart(yields);
  renderHbmChart(hbm);
  renderNandChart(nand);
  renderAnthropicEvents(anthropic);
  const stamps = [yields, hbm, nand, anthropic].map(d => d && d.updated).filter(Boolean);
  if (stamps.length) document.getElementById('p3-updated').textContent =
    'history/* · updated ' + stamps.sort().slice(-1)[0].slice(0, 10);
}
```

`fetchJsonSafe` (L844-852, unmodified, zero changes) already returns `null`
on 404/network error rather than throwing — exactly the graceful "file does
not exist yet on first deploy" behavior needed here. Each `render*`
function independently null-checks its own input and shows a `.p3-empty`
placeholder — one missing file never blocks the other three panels, matching
the "optional / progressive enhancement" convention `bootValuations()`
already uses for `analyst-targets.json`/`fundamentals.json`/`news-latest.json`.
`bootTrackers()` runs in parallel with `bootValuations()` (both fired from
the same `DOMContentLoaded` handler, both `async`, neither `await`s the
other) — a slow or failed trackers fetch never delays the watchlist panel,
and vice versa.

---

## 10. ASCII mockups

### Desktop (≥1024px)

```
┌─ 거시 트래커 (Macro Trackers) ─────────────────────────────────── ▾ ─┐
│ history/* · updated 2026-08-19                                        │
├─────────────────────────────────────────────────────────────────────┤
│  10Y Sovereign Yields (24mo)                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │      ╭─╮          ╭╮                                           │  │
│  │  ╭───╯ ╰──╮   ╭───╯╰───╮                                       │  │
│  │──╯        ╰───╯        ╰────────────────────────────────       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│         ● US   ● DE   ● FR   ● IT   ● UK   ● JP   (click = toggle)   │
├───────────────────────┬────────────────────────┬────────────────────┤
│ HBM Market Share       │ NAND Contract Price     │ Anthropic Funding  │
│ ┌─────────────────┐   │ ┌──────────────────┐    │  Events            │
│ │ ╱‾‾‾‾‾‾‾‾‾╲__    │   │ │        ╭──╮       │    │ ┌────────────────┐│
│ │╱            ╲__  │   │ │   ╭────╯  ╰──╮    │    │ │[CORROB·2] 06-01││
│ │  ·········       │   │ │───╯          ╰──   │    │ │ Confidential   ││
│ └─────────────────┘   │ └──────────────────┘    │    │ │ S-1 filed      ││
│  ● SK Hynix ● Samsung  │  128Gb TLC · $/unit     │    │ │ Anthropic·CNBC ││
│  ● Micron              │                          │    │ ├────────────────┤│
│                        │                          │    │ │[SINGLE-SRC]08-17││
│                        │                          │    │ │ $2T valuation..││
│                        │                          │    │ │ Motley Fool    ││
│                        │                          │    │ └────────────────┘│
└───────────────────────┴────────────────────────┴────────────────────┘
```

### 480px

```
┌─ 거시 트래커 ▾ ────────────────┐
│ updated 2026-08-19              │
├──────────────────────────────────┤
│ 10Y Sovereign Yields (24mo)      │
│ ┌────────────────────────────┐  │
│ │                              │  │
│ │      (line chart, taller     │  │
│ │       wrap for legend)       │  │
│ └────────────────────────────┘  │
│  ● US  ● DE  ● FR                │
│  ● IT  ● UK  ● JP   (wrapped)    │
├──────────────────────────────────┤
│ HBM Market Share                 │
│ ┌────────────────────────────┐  │
│ │        (line chart)          │  │
│ └────────────────────────────┘  │
├──────────────────────────────────┤
│ NAND Contract Price               │
│ ┌────────────────────────────┐  │
│ │        (line chart)          │  │
│ └────────────────────────────┘  │
├──────────────────────────────────┤
│ Anthropic Funding Events          │
│ [CORROB·2 SRC]  2026-06-01        │
│ Confidential S-1 filed             │
│ Anthropic · CNBC                   │
│ ─────────────────────────────      │
│ [SINGLE-SOURCE]  2026-08-17        │
│ $2T IPO valuation reportedly...    │
│ Motley Fool                        │
└──────────────────────────────────┘
```

(`.p3-row-3` collapses to a single column at ≤768px per §6c; the 480px
mockup shows that already-collapsed state, plus the yields wrap's extra
height for the wrapped legend.)

---

## 11. Backward compatibility

- **Zero changes to any existing `data/*.json` file** — this is a pure
  addition of a new `data/history/` subdirectory.
- **`data/README.md`** — additive only: 5 new table rows, 1 new top-level
  section, 5 new schema subsections. No existing row/section edited.
- **`index.html`** — additive only: 1 new card, ~10 new CSS rules (all
  `p3-`-prefixed except the generic, newly-introduced-but-unused-elsewhere
  `.card-toggle`/`.card.collapsed`), 1 new sidebar link, 5 new JS functions
  (`bootTrackers`, `renderYieldsChart`, `renderHbmChart`, `renderNandChart`,
  `renderAnthropicEvents`), 3 new top-level `let` chart-instance variables,
  and exactly **one** modified line (`document.addEventListener('DOMContentLoaded', bootValuations);`
  → the two-call version in §9). `fetchJsonSafe`/`escapeHtml` are reused
  verbatim, unmodified. No existing function's signature or behavior
  changes.
- **`.github/workflows/data-refresh.yml`** — additive step (§12). The
  existing `git diff --quiet data/ reports/raw/ reports/validation/` guard
  already covers `data/history/` (directory wildcard), so no change needed
  there — but see §12 for a required fix to the `git add` line, which does
  need to change (it enumerates explicit files today, not a directory
  wildcard).
- **No consumer of `data/*.json` (top level) is affected** — a session that
  only knows the pre-phase-3 schema keeps working unmodified; a session
  that knows this design gets 4 new optional files with independent,
  additive fetches.

---

## 12. Workflow (`data-refresh.yml`) changes

1. New step, mirroring the existing fundamentals step's shape:
   ```yaml
   - name: Scrape yields (fred-csv + manual fallback)
     run: node scripts/scrape-yields.mjs
     continue-on-error: true
   ```
   Runs on **both** weekday cron slots (not gated like the fundamentals
   step, which only runs post-close or on manual dispatch). Reasoning:
   FRED's `DGS10` series updates once daily, typically after US market
   close — the 11:00 UTC (pre-market) run will simply re-fetch yesterday's
   already-stored value and no-op via the upsert-by-date rule (§1a); the
   21:00 UTC (post-close) run is the one that picks up the fresh close.
   Running unconditionally on both slots is simpler than replicating
   fundamentals' conditional gate and is safe specifically because the
   upsert semantics make a same-value re-write a no-op diff — this is
   Simplicity First, not carelessness.

2. **Required fix, found by reading the workflow closely — the commit step
   would otherwise silently drop this data forever.** The "Commit & push if
   changed" step's diff-check (`git diff --quiet data/ reports/raw/
   reports/validation/`) already covers `data/history/` via the `data/`
   directory wildcard. But the **`git add` line enumerates explicit file
   paths**, not a directory wildcard:
   ```
   git add data/price-quotes.json data/news-feed.json data/fundamentals.json reports/raw/ reports/validation/
   ```
   `data/history/*.json` is **not** in that list. Left unfixed, the guard
   would correctly detect a change exists (so the job wouldn't `exit 0`
   early) but the subsequent `git add`/`git commit` would commit nothing
   from `data/history/`, silently losing every yield/HBM/NAND/Anthropic
   write on every run. **Required change**: add `data/history/` to the
   `git add` line.

3. **Required fix, same root cause, different step.** The "Validate JSON"
   step and the CLAUDE.md-documented manual command both use the
   non-recursive glob `data/*.json`, which does **not** match
   `data/history/*.json` (shell globs don't recurse into subdirectories).
   Left unfixed, new history files would never be JSON-syntax-checked by
   CI. **Required change**: extend the loop to also validate
   `data/history/*.json` (either a second `for f in data/history/*.json`
   line, or switch to a recursive glob if the runner's shell has
   `globstar` enabled — the two-line explicit-second-loop version is safer
   and doesn't depend on shell options). The builder should make the
   equivalent update to the example command in `CLAUDE.md`'s "Local dev"
   section for consistency, since it documents the same non-recursive
   pattern.

---

## 13. Test plan

1. `node -e "JSON.parse(require('fs').readFileSync('data/history/<file>'))"`
   for each of the 5 new files, once they exist — extend the existing
   JSON-validate loop per §12 item 3; must stay green.
2. Syntax-check the inline scripts per the CLAUDE.md one-liner — must pass
   after adding `bootTrackers` + 4 render functions + the toggle handler.
3. **First-deploy / empty-state test**: before any `data/history/*.json`
   file exists (or by temporarily renaming them locally), load the
   dashboard and confirm all four `#phase3-trackers` panels show "데이터
   없음" placeholders, zero console errors, and the rest of the dashboard
   (watchlist, gauge, sectors) is completely unaffected.
4. **Legend-toggle test**: with real `yields-latest.json` data present,
   click a country in the yields chart's legend and confirm that line
   hides/shows (Chart.js built-in behavior — this test is really confirming
   no custom code accidentally suppressed it).
5. **Collapse/resize test**: collapse `#phase3-trackers`, resize the browser
   window, re-expand, and confirm all three charts render at the correct
   (new) width — proves the `.resize()` calls in §6d are wired correctly.
6. **Mobile breakpoint check** at 1024/768/480/380px (CLAUDE.md convention:
   test every new UI element at 480) — confirm the yields legend wraps
   without horizontal overflow, `.p3-row-3` collapses to one column at
   768px, and the Anthropic event card's citation links remain tappable at
   380px.
7. **Dedupe test (yields)**: run `scrape-yields.mjs` twice in the same day
   (simulating both cron slots) against a test/staging shard and confirm
   `history/yields-2026.json`'s row count for that date does not increase
   on the second run — proves the upsert-by-`(country,tenor,date)` key
   works, not a duplicate append.
8. **Append-revision test (hbm/nand)**: append a second row for an
   already-existing `(quarter,vendor,metric)` (or `(month,metric)`) key
   with a later `updated`, reload the dashboard, and confirm the chart
   shows the NEW value, not the old one — proves `latestByKey()` correctly
   resolves to the last array occurrence.
9. **Workflow commit test**: run `workflow_dispatch` once against a branch
   with the §12 fixes applied and confirm `data/history/*.json` actually
   appears in the resulting commit (validates the `git add` fix, since this
   exact class of bug fails silently otherwise).
10. Open the dashboard (`python3 -m http.server 8765`) and do a full manual
    pass: gauge/sectors/watchlist unaffected, new card renders, no console
    errors, `git status` shows only the intended files touched.

---

## 14. File-by-file change list (for the builder)

- **New**: `scripts/scrape-yields.mjs` — per §1a/§1b/§3, following
  `scrape-quotes.mjs`'s `readJson`/`writeJsonAtomic`/raw-drop idiom; writes
  `history/yields-YYYY.json` (upsert) and `history/yields-latest.json`
  (wholesale regenerate) in one run; US leg via the key-less
  `fredgraph.csv?id=DGS10` endpoint (§1a, §9 open item for the other 5
  countries).
- **New**: `data/history/` directory — created on first write by the
  scripts above (via `writeJsonAtomic`'s existing `mkdir(dirname(path),
  {recursive:true})`, already present in `lib/io.mjs` L10, zero changes
  needed there).
- **Modified**: `data/README.md` — per §5 (table rows, new section, 5 new
  schema subsections).
- **Modified**: `index.html` — per §6-§9 (1 new card, new CSS, 1 sidebar
  link, 5 new JS functions, 3 new chart-instance `let`s, 1 modified
  `DOMContentLoaded` line).
- **Modified**: `.github/workflows/data-refresh.yml` — per §12 (1 new step,
  `git add` line fix, JSON-validate loop fix).
- **Modified (recommended)**: `CLAUDE.md` "Local dev" section's JSON-validate
  one-liner — per §12 item 3, for consistency with the workflow fix.
- **No changes** to `data/valuations.json`, `data/risk-scores.json`,
  `data/price-quotes.json`, `data/analyst-targets.json`,
  `data/fundamentals.json`, `data/news-feed.json`, `data/news-latest.json`,
  `data/portfolio-current.json`, `data/assets-history.json`,
  `data/tickers-universe.json`, `data/sector-map.json`, or any existing
  script.

---

## 15. Open item — carried, not resolved

Whether DE/FR/IT/UK/JP 10y sovereign yields can be scraped key-lessly is
being probed separately (candidate sources unconfirmed as of this design —
national debt-agency sites, Investing.com/MarketWatch public pages, or a
Cboe-style delayed-quotes CDN equivalent for European/Japanese sovereigns
are all unverified). `fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10` is
confirmed key-less (distinct from the credentialed FRED *API*, which
remains out of scope — see §16) and is a live candidate for at minimum the
`US` row. **This design's row shape (§1a) is deliberately source-agnostic**:
whichever write-path (an automated scraper vs. `collector`/human curation
using the identical row shape with `source:"manual"`) ends up filling a
given country's rows, the schema, the shard file, `yields-latest.json`, and
the chart code in §7a are all unaffected — only the `source`/`agent` field
values on the affected rows differ. Until non-US scraping is confirmed
working, DE/FR/IT/UK/JP may be seeded via collector/human curation with no
rebuild required once/if automated scraping comes online for them.

---

## 16. Phase-4 deferrals (explicit, not built now)

- **Evaluator linkage from these trackers into per-ticker FV** — e.g. NAND
  contract price as an input to SNDK/MU valuation, HBM vendor share as
  context for the MU/SK Hynix-adjacent thesis. Zero wiring exists today;
  `valuations.json`/`risk-scores.json` are untouched by this design.
- **A credentialed FRED API integration** — broader series access beyond
  the single-series, key-less CSV endpoint used here. Deferred; not needed
  for the 6-country/1-tenor scope of this design.
- **Equity price history reusing the same `data/history/` store** — a
  general per-ticker daily-OHLC history is a materially bigger, separate
  design (retention/size math alone differs by an order of magnitude across
  27 symbols vs 6 countries); not scoped here.
- **2y/30y curve points** — the schema already supports this via new
  `tenor` values (§1a) with zero schema change, but the render code is not
  built to chart more than one tenor per country legibly yet; scaling the
  yields chart from 6 to 18-27 series will likely need a country-select
  filter (dropdown or similar) in addition to Chart.js's legend toggle —
  flagged as a future UX problem, not solved now.
- **Non-US key-less yield-scraping automation** — the open item in §15.
- **`localStorage`/manual-entry UI for any of these four trackers** —
  currently pure read-only display; no "Save to repo" affordance exists or
  is planned for this data in this phase.
- **`scripts/compact-yield-shards.mjs`** — the down-sampling compaction
  rule documented in §4 is not implemented; revisit once shard accumulation
  actually approaches a size worth compacting (years away at current
  growth rates).
