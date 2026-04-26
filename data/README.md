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

## Schemas

### portfolio-current.json
```jsonc
{
  "asOf": "2026-04-22",         // YYYY-MM-DD of the quote reference
  "broker": ["Kiwoom", "Samsung Securities"],
  "totalCost": 172850.08,       // USD
  "positions": [
    {
      "symbol": "GOOGL",
      "shares": 237,
      "avgCost": 317.39,
      "weight": 0.4355,         // fraction, not percent
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
```jsonc
{
  "GOOGL": {
    "updated": "2026-04-22",
    "agent": "evaluator",
    "fvLow": 310,
    "fvMid": 370,
    "fvHigh": 443,
    "currentPrice": 339.32,
    "method": ["DCF-10y", "EV/EBITDA-peer", "SOTP-Cloud+Search+Waymo"],
    "rationale": "...",
    "catalysts": ["Gemini 3 GA", "TPU v7 cloud revenue", "DOJ remedy clarity"],
    "nextReview": "2026-05-01"
  }
}
```

### risk-scores.json
```jsonc
{
  "GOOGL": {
    "updated": "2026-04-22",
    "score": 42,                // 0=low risk, 100=max risk
    "verdict": "HOLD",
    "entryZone": { "low": 315, "high": 330 },
    "target": { "base": 400, "bull": 443, "bear": 310 },
    "stopLoss": 298,
    "rrr": 2.4,                 // reward/risk
    "risks": [
      { "tag": "regulatory", "severity": "high", "note": "DOJ remedy Q4 ruling" },
      { "tag": "concentration", "severity": "medium", "note": "43.5% of book" }
    ]
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
