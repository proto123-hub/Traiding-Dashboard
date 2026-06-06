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
| `price-quotes.json` | Cron-scraped quote table (Yahoo + Saveticker) with cross-source verification | refresher agent + GH Actions |

## Resolution order at boot

```
localStorage[key]  →  data/*.json  →  hard-coded fallback (legacy v3.portfolio)
```

Writes from the manual-entry UI go to `localStorage` only. Committing the
`localStorage` state into `data/*.json` is a deliberate "Save to repo" action
(see dashboard footer button) — this keeps git history as the audit trail for
month-over-month changes without noisy commits.

The valuation panel (`index.html` `#valuation-panel`) fetches these four files
directly at boot via `fetch()`:
- `data/valuations.json` — FV bands + currentPrice
- `data/risk-scores.json` — verdict + score (held tickers only)
- `data/portfolio-current.json` — held symbol set
- `data/sector-map.json` — sector label lookup

These reads are non-blocking: the rest of the dashboard renders from `data.js`
as before; the valuation card populates when the fetches resolve (~50ms local).
No localStorage key is written by the valuation panel.

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
and a `legend` (score bands + verdict vocabulary). Only held positions get a
risk score — peer-reference tickers stay valuation-only.
```jsonc
{
  "note": "Owned by evaluator agent. Score 0-100 (low=safe). Entry zone, target, stop-loss, rrr all required.",
  "legend": {
    "score": { "0-30": "low", "30-60": "medium", "60-100": "high" },
    "verdict": ["STRONG_BUY", "BUY", "HOLD", "TRIM", "SELL"]
  },
  "scores": {
    "GOOGL": {
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
    }
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
```jsonc
{
  "updated": "2026-04-26T21:05:00Z",   // ISO timestamp of last successful run
  "asOfDate": "2026-04-26",            // YYYY-MM-DD of the quote reference
  "agent": "refresher",
  "sources": ["yahoo", "saveticker"],
  "tolerance": 0.002,                  // fractional price-diff cutoff for verified=true
  "quotes": {
    "GOOGL": {
      "price": 339.32,
      "change": 7.04,
      "changePct": 2.12,
      "prevClose": 332.28,
      "verified": true,                // ≥2 sources within tolerance
      "sourceCount": 2,
      "perSource": { "yahoo": 339.32, "saveticker": 339.30, "kapture": 339.32 },
      "lastUpdated": "2026-04-26T21:04:58Z"
    }
  },
  "failures": [
    { "symbol": "TSMU", "source": "saveticker", "reason": "404" }
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
