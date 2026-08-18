# Data Layer — Schema Reference

All runtime data lives in this folder as JSON. The dashboard boots with these
as the authoritative seed, then layers browser `localStorage` on top so that
user edits persist between sessions without requiring a commit.

## Files

| File | Purpose | Write owner |
|------|---------|-------------|
| `portfolio-current.json` | Current holdings snapshot (symbol, shares, avg cost, weight) | Human (manual entry UI) |
| `assets-history.json` | Monthly asset snapshots for the trend chart | Human (manual entry UI) |
| `tickers-universe.json` | Watchlist — every ticker the agents can analyze | Human + collector agent |
| `valuations.json` | Per-ticker fair-value bands + thesis | evaluator agent |
| `risk-scores.json` | Per-ticker risk score + entry zone + target | evaluator agent |
| `news-feed.json` | Collected news items with verification state | collector + validator |
| `sector-map.json` | Ticker → sector bucket → macro theme | architect agent |
| `price-quotes.json` | Cron-scraped quote table with cross-source verification | refresher agent + GH Actions |
| `analyst-targets.json` | Wall Street analyst consensus price targets (low/mean/high, numAnalysts) | validator |
| `fundamentals.json` | Trailing/forward P/E per ticker (basis-aware, cross-verified) + ETF expense ratio/AUM | refresher agent + GH Actions (`scripts/scrape-fundamentals.mjs`) |
| `news-latest.json` | Top 3-5 recent headlines per ticker, sliced from news-feed.json — the ONLY news file index.html fetches | validator |

## Resolution order at boot

```
localStorage[key]  →  data/*.json  →  hard-coded fallback (legacy v3.portfolio)
```

Writes from the manual-entry UI go to `localStorage` only. Committing the
`localStorage` state into `data/*.json` is a deliberate "Save to repo" action
(see dashboard footer button) — this keeps git history as the audit trail for
month-over-month changes without noisy commits.

The watchlist analytics panel (`index.html` `#analytics-panel`) fetches these
files directly at boot via `fetch()`, inside `bootValuations()`:

Required (missing/failed ⇒ panel shows a load-error row, matching prior
behavior):
- `data/valuations.json`      — FV bands + currentPrice
- `data/risk-scores.json`     — verdict + score + coverage (all 22 tickers)
- `data/portfolio-current.json` — held symbol set
- `data/sector-map.json`      — sector label lookup
- `data/price-quotes.json`    — price + changePct + verified (+ optional
extended{} block, not yet consumed by index.html — see §6)
- `data/tickers-universe.json` — the 22-ticker universe (name/sector/held/theme)

Optional / progressive enhancement (missing ⇒ that column/detail-block renders
`—` or `N/A`, the rest of the panel still works):
- `data/analyst-targets.json` — Wall Street consensus price targets
- `data/fundamentals.json`    — trailing/forward P/E
- `data/news-latest.json`     — top 3-5 recent headlines per ticker

`index.html` NEVER fetches `data/news-feed.json` directly (multi-MB) — only
the derived `data/news-latest.json`. No `localStorage` key is written by this
panel; expand/collapse UI state is ephemeral (resets on reload).

These reads are non-blocking: the rest of the dashboard renders from `data.js`
as before; the analytics panel populates when the fetches resolve (~50ms local).

## Schemas

### portfolio-current.json
```jsonc
{
  "asOf": "2026-05-05",         // YYYY-MM-DD of the quote reference
  "broker": ["Kiwoom", "Samsung Securities"],
  "currency": "USD",            // book currency
  "totalCost": 171976.46,       // USD — broker-recorded book cost (authoritative;
                                //   may differ from Σ(shares×avgCost) by rounding)
  "cash": 2232.93,              // USD — uninvested cash balance (optional)
  "note": "5/5 sync — ...",     // optional provenance note for the snapshot
  "positions": [
    {
      "symbol": "GOOGL",
      "shares": 240,
      "avgCost": 317.8767,
      "weight": 0.4436,         // fraction, not percent; cost-fraction of positions (Σ ≈ 1.0)
      "broker": "Samsung",      // optional
      "note": "Custom Silicon thesis anchor"
    }
  ]
}
```

### assets-history.json
```jsonc
{
  "baseCurrency": "USD",
  "snapshots": [
    {
      "month": "2026-04",       // YYYY-MM, always month-end close
      "asOf": "2026-04-22",
      "totalMV": 210500.00,     // market value
      "totalCost": 172850.08,
      "cash": 0,
      "pnl": 37649.92,
      "pnlPct": 21.78,
      "byTicker": {
        "GOOGL": { "mv": 80419, "shares": 237, "price": 339.32 }
      },
      "note": "Manual entry — GOOGL ATH, CLS trim pending"
    }
  ]
}
```

### valuations.json
Per-ticker entries live under a `valuations` wrapper (a top-level `note`
documents ownership). Held positions + peer-reference tickers may both appear.
```jsonc
{
  "note": "Owned by the evaluator agent. Writes must include method[], rationale, catalysts[], nextReview.",
  "valuations": {
    "GOOGL": {
      "updated": "2026-06-05",
      "agent": "evaluator",
      "fvLow": 330,
      "fvMid": 367,
      "fvHigh": 430,
      "currentPrice": 365.51,        // adopted price from the validator price-stamp
      "upsideMidPct": 0.41,          // (fvMid / currentPrice − 1) × 100
      "method": ["DCF-10y", "EV/EBITDA-peer", "SOTP-Cloud+Search+Waymo"],
      "rationale": "...",            // single-line string; cite each method's inputs
      "catalysts": ["Gemini 3 GA", "TPU v7 cloud revenue", "DOJ remedy clarity"],
      "risks": ["DOJ remedy", "43.5% book concentration"],  // optional string[]
      "nextReview": "2026-07-01"
    }
  }
}
```
> FV bands (`fvLow/fvMid/fvHigh`) are fundamental — they do **not** move on price
> alone. On a price refresh only `currentPrice` + `upsideMidPct` re-anchor.
> Leveraged ETFs use NAV-decay methods, e.g. `method: ["NAV-decay-adjusted", "3x-beta-scaling"]`.

### risk-scores.json
Per-ticker entries live under a `scores` wrapper, alongside a top-level `note`
and a `legend` (score bands + verdict vocabulary). Every entry carries a
mandatory `coverage: "full" | "informational"` field — see the delta note
below the schema block.
```jsonc
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
      "score": 43,                // 0=low risk, 100=max risk
      "verdict": "HOLD",          // may diverge from score band w/ rationale (e.g. position mgmt)
      "entryZone": { "low": 345, "high": 360 },
      "target": { "base": 400, "bull": 443, "bear": 310 },
      "stopLoss": 340,
      "rrr": 1.35,                // (target.base − currentPrice) / (currentPrice − stopLoss)
      "risks": [
        { "tag": "regulatory", "severity": "high", "note": "DOJ remedy Q4 ruling" },
        { "tag": "concentration", "severity": "medium", "note": "40.9% of book" }
      ],
      "decisionLog": [            // APPEND-ONLY — never rewrite prior entries
        { "date": "2026-04-22", "action": "HOLD", "by": "evaluator", "reason": "At mid-FV" },
        { "date": "2026-06-05", "action": "HOLD", "by": "evaluator", "reason": "Concentration >40% threshold" }
      ]
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
`coverage` is additive and **supersedes** the prior "Only held positions get a
risk score — peer-reference tickers stay valuation-only" rule. Going forward,
all 22 universe tickers get a `scores` entry; held tickers keep the existing
full contract (`coverage:"full"`), watch-only tickers get a deliberately
smaller contract (`coverage:"informational"` — score/verdict/risks[] only, no
trade-recommendation fields). Backward compatible: the 6 existing held entries
are untouched except for the one new `coverage:"full"` field.

### analyst-targets.json
Owner: **validator** (writes after collector drops raw consensus figures to
`reports/raw/YYYY-MM-DD-<ticker>-analyst.json`; validator cross-checks and
writes here). Separate from `valuations.json` — this is Wall Street sell-side
consensus, NOT the evaluator's fundamental FV band. Verified tolerance: 5%
(0.05) fractional spread between ≥2 sources' `mean` figures — wider than the
0.2% used for `price-quotes.json` because aggregator consensus means still
drift more than same-tick price quotes. Leveraged ETFs (SOXL, TSMU) have no
sell-side coverage — see `notApplicable`.
```jsonc
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
rather than hiding the number, matching the existing quote-verification UX.

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

### news-latest.json
Owner: **validator**, regenerated (full overwrite, not appended) each cycle by
slicing `data/news-feed.json`. **`index.html` must never fetch
`data/news-feed.json` directly** — only this derived file, which stays small
enough for the browser (3-5 items × 22 tickers ≈ 100 items max).
```jsonc
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

### news-feed.json
```jsonc
{
  "items": [
    {
      "id": "2026-04-22-googl-gemini3",
      "ticker": "GOOGL",
      "headline": "Google Gemini 3 GA timing teased at Cloud Next",
      "source": "CNBC",
      "url": "https://...",
      "collectedAt": "2026-04-22T18:00:00Z",
      "verified": true,
      "verifiedBy": ["validator"],
      "crossSources": ["Reuters", "Bloomberg"],
      "sentiment": 0.7,
      "impact": "medium",
      "eventType": "product-launch"
    }
  ]
}
```

### price-quotes.json
Refreshed by `.github/workflows/data-refresh.yml` (cron 21:00 UTC + 11:00 UTC on
weekdays) and merged into `v3.seedQuotes` by the dashboard at boot and on Refresh.
Sources (see `scripts/scrape-quotes.mjs` header comment for the authoritative
rationale/rate parameters — Yahoo and Stooq were removed 2026-08-18, both
structurally dead from runner IPs, see the header tombstone): **NASDAQ**
public API (primary), **Cboe** delayed-quotes CDN (secondary), **CNBC**
restQuote (tertiary, full coverage — equities, ETFs, and indices), plus
manual **Kapture** imports merged into `perSource.kapture`. `verified: true`
iff ANY PAIR of distinct `perSource` values agrees within the symbol's
class-resolved tolerance (see `toleranceByClass`) — not all sources.

**Session-aware since 2026-08-18** (`reports/designs/2026-08-18-session-aware-quotes.md`):
`quotes[sym].price`/`.changePct`/`.verified` describe ONLY the official
**regular-session close** — never a live pre/after-hours print. A live print,
when available, is reported separately under the optional `quotes[sym].extended`
block and is verified independently; it is never blended into the close
comparison. `quotes[sym].regularSessionDate` states which completed session
`price` belongs to (diagnostic only — a parse miss leaves it `null`, it never
silently mislabels a session). Top-level `session` states the market phase at
scrape time (`"pre-market"|"intraday"|"after-hours"|"closed"`).

Note: Cboe and NASDAQ are operationally independent (different
operators/infra/failure modes) but both ultimately read the consolidated
tape, so their agreement is a weaker verification signal than two genuinely
distinct data pipelines; CNBC is a distinct, unofficial partner feed with no
SLA, kept in the priority chain last for primary-price selection even though
it participates fully in verification.

```jsonc
{
  "updated": "2026-08-18T21:05:00Z",   // ISO timestamp of last successful run
  "asOfDate": "2026-08-18",            // YYYY-MM-DD of the scrape run
  "agent": "refresher",
  "sources": ["nasdaq", "cboe", "cnbc"],
  "session": "after-hours",            // market phase at scrape time
  "tolerance": 0.002,                  // back-compat scalar = toleranceByClass.equity
  "toleranceByClass": { "equity": 0.002, "index": 0.005, "fx": 0.001 },
  "quotes": {
    "GOOGL": {
      "price": 344.00,
      "change": 7.04,
      "changePct": 2.12,
      "prevClose": 336.96,
      "regularSessionDate": "2026-08-17",
      "verified": true,
      "sourceCount": 2,
      "assetClass": "equity",
      "perSource": { "nasdaq": 344.00, "cboe": 344.00, "kapture": 344.00 },
      "lastUpdated": "2026-08-18T21:04:58Z",
      "extended": {                     // optional — omitted when no live print exists this cycle
        "price": 342.15,
        "changePct": -0.54,
        "verified": false,
        "sessionType": "pre-market",
        "perSource": { "nasdaq": 342.15 }
      }
    }
  },
  "failures": [
    { "symbol": "TSMU", "source": "cnbc", "reason": "cnbc:not_found" }
  ]
}
```

### tickers-universe.json
Array of tickers under the `tickers` key. Each entry:
```
  "symbol"  string   — ticker symbol (authoritative key)
  "name"    string   — human-readable company / fund name  [added 2026-06-06]
  "sector"  string   — fine-grained sector bucket (matches sector-map.json keys)
  "held"    boolean  — true if currently in portfolio-current.json positions
  "theme"   string[] — 2-4 thesis tags (matched to sector-map.json theme strings)
```
Also contains an `"indices"` array for macro reference symbols (SPX, NDX, VIX, DXY, US10Y).
These are NOT rendered in the watchlist table.

### Kapture import shape
The dashboard's "Kapture Import" modal accepts either JSON or CSV exported from
the Kapture Chrome extension on a TradingView or Saveticker page.

JSON:
```json
{
  "source": "tradingview",
  "exportedAt": "2026-04-26T20:00:00Z",
  "rows": [
    { "symbol": "GOOGL", "price": 339.32, "change": 7.04, "changePct": 2.12 }
  ]
}
```
CSV (with header):
```
symbol,price,change,changePct
GOOGL,339.32,7.04,2.12
```
Imports merge into `price-quotes.json` under `perSource.kapture` and trigger
the comparator agent unless `verifyAgainstScrape` is unchecked.
