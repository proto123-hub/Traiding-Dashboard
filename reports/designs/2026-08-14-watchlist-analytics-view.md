# Design: Watchlist Analytics View — At-a-Glance Merge of Watchlist + Valuation Panel

**Date:** 2026-08-14
**Author:** architect agent
**Scope:** Replace the two existing `index.html` cards — `#watchlist-body` table (lines
528-551) and `#valuation-panel` table (lines 554-586) — with **one** merged
master-detail card (`#analytics-panel`) covering all 22 tickers in
`data/tickers-universe.json` (6 held, 16 watch-only). Adds three new data files
(`data/analyst-targets.json`, `data/fundamentals.json`, `data/news-latest.json`),
extends `data/risk-scores.json` with a `coverage` field, and adds a client-side
"phase 1" trend + staleness indicator. No changes to `data.js`, `MarketData`, or
any other card.

---

## 0. Current state (read before implementing)

`index.html` already implements the 2026-06-06 designs
(`2026-06-06-dashboard-valuations-ui.md`, `2026-06-06-watchlist-live-json.md`):

- `bootValuations()` (line 952) does one `Promise.all` of 6 fetches
  (`valuations.json`, `risk-scores.json`, `portfolio-current.json`,
  `sector-map.json`, `price-quotes.json`, `tickers-universe.json`), builds
  `v3.valuationRows` + `v3.watchlistRows`, calls `renderValuations()` +
  `renderWatchlist()`.
- `escapeHtml()` (line 792) already exists and is used by both render paths —
  reuse it for every new interpolation.
- `data/valuations.json` and `data/risk-scores.json` are last `updated`
  2026-06-05/06-07/06-20, with `nextReview` values of 2026-06-20 through
  2026-07-15 — **all in the past relative to today (2026-08-14)**. This means
  on first load after this ships, **every row will legitimately show the stale
  banner** (§6). That is correct, expected behavior, not a bug — see Test Plan
  item 7.
- `data/risk-scores.json` currently has entries for the 6 held tickers only
  (GOOGL, AVGO, CLS, MRVL, MU, SOXL). The 16 watch-only tickers have no entry.
- `data/valuations.json` already has all 22 tickers (held + watch + TSM/TSMU
  peer-reference) — no gap there.
- CSS breakpoints actually in the file today: `1200px`, `1100px`, `768px`,
  `480px` (no `1024`/`380` yet). This design introduces `1024px` and `380px`
  media queries for the new table only — additive, does not touch the existing
  ones.

---

## 1. Layout decision: master-detail accordion, one merged table

A flat table cannot carry all requested fields (trend, risk, news, FV
verdict/upside, analyst consensus, PER) down to 480/380px. Chart.js sparklines
per row were considered and **rejected for phase 1**: 22 canvases is real
render/memory cost for a decoration that phase-1 "cheap" trend (§5) doesn't
even need — a colored arrow + text badge conveys the same information with
zero JS chart overhead. Revisit only if the user asks for a visual trend after
seeing the phase-1 version.

**Decision: single `<table>`, two `<tr>` per ticker.**

```
<tr class="wl-row" data-sym="GOOGL">           ← always visible, click toggles detail
  <td>GOOGL summary cells...</td>
</tr>
<tr class="wl-detail" data-sym="GOOGL">        ← only emitted when expanded
  <td colspan="9"><div class="wl-detail-grid">...blocks...</div></td>
</tr>
```

Only one table (`#analytics-table` / tbody `#analytics-body`) replaces both the
old watchlist table and the old valuation table. Rows are collapsed by default;
clicking anywhere on `.wl-row` toggles its detail row. State lives in
`v3.expandedRows` (a `Set<string>` of symbols), rebuilt into the DOM on every
`renderAnalytics()` call — not persisted to `localStorage` (ephemeral UI state,
resets on reload, consistent with "no localStorage key for read-only panels"
precedent from the 2026-06-06 design).

### ASCII mockup (desktop, row collapsed)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Ticker      Sector          Price/Chg%   Trend    Risk        FV Upside  Analyst  PER  ▸│
├──────────────────────────────────────────────────────────────────────────────────────┤
│ GOOGL 보유  MegaCap-Platfrm  $346.35      ▼ FAIR   43 HOLD    +5.9%      +18.4%   24.8/21.3 ▸│
│ Alphabet                    -0.00%                                                      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ NVDA        Semis-GPU        $205.20      ▲ FAIR   38 HOLD*   -3.0%      —        N/A   ▸│
│ NVIDIA                      +0.05%        (*informational — watch-only, no trade fields)│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### ASCII mockup (row expanded — detail grid, reflows via CSS grid auto-fit)

```
┌─ GOOGL detail ─────────────────────────────────────────────────────────────────────────┐
│ ⚠ STALE — evaluator last updated 2026-06-05 · nextReview 2026-07-01 (passed)            │
│ ┌─ FV Band ──────────┐ ┌─ Risk (coverage: full) ─┐ ┌─ Analyst Consensus ───┐ ┌─ PER ───┐│
│ │ $330 —$367— $430    │ │ Score 43 · HOLD          │ │ $300 —$410— $480       │ │ Trail 24.8││
│ │ [bar marker]         │ │ Entry $345-360           │ │ 42 analysts · 08-10    │ │ Fwd  21.3││
│ │ Upside +5.9%         │ │ Target base $400/bull    │ │ [bar marker]           │ │ verified ││
│ │ Methods: DCF-10y,... │ │ $445/bear $320           │ │ Upside to mean +18.4%  │ └─────────┘│
│ │ Catalysts: Gemini 3..│ │ Stop $340 · RRR 1.35      │ └────────────────────────┘          │
│ └──────────────────────┘ │ Risks: concentration(high)│ ┌─ Recent News (5) ─────────────┐   │
│                           │ regulatory(high)...       │ │ ● CNBC 08-10 Gemini 3 GA...    │   │
│                           │ decisionLog: 06-05 HOLD.. │ │ ○ Reuters 08-09 DOJ remedy...  │   │
│                           └───────────────────────────┘ └────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
(`●` = verified headline, `○` = unverified.)

---

## 2. Column spec per breakpoint

Base (no media query, applies ≥1024px) — **9 columns**, in nth-child order:

| # | Header (ko/en) | Content |
|---|---|---|
| 1 | 종목 / Ticker | sym (mono, bold) + name (muted) + 보유 pill if held + `.wl-mobile-sub` (hidden ≥481px) with price/chg |
| 2 | 섹터 / Sector | sector-tag span (existing style, `background:var(--line-2)`) |
| 3 | 가격/등락 / Price/Chg | price (mono) + changePct (mono, colored) stacked |
| 4 | 추세 / Trend | day arrow (▲/▼/–, colored) + band tag (UNDER/FAIR/OVER pill) — §5 |
| 5 | 리스크 / Risk | score (mono) + verdict pill; `*` suffix + reduced opacity if `coverage:"informational"` |
| 6 | FV 업사이드 / FV Upside | `upsideMidPct` from valuations.json, colored (reuses existing thresholds: >5% green, 0-5% amber, ≤0% red) |
| 7 | 애널리스트 업사이드 / Analyst Upside | `(analystMean/price − 1) × 100`, same color thresholds, or `—` if missing/unverified, or `N/A` if `notApplicable` |
| 8 | PER | `trailingPE / forwardPE` mono compact, or `N/A` if `notApplicable`, or `—` if file missing |
| 9 | (blank header) | `▸`/`▾` chevron span `.wl-toggle` |

Column-hiding cascade (each `@media (max-width: …)` rule is **additive** to the
narrower ones above it — same non-exclusive-cascade pattern already used by
the existing `768px`/`480px` valuation-table rules):

```css
@media (max-width: 1024px) {
  #analytics-table th:nth-child(8), #analytics-table td:nth-child(8) { display: none; } /* PER */
}
@media (max-width: 768px) {
  #analytics-table th:nth-child(2), #analytics-table td:nth-child(2),  /* Sector */
  #analytics-table th:nth-child(7), #analytics-table td:nth-child(7) { display: none; } /* Analyst Upside */
}
@media (max-width: 480px) {
  #analytics-table th:nth-child(3), #analytics-table td:nth-child(3),  /* Price/Chg (moves into col1 sub-line) */
  #analytics-table th:nth-child(4), #analytics-table td:nth-child(4) { display: none; } /* Trend */
  .wl-mobile-sub { display: block; }
}
@media (max-width: 380px) {
  #analytics-table th:nth-child(6), #analytics-table td:nth-child(6) { display: none; } /* FV Upside */
}
```

Resulting visible columns:

| Breakpoint | Visible columns |
|---|---|
| ≥1024px | Ticker, Sector, Price/Chg, Trend, Risk, FV Upside, Analyst Upside, PER, Expand (9) |
| 768-1024px | Ticker, Sector, Price/Chg, Trend, Risk, FV Upside, Analyst Upside, Expand (8, PER dropped) |
| 480-768px | Ticker, Price/Chg, Trend, Risk, FV Upside, Expand (6, Sector + Analyst Upside dropped) |
| 380-480px | Ticker(+stacked price/chg), Risk, FV Upside, Expand (4, Trend dropped, Price/Chg folds into Ticker) |
| <380px | Ticker(+stacked price/chg), Risk, Expand (3, FV Upside dropped) |

The detail row (`.wl-detail`) always renders **all** fields regardless of
breakpoint — it's a `colspan` block using CSS grid `auto-fit`, so it reflows
naturally without its own media queries. Never remove data from the detail
view; only the summary row degrades.

---

## 3. Schema changes

### 3a. NEW `data/analyst-targets.json`

Owner: **validator** (writes after collector drops raw consensus figures per
`collector.md`'s existing "analyst consensus numbers" output type — no change
to collector.md needed). Same pipeline shape as `price-quotes.json`:
`collector → reports/raw/YYYY-MM-DD-<ticker>-analyst.json → validator stamps →
data/analyst-targets.json`.

**Verified tolerance: 5% (0.05) fractional spread between ≥2 sources' `mean`
figures.** Rationale: raw analyst-to-analyst price targets commonly spread
10-20%+ for high-growth names, but *aggregator consensus means* (TipRanks,
MarketBeat, WSJ, etc.) already average overlapping analyst pools, so they
typically agree within a few percent — 5% is tight enough to catch a stale or
mis-scraped aggregator, loose enough not to fail on ordinary rounding/update-
lag differences. This is a separate, wider tolerance than the 0.2% used for
`price-quotes.json` (price ticks are near-identical across sources; consensus
estimates are not).

```jsonc
// data/analyst-targets.json
{
  "note": "Owned by validator agent (collector drops raw consensus figures to reports/raw/, validator cross-checks and writes here). Separate from data/valuations.json — this is Wall Street sell-side consensus, NOT the evaluator's fundamental FV band. Leveraged ETFs (SOXL, TSMU) have no sell-side coverage — see notApplicable.",
  "updated": "2026-08-14T12:00:00Z",   // ISO timestamp of last validator write
  "agent": "validator",
  "tolerance": 0.05,                    // fractional diff on `mean` across sources for verified=true
  "targets": {
    "GOOGL": {
      "updated": "2026-08-14",          // YYYY-MM-DD
      "agent": "validator",
      "low": 300,
      "mean": 410,
      "high": 480,
      "numAnalysts": 42,
      "asOf": "2026-08-10",             // date the consensus figure was published
      "perSource": {
        "TipRanks":   { "mean": 415, "numAnalysts": 40 },
        "MarketBeat": { "mean": 405, "numAnalysts": 44 }
      },
      "verified": true,                 // ≥2 perSource.mean within tolerance
      "verifiedBy": ["validator"],
      "note": null                      // optional string caveat, e.g. "wide dispersion post-DOJ ruling"
    },
    "SOXL": {
      "updated": "2026-08-14",
      "agent": "validator",
      "notApplicable": true,
      "reason": "Leveraged single-sector ETF — no sell-side analyst price-target coverage"
    }
  }
}
```
Single-source entries keep `verified: false` but still populate `low/mean/high`
(one `perSource` entry) — the UI renders them with a "single-source" note
rather than hiding the number, matching the existing quote-verification UX
(`verified` dot pattern already used in `buildWatchRow`).

### 3b. NEW `data/fundamentals.json`

Owner: **validator** in phase 1 (same collector→validator pipeline as 3a — PER
is collected alongside analyst consensus, no new collector output type
needed). Phase 2: `scripts/scrape-fundamentals.mjs` (deferred, §8) refreshes
this file non-interactively via the GH Actions cron, at which point
`agent: "refresher"` is also a valid value — the schema does not hard-code the
writer.

```jsonc
// data/fundamentals.json
{
  "note": "Owned by validator agent (phase 1: from collector raw drops). Phase 2: scripts/scrape-fundamentals.mjs (refresher-style, non-interactive) may also write this file — agent field reflects whichever wrote last. trailingPE = trailing-twelve-month GAAP or non-GAAP EPS as reported by source (see perSource); forwardPE = consensus NTM EPS estimate. ETFs get notApplicable.",
  "updated": "2026-08-14T12:00:00Z",
  "agent": "validator",
  "tolerance": { "trailingPE": 0.03, "forwardPE": 0.05 },
  "fundamentals": {
    "GOOGL": {
      "updated": "2026-08-14",
      "agent": "validator",
      "trailingPE": 24.8,
      "forwardPE": 21.3,
      "asOf": "2026-08-13",
      "perSource": {
        "stooq":  { "trailingPE": 24.9, "forwardPE": 21.1 },
        "nasdaq": { "trailingPE": 24.7, "forwardPE": 21.5 }
      },
      "verified": true,                 // both trailingPE and forwardPE within their tolerance across sources
      "sourceCount": 2,
      "notApplicable": false
    },
    "SOXL": {
      "updated": "2026-08-14",
      "agent": "validator",
      "trailingPE": null,
      "forwardPE": null,
      "notApplicable": true,
      "reason": "Leveraged ETF — PE not meaningful (NAV tracks 3x SOX basket, no issuer earnings)"
    }
  }
}
```
Trailing/forward are tracked as separate `verified` conditions internally, but
the JSON exposes one `verified` boolean = true only if **both** pass their
respective tolerance (simplifies the UI contract; if the builder finds this
too coarse, splitting into `trailingPEVerified`/`forwardPEVerified` is a
trivial additive follow-up, not required for this ship).

### 3c. NEW `data/news-latest.json`

Owner: **validator**, regenerated (full overwrite, not appended) each cycle by
slicing `data/news-feed.json`. **`index.html` must never fetch
`data/news-feed.json` directly** — only this derived file, which stays small
enough for the browser (3-5 items × 22 tickers ≈ 100 items max).

```jsonc
// data/news-latest.json
{
  "note": "Derived by validator agent each cycle from data/news-feed.json (never fetched directly by index.html — that file is multi-MB). Regenerated wholesale, not appended. Selection: up to maxItemsPerTicker items per ticker, verified:true items first (most recent), backfilled with verified:false items if fewer than maxItemsPerTicker verified items exist.",
  "updated": "2026-08-14T12:00:00Z",
  "agent": "validator",
  "sourceFile": "data/news-feed.json",
  "maxItemsPerTicker": 5,
  "tickers": {
    "GOOGL": {
      "items": [
        {
          "id": "2026-08-10-googl-gemini3-ga",     // matches news-feed.json item id
          "headline": "Google Gemini 3 GA timing teased at Cloud Next",
          "source": "CNBC",
          "url": "https://...",
          "publishedAt": null,                      // nullable — only set if source page states one
          "collectedAt": "2026-08-10T18:00:00Z",
          "verified": true
        }
      ]
    },
    "TSMU": { "items": [] }                          // empty array if no recent items — valid, not an error
  }
}
```

### 3d. CHANGED `data/risk-scores.json` — add `coverage`

Add a mandatory `coverage: "full" | "informational"` field to every entry.
This **supersedes** the current README line "Only held positions get a risk
score — peer-reference tickers stay valuation-only." Going forward, all 22
universe tickers get a `scores` entry; held tickers keep the existing
full contract, watch-only tickers get a new, deliberately smaller contract.

```jsonc
// data/risk-scores.json — delta
{
  "note": "Owned by evaluator agent. coverage:\"full\" (held) requires entryZone/target/stopLoss/rrr/decisionLog as before. coverage:\"informational\" (watch-only) requires ONLY score/verdict/risks[] — no trade-recommendation fields (entryZone/target/stopLoss/rrr/decisionLog are forbidden on informational entries; this is a watchlist observation, not a position management instruction).",
  "legend": {
    "score": { "0-30": "low", "30-60": "medium", "60-100": "high" },
    "verdict": ["STRONG_BUY", "BUY", "HOLD", "TRIM", "SELL"],
    "coverage": ["full", "informational"]
  },
  "scores": {
    "GOOGL": {
      "coverage": "full",                 // NEW field — existing 6 held entries just gain this, nothing else changes
      "updated": "2026-06-05",
      "score": 43,
      "verdict": "HOLD",
      "entryZone": { "low": 345, "high": 360 },
      "target": { "base": 400, "bull": 445, "bear": 320 },
      "stopLoss": 340,
      "rrr": 1.35,
      "risks": [ /* unchanged */ ],
      "decisionLog": [ /* unchanged, append-only */ ]
    },
    "NVDA": {                             // NEW — example watch-only entry
      "coverage": "informational",
      "updated": "2026-08-14",
      "score": 38,
      "verdict": "HOLD",
      "risks": [
        { "tag": "macro", "severity": "medium", "note": "AI chip export restriction overhang" }
      ]
      // no entryZone / target / stopLoss / rrr / decisionLog on informational entries
    }
  }
}
```

**Backward compatibility:** the 6 existing held entries are untouched except
for the one new `coverage: "full"` field (additive). Any reader that ignores
unknown fields is unaffected. `index.html`'s risk column must check
`r.riskCoverage === 'informational'` to decide whether to render the
trade-recommendation block in the detail panel (§4) — this is the one place a
missing field changes rendering behavior, and it degrades safely (no fields ⇒
nothing shown, not an error).

### 3e. `data/README.md` — full delta text

Add three rows to the `## Files` table:

```
| `analyst-targets.json` | Wall Street analyst consensus price targets (low/mean/high, numAnalysts) | validator |
| `fundamentals.json` | Trailing/forward P/E per ticker; ETFs marked notApplicable | validator (phase 1) / scripts/scrape-fundamentals.mjs (phase 2) |
| `news-latest.json` | Top 3-5 recent headlines per ticker, sliced from news-feed.json — the ONLY news file index.html fetches | validator |
```

Replace the existing "The valuation panel (`index.html` `#valuation-panel`)
fetches these four files..." paragraph (it's already stale — the code fetches
six) with:

```
The watchlist analytics panel (`index.html` `#analytics-panel`) fetches these
files directly at boot via `fetch()`, inside `bootValuations()`:

Required (missing/failed ⇒ panel shows a load-error row, matching prior
behavior):
- `data/valuations.json`      — FV bands + currentPrice
- `data/risk-scores.json`     — verdict + score + coverage (all 22 tickers)
- `data/portfolio-current.json` — held symbol set
- `data/sector-map.json`      — sector label lookup
- `data/price-quotes.json`    — price + changePct + verified
- `data/tickers-universe.json` — the 22-ticker universe (name/sector/held/theme)

Optional / progressive enhancement (missing ⇒ that column/detail-block renders
`—` or `N/A`, the rest of the panel still works):
- `data/analyst-targets.json` — Wall Street consensus price targets
- `data/fundamentals.json`    — trailing/forward P/E
- `data/news-latest.json`     — top 3-5 recent headlines per ticker

`index.html` NEVER fetches `data/news-feed.json` directly (multi-MB) — only
the derived `data/news-latest.json`. No `localStorage` key is written by this
panel; expand/collapse UI state is ephemeral (resets on reload).
```

Add under the `### risk-scores.json` schema block the `coverage` note
described in 3d (supersedes the "Only held positions get a risk score" line —
delete that sentence, replace with a pointer to the `coverage` field).

Add the three new schema blocks from 3a/3b/3c verbatim.

---

## 4. Data flow

```
collector                     validator                        evaluator
  │ reports/raw/                │ cross-check ≥2 src              │ (unchanged)
  │  YYYY-MM-DD-<tkr>-           │                                  │ writes valuations.json
  │  analyst.json                │──▶ data/analyst-targets.json    │ writes risk-scores.json
  │  YYYY-MM-DD-<tkr>-           │──▶ data/fundamentals.json         (NOW also writes
  │  fundamentals.json           │                                    coverage:"informational"
  │                              │──▶ data/news-latest.json            entries for watch-16 —
  │                              │    (sliced from news-feed.json,     evaluator.md scope
  │                              │     regenerated wholesale)          unchanged, this is just
  │                              │                                     a smaller output shape
  │                              │                                     for non-held tickers)
                                                                    │
                                                                    ▼
                                                            index.html bootValuations()
                                                              Promise.all([
                                                                6 required fetches (existing),
                                                                3 optional fetches (NEW,
                                                                  fetchJsonSafe — null on
                                                                  404/network error, never
                                                                  throws)
                                                              ])
                                                              → v3.analyticsRows (merged, 22 rows)
                                                              → renderAnalytics()
```

### Boot integration (pseudocode — not production code)

Keep the existing function name `bootValuations()` (avoid a gratuitous
rename; its role broadening to "the analytics boot" doesn't need a rename to
be understood from the diff). Replace its body:

```js
async function fetchJsonSafe(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function bootValuations() {
  const [valData, riskData, portData, sectorData, quotesData, universeData] =
    await Promise.all([
      fetch('data/valuations.json').then(r => r.json()),
      fetch('data/risk-scores.json').then(r => r.json()),
      fetch('data/portfolio-current.json').then(r => r.json()),
      fetch('data/sector-map.json').then(r => r.json()),
      fetch('data/price-quotes.json').then(r => r.json()),
      fetch('data/tickers-universe.json').then(r => r.json()),
    ]).catch(() => { throw new Error('core fetch failed'); }); // same all-or-nothing
                                                                 // error path as today

  // NEW — optional, independently soft-failing:
  const [analystData, fundData, newsData] = await Promise.all([
    fetchJsonSafe('data/analyst-targets.json'),
    fetchJsonSafe('data/fundamentals.json'),
    fetchJsonSafe('data/news-latest.json'),
  ]);
  // analystData / fundData / newsData may each independently be null.
  // Treat null as {} downstream — every lookup becomes undefined ⇒ '—'.

  // ...build v3.analyticsRows by merging all sources per symbol (§4b)...
  renderAnalytics();
}
```

The **existing try/catch around the 6 required fetches is unchanged** — if any
of those 6 fail, the panel shows the existing error row (same UX regression
boundary as before). The 3 new fetches use `fetchJsonSafe` and are wrapped in
their own `Promise.all` *after* the required one resolves, so a missing
`analyst-targets.json` (e.g., before validator has run once) never blanks the
whole table — this is the critical backward-compatibility property, since
this design ships before those 3 files necessarily have real content.

### Row merge (§4b, pseudocode)

```js
v3.analyticsRows = universeData.tickers.map(t => {
  const sym = t.symbol;
  const q = quotesData.quotes[sym] || null;
  const v = valData.valuations[sym] || null;
  const risk = riskData.scores[sym] || null;
  const at = (analystData && analystData.targets && analystData.targets[sym]) || null;
  const fu = (fundData && fundData.fundamentals && fundData.fundamentals[sym]) || null;
  const nw = (newsData && newsData.tickers && newsData.tickers[sym] && newsData.tickers[sym].items) || [];

  return {
    sym, name: t.name, sector: t.sector, themes: t.theme,
    held: heldSymbols.has(sym),
    price: q ? q.price : null, changePct: q ? q.changePct : null, verified: q ? q.verified : false,
    fvLow: v && v.fvLow, fvMid: v && v.fvMid, fvHigh: v && v.fvHigh,
    fvUpside: v && v.upsideMidPct, fvMethod: v && v.method, fvRationale: v && v.rationale,
    fvCatalysts: v && v.catalysts, fvRisks: v && v.risks,
    fvUpdated: v && v.updated, nextReview: v && v.nextReview,
    riskScore: risk && risk.score, riskVerdict: risk && risk.verdict,
    riskCoverage: risk && risk.coverage,           // 'full' | 'informational' | undefined
    riskEntryZone: risk && risk.entryZone, riskTarget: risk && risk.target,
    riskStopLoss: risk && risk.stopLoss, riskRrr: risk && risk.rrr,
    riskRisks: risk && risk.risks, riskDecisionLog: risk && risk.decisionLog,
    analystLow: at && at.low, analystMean: at && at.mean, analystHigh: at && at.high,
    analystNumAnalysts: at && at.numAnalysts, analystAsOf: at && at.asOf,
    analystVerified: at && at.verified, analystNA: !!(at && at.notApplicable), analystReason: at && at.reason,
    trailingPE: fu && fu.trailingPE, forwardPE: fu && fu.forwardPE,
    peVerified: fu && fu.verified, peNA: !!(fu && fu.notApplicable), peReason: fu && fu.reason,
    newsItems: nw,
    trend: deriveTrend(q && q.changePct, v),        // §5
    stale: deriveStale(v && v.nextReview),           // §6
  };
});
```

---

## 5. Trend — phase 1 (cheap, derived from data already fetched)

**Explicitly NOT a multi-day trend.** True trend needs a price-history time
series, which does not exist yet (deferred, §8). Phase 1 combines two signals
already in memory:

1. **Day direction** — sign of `changePct` from `price-quotes.json`, with a
   0.1%-magnitude deadband to avoid flickering "up/down" on noise:
   `dayDir = changePct > 0.1 ? 'up' : changePct < -0.1 ? 'down' : 'flat'`
2. **FV-band position** — reuses the exact clamp math already implemented in
   `buildValRow()` for the FV bar marker (`pct = clamp((price-fvLow)/(fvHigh-fvLow), 0, 1)`),
   collapsed to 3 states instead of a continuous marker:
   `bandTag = price < fvLow ? 'under' : price > fvHigh ? 'over' : 'fair'`

```js
function deriveTrend(changePct, v) {
  if (changePct == null) return { dayCls: 'flat', dayArrow: '—', bandTag: null };
  const dayCls = changePct > 0.1 ? 'up' : changePct < -0.1 ? 'down' : 'flat';
  const dayArrow = dayCls === 'up' ? '▲' : dayCls === 'down' ? '▼' : '–';
  let bandTag = null;
  if (v && v.fvLow != null && v.fvHigh != null && v.currentPrice != null) {
    bandTag = v.currentPrice < v.fvLow ? 'under' : v.currentPrice > v.fvHigh ? 'over' : 'fair';
  }
  return { dayCls, dayArrow, bandTag };
}
```

The detail panel's Trend block includes a one-line disclosure, exactly this
text (do not shorten it — it's the fact-verification-bar disclosure the user
asked for): *"Phase-1 approximation: daily price direction + position vs. FV
band. Not a multi-day trend — that requires a price-history store (deferred,
see design doc §8)."*

---

## 6. Staleness — mandatory, no exceptions

**Rule:** if `nextReview` (from `valuations.json`) is a date strictly before
today (`new Date().toISOString().slice(0,10)`), the row is stale. This is
computed **client-side at render time** (not baked into any JSON), so it's
always correct relative to "now," including across days without a data
refresh.

```js
function deriveStale(nextReview) {
  if (!nextReview) return { isStale: false };
  const today = new Date().toISOString().slice(0, 10);
  return { isStale: nextReview < today, nextReview };
}
```

**Rendering:**
- Summary row: no dedicated stale column (keeps the 9-column budget intact) —
  instead, the FV Upside cell (col 6) gets a small amber dot prefix
  (`<span class="wl-stale-dot"></span>`) when stale, using `var(--amber)`.
- Detail panel: a full-width banner at the top of `.wl-detail-grid`, always
  the first child when stale:
  `⚠ STALE — evaluator last updated {fvUpdated} · nextReview {nextReview} (passed)`
  styled via `.wl-stale-banner` (`background: var(--amber-soft); color: var(--amber)`).

**This is intentionally not skippable** — per CLAUDE.md's fact-verification
bar, a stale FV band must never be presented as current. Given the actual data
today (§0), expect every one of the 22 rows to show this banner until the next
evaluator cycle runs. That is correct and should NOT be "fixed" by suppressing
the banner — it's the honest signal the user asked for.

---

## 7. Filter / sort

**Filter — unchanged behavior, kept:** 전체/보유/워치 (all/held/watch) toggle,
same 3-button `.lang-toggle`-style group as today, renamed `id="wl-filter"`
(was `val-filter-held`), same `data-val-filter` → `data-wl-filter` attribute
rename for consistency with the new ID scheme.

**Sort — extended.** Replace the single cycling button with a field `<select>`
plus the existing desc/asc/none cycling button (button now toggles direction
for whichever field is selected, not just upside):

```html
<select id="wl-sort-field">
  <option value="fvUpside" selected>FV Upside</option>
  <option value="analystUpside">Analyst Upside</option>
  <option value="riskScore">Risk Score</option>
  <option value="changePct">Chg %</option>
</select>
<button id="wl-sort-dir" class="val-sort-btn active" data-sort="desc">↓</button>
```

Cycle: `desc → asc → none → desc` (unchanged mechanics from today's
`#val-sort-upside`). **Null-safety:** rows with a `null` value for the
selected sort field always sort to the end, regardless of direction —
`array.sort((a,b) => { if (a[f]==null) return 1; if (b[f]==null) return -1; ... })`.
This matters immediately: `analystUpside` and `riskScore` (for tickers not
yet covered) will commonly be null before validator/evaluator have run a full
cycle over all 22 tickers.

`v3.wlFilter` (was `v3.valFilter`), `v3.wlSortField` (new), `v3.wlSortDir`
(was `v3.valSort`) — state names updated to match the merged card's identity.

---

## 8. Phase 2 — explicitly deferred (do not build now)

- **True multi-day trend.** Requires a price-history time series
  (`data/price-history.json` or a rolling window appended to
  `price-quotes.json`) and a real classifier (N-day return, SMA slope, etc.).
  Phase 1's arrow+band-tag is a placeholder, clearly labeled as such in the
  UI (§5).
- **`scripts/scrape-fundamentals.mjs`.** A Node 20 stdlib-fetch scraper,
  structurally parallel to `scripts/scrape-quotes.mjs`, to populate
  `data/fundamentals.json` non-interactively on the twice-daily GH Actions
  cron. Phase 1 ships with validator populating it manually from collector
  drops — the schema (§3b) is already shaped so this scraper is a drop-in
  writer, no schema migration needed when it lands.
- **Full risk-score expansion for the 16 watch-only tickers.** Upgrading a
  ticker from `coverage:"informational"` to `coverage:"full"` requires the
  evaluator to run a complete entry/target/stop workup — and per
  `evaluator.md`'s "Portfolio-aware" rule, concentration risk is explicitly
  held-only, so a structural rule change there would be needed too if full
  coverage is ever wanted for non-positions. Not in this design's scope.
- **Watch-16 revaluation cadence.** Reuse the existing
  `2026-06-07-review-cycle-design.md` `nextReview`-driven trigger mechanism to
  decide when informational risk scores get refreshed — no new mechanism
  defined here.
- **Sparkline/mini-chart visuals.** Rejected for phase 1 (§1) on cost grounds;
  revisit only on explicit request once the cheap trend indicator has been
  seen in practice.
- **Additional filter chips** (verified-only, sector dropdown, "stale only").
  Not added — kept the filter surface identical to precedent per Karpathy
  simplicity; add later only if requested.

---

## 9. CSS additions (all existing `:root` vars, no new hex, appended before `</style>`)

```css
/* ===== Watchlist Analytics (merged) ===== */
.wl-row { cursor: pointer; }
.wl-row:hover { background: var(--cyan-soft); }
.wl-row.expanded { background: var(--panel-2); }
.wl-toggle { display: inline-block; color: var(--muted); transition: transform .15s; }
.wl-row.expanded .wl-toggle { transform: rotate(90deg); color: var(--cyan-2); }

.wl-mobile-sub { display: none; font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 2px; }
@media (max-width: 480px) { .wl-mobile-sub { display: block; } }

.wl-detail-cell { padding: 0 !important; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.wl-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 16px; }
.wl-detail-block { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 12px; }
.wl-detail-block h4 { margin: 0 0 8px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }

.wl-stale-banner {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: var(--r-sm);
  background: var(--amber-soft); color: var(--amber);
  font-size: 11px; font-weight: 600; font-family: var(--mono);
}
.wl-stale-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--amber); margin-right: 4px; }

.trend-cell { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; }
.trend-arrow.up { color: var(--green); }
.trend-arrow.down { color: var(--red); }
.trend-arrow.flat { color: var(--muted); }
.trend-band { padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: .04em; }
.trend-band.under { background: var(--green-soft); color: var(--green); }
.trend-band.fair  { background: var(--line-2); color: var(--muted); }
.trend-band.over  { background: var(--red-soft); color: var(--red); }

.analyst-bar-wrap { display: flex; align-items: center; justify-content: center; }
.analyst-bar { position: relative; width: 60px; height: 8px; border-radius: 4px;
  background: linear-gradient(90deg, var(--line-2), var(--cyan-soft), var(--gold-soft)); }
.analyst-bar-marker { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--ink); border-radius: 1px; }

.news-item { padding: 6px 0; border-bottom: 1px solid var(--line-2); font-size: 11px; }
.news-item:last-child { border-bottom: none; }
.news-item .headline { color: var(--ink-2); line-height: 1.4; }
.news-item .meta { color: var(--faint); font-family: var(--mono); font-size: 10px; margin-top: 2px; }
.news-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 4px; }
.news-dot.verified { background: var(--green); }
.news-dot.unverified { background: var(--faint); }

.wl-sort-select {
  padding: 4px 8px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--panel-2); color: var(--ink-2); font-size: 11px; font-family: var(--mono);
}

@media (max-width: 1024px) {
  #analytics-table th:nth-child(8), #analytics-table td:nth-child(8) { display: none; }
}
@media (max-width: 768px) {
  #analytics-table th:nth-child(2), #analytics-table td:nth-child(2),
  #analytics-table th:nth-child(7), #analytics-table td:nth-child(7) { display: none; }
}
@media (max-width: 480px) {
  #analytics-table th:nth-child(3), #analytics-table td:nth-child(3),
  #analytics-table th:nth-child(4), #analytics-table td:nth-child(4) { display: none; }
}
@media (max-width: 380px) {
  #analytics-table th:nth-child(6), #analytics-table td:nth-child(6) { display: none; }
}
```

Existing `.fv-band`, `.fv-bar-wrap`, `.fv-bar`, `.fv-bar-marker`,
`.verdict-pill`, `.verdict-*`, `.val-sort-btn`, `.sector-tag`, `.pill` classes
are all reused as-is in the detail panel and summary row — no duplication.

---

## 10. HTML shell changes

**Remove:** the `<!-- Watchlist -->` block (lines 528-551) and the
`<!-- Valuations -->` block (lines 554-586) — both entirely.

**Add** in their place, one card:

```html
<!-- Watchlist Analytics -->
<div class="card" id="analytics-panel" style="margin-bottom: 16px;">
  <div class="card-head">
    <h3><span class="ko">워치리스트 분석 — 22 종목</span><span class="en">Watchlist Analytics — 22 Tickers</span></h3>
    <span class="sub" id="wl-updated">data/valuations.json + risk-scores.json + analyst-targets.json</span>
    <span class="spacer"></span>
    <div class="lang-toggle" id="wl-filter">
      <button data-wl-filter="all" class="active">전체</button>
      <button data-wl-filter="held">보유</button>
      <button data-wl-filter="watch">워치</button>
    </div>
    <select id="wl-sort-field" class="wl-sort-select">
      <option value="fvUpside" selected>FV Upside</option>
      <option value="analystUpside">Analyst Upside</option>
      <option value="riskScore">Risk Score</option>
      <option value="changePct">Chg %</option>
    </select>
    <button id="wl-sort-dir" class="val-sort-btn active" data-sort="desc">↓</button>
    <span class="pill live"><span class="blob"></span>SYNCED</span>
  </div>
  <div class="card-body flush">
    <table class="watchlist" id="analytics-table">
      <thead>
        <tr>
          <th><span class="ko">종목</span><span class="en">Ticker</span></th>
          <th><span class="ko">섹터</span><span class="en">Sector</span></th>
          <th style="text-align:right"><span class="ko">가격/등락</span><span class="en">Price/Chg</span></th>
          <th style="text-align:center"><span class="ko">추세</span><span class="en">Trend</span></th>
          <th style="text-align:center"><span class="ko">리스크</span><span class="en">Risk</span></th>
          <th style="text-align:right"><span class="ko">FV 업사이드</span><span class="en">FV Upside</span></th>
          <th style="text-align:right"><span class="ko">애널리스트</span><span class="en">Analyst</span></th>
          <th style="text-align:right">PER</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="analytics-body">
        <tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted)">로딩 중…</td></tr>
      </tbody>
    </table>
  </div>
</div>
```

**Sidebar:** the current two links —
`<div class="side-link" data-scroll="watchlist-body">...워치리스트...</div>`
(line 381) and
`<div class="side-link" data-scroll="valuation-panel">...밸류에이션 FV...</div>`
(line 383) — both pointed at cards that no longer exist as separate cards.
**Delete the second one** (line 383) and **repoint the first** to the new
card:

```html
<div class="side-link" data-scroll="analytics-panel"><span class="dot"></span><span class="ko">워치리스트 분석</span><span class="en">Watchlist Analytics</span></div>
```

---

## 11. JS changes summary (ordered for the builder)

1. Add `fetchJsonSafe()` helper (§4, near the top of the `<script>` block that
   already defines `escapeHtml()`).
2. In the `v3` init block (currently `v3.valuationRows = []; v3.watchlistRows
   = []; v3.valFilter = 'all'; v3.valSort = 'desc'; v3.tickerSector = {};`),
   replace with: `v3.analyticsRows = []; v3.wlFilter = 'all'; v3.wlSortField =
   'fvUpside'; v3.wlSortDir = 'desc'; v3.tickerSector = {}; v3.expandedRows =
   new Set();`.
3. Rewrite `bootValuations()` per §4 pseudocode (keep the name; keep the
   6-file required `Promise.all` + its existing `catch`; add the 3-file
   optional `Promise.all` with `fetchJsonSafe`; build `v3.analyticsRows`; call
   `renderAnalytics()` once).
4. **Delete** `renderWatchlist()`, `buildWatchRow()`, `renderValuations()`,
   `buildValRow()`, `verdictClass()` (all now superseded).
5. **Add** `renderAnalytics()` — filters `v3.analyticsRows` by `v3.wlFilter`,
   sorts by `v3.wlSortField`/`v3.wlSortDir` with null-last semantics (§7),
   then for each row emits `buildAnalyticsRow(r)` and, if
   `v3.expandedRows.has(r.sym)`, also `buildAnalyticsDetail(r)` immediately
   after it. Joins and writes to `#analytics-body`.
6. **Add** `buildAnalyticsRow(r)` — the 9-`<td>` summary row per §2, using
   `deriveTrend`/`deriveStale` output already computed on `r` (§5/§6), reusing
   `.sym`/`.name`/`.pill.live`/`.sector-tag`/`.verdict-pill` classes exactly
   as the deleted functions did. Every interpolated string goes through
   `escapeHtml()`.
7. **Add** `buildAnalyticsDetail(r)` — the `colspan="9"` detail grid per §1
   mockup / §9 CSS classes: stale banner (if `r.stale.isStale`) + FV block
   (reuses `.fv-band`/`.fv-bar-wrap` markup verbatim from the deleted
   `buildValRow`) + Risk block (branches on `r.riskCoverage` — full shows
   entryZone/target/stopLoss/rrr/decisionLog, informational shows only
   score/verdict/risks[], missing shows "No risk coverage yet") + Analyst
   block (bar + numAnalysts/asOf, or "N/A — {reason}" or "—") + PER block
   (trailing/forward, or "N/A — {reason}" or "—") + News block (up to 5
   `.news-item`s with `.news-dot.verified`/`.unverified`, `<a
   href="{escapeHtml(url)}">`).
8. **Add** click delegation on `#analytics-body` (single listener, survives
   re-renders since it's on the parent): toggle membership in
   `v3.expandedRows`, call `renderAnalytics()`.
9. **Rewrite** the filter/sort listeners: `#wl-filter` button click sets
   `v3.wlFilter`; `#wl-sort-field` change sets `v3.wlSortField` and resets
   `v3.wlSortDir` to `'desc'`; `#wl-sort-dir` click cycles
   `desc→asc→none→desc` for whichever field is currently selected. All three
   call `renderAnalytics()`.
10. Sidebar: update the one link, delete the other (§10).

---

## 12. Test plan

**JSON / syntax gate (run first, per CLAUDE.md):**
1. `for f in data/analyst-targets.json data/fundamentals.json data/news-latest.json data/risk-scores.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" && echo OK $f; done`
2. Run the inline-script syntax checker from CLAUDE.md against `index.html`.

**Functional (serve via `python3 -m http.server 8765`, open in browser, devtools open):**
3. No console errors on load. Network tab shows exactly 9 fetches to `data/*.json`
   from `bootValuations()` (6 required + 3 optional) — **zero** requests to
   `data/news-feed.json`.
4. `#analytics-body` renders 22 collapsed rows.
5. Resize to 1200/1024/768/480/380px — confirm the exact column sets in the
   §2 table at each width (use devtools "Toggle device toolbar" for precision
   at the boundary pixels, e.g. 1023px vs 1025px).
6. Click GOOGL's row → detail expands. Confirm: stale banner present and
   reads "last updated 2026-06-05 · nextReview 2026-07-01" (expected — see §0);
   Risk block shows entryZone/target/stopLoss/rrr/decisionLog (coverage=full).
7. Click NVDA's row (or any watch-only ticker) → confirm Risk block shows
   ONLY score/verdict/risks[], no entryZone/target/stopLoss/rrr text anywhere
   — this is the concrete assertion that `coverage:"informational"` is
   respected. If `data/risk-scores.json` has not yet been extended with an
   NVDA entry, confirm it instead renders "No risk coverage yet" and does not
   throw.
8. Temporarily rename `data/analyst-targets.json`, `data/fundamentals.json`,
   `data/news-latest.json` (simulate pre-validator state) and reload — confirm
   the table still renders all 22 rows with price/sector/risk/FV intact, and
   the Analyst/PER/News cells show `—` (not a blank crash, not a full-table
   error). Restore the files after.
9. Once `data/analyst-targets.json`/`data/fundamentals.json` are populated for
   SOXL/TSMU, confirm their Analyst/PER cells show "N/A" (not "—") — the
   `notApplicable` path is distinct from the "missing data" path.
10. Filter: 전체→22 rows, 보유→6 rows (GOOGL/CLS/AVGO/MRVL/MU/SOXL), 워치→16
    rows.
11. Sort: select "Risk Score", cycle direction, confirm rows with `null`
    riskScore (any not-yet-covered watch ticker) sort to the bottom in both
    directions.
12. `data/README.md` diff matches §3e exactly; the stale "four files" fetch
    paragraph is gone, replaced by the required/optional 9-file list.

**Regression:**
13. Sector Heatmap, Market Regime gauge, Whale strip, Trump triggers, the 30s
    tick — all still render/update exactly as before (none of this design
    touches `MarketData`, `data.js`, or those render functions).
14. Sidebar: clicking "워치리스트 분석" scrolls to and flashes
    `#analytics-panel`; the deleted "밸류에이션 FV" link no longer exists in
    the DOM (no dangling `data-scroll` target).

---

## 13. Rollout sequencing note (for the orchestrator/planner)

This design ships correctly even with `data/analyst-targets.json`,
`data/fundamentals.json`, `data/news-latest.json` absent (§4, §12 item 8) —
the UI degrades to `—` for those columns, everything else works. Recommended
sequencing once the builder ships this:
1. Builder implements this design → merged table live, new columns show `—`.
2. Planner dispatches collector for analyst consensus + trailing/forward PE
   across all 22 tickers → validator stamps → `analyst-targets.json` +
   `fundamentals.json` populate.
3. Validator generates the first `news-latest.json` slice.
4. Evaluator extends `risk-scores.json` with `coverage:"informational"`
   entries for the 16 watch-only tickers (can be done incrementally, ticker by
   ticker — each missing entry just renders "No risk coverage yet" until
   then).
5. Evaluator runs a full review cycle (per the existing
   `2026-06-07-review-cycle-design.md` mechanism) to clear the stale banners.

None of these are blocked on each other in the UI — they're independent
data-population steps that each light up one more column/block.
