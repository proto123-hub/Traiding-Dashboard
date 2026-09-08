# Fundamentals source probe — ground truth from a runner IP (2026-08-18 11:31 UTC)

Captured by `scripts/probe-sources.mjs` in CI (run 32132122149). Goal: find
key-less sources for trailing/forward P/E so `data/fundamentals.json` can stop
being 100% unverified.

## Verdict: CNBC is the primary, and it is rich

`quote.cnbc.com/quote-html-webservice/quote.htm?symbols=GOOGL&requestMethod=quick&noform=1&partnerId=2&fund=1&exthrs=1&output=json&symbolType=symbol`
→ HTTP 200, no auth, and carries a full `FundamentalData` block:

```jsonc
"FundamentalData": {
  "pe": "17.2604",        // trailing P/E  (= last 344.00 / eps 19.93 ✓)
  "eps": "19.93",         // TTM diluted EPS
  "fpe": "26.0626",       // forward P/E   (= 344.00 / feps 13.199 ✓)
  "feps": "13.199",       // forward EPS (NTM)
  "psales": "9.4358", "fpsales": "7.6328",
  "mktcap": "4137260150000", "sharesout": "12230000000",
  "dividend": "0.88", "dividendyield": "0.0026", "beta": "1.2199",
  "revenuettm": "445867000000", "ROETTM": "49.5486",
  "NETPROFTTM": "54.7708", "GROSMGNTTM": "60.8964", "DEBTEQTYQ": "16.0433"
}
```

The `restQuote` endpoint carries the same `pe`/`fpe`/`eps`/`feps` inline, and both
accept `|`-separated multi-symbol batches — so all 22 tickers fit in 1–2 requests.

## Second sources, ranked

| source | status from runner IP | usable for | notes |
|---|---|---|---|
| **stockanalysis.com** `/stocks/{sym}/statistics/` | **HTTP 200**, 121KB HTML | trailing + forward P/E | the `/api/symbol/s/{SYM}/overview` JSON path 404s, but the page renders server-side — needs regex extraction, fragile to redesign |
| **SEC XBRL** `data.sec.gov/api/xbrl/companyconcept/CIK…/us-gaap/EarningsPerShareDiluted.json` | HTTP 200, full history | **authoritative** TTM EPS → computed trailing P/E | needs a CIK map + summing the last 4 quarterly `USD/shares` facts; slowest but highest quality and truly independent |
| NASDAQ `/api/analyst/{sym}/peg-ratio` | HTTP 200 | context only | returns `per.peRatioChart` = P/E on *fiscal-year estimates* (`2025 Actual` 31.82, `2026 Estimates` 16.77) + `pegr.pegValue` 0.97 — **a different definition**, see the trap below |
| NASDAQ `/api/analyst/{sym}/earnings-forecast` | HTTP 200 | forward EPS by quarter/year | consensus/high/low EPS + estimate counts — good for deriving a forward P/E on a *stated* basis |
| macrotrends.net | **HTTP 403** Cloudflare challenge | — | dead |
| wsj.com | **HTTP 401** captcha-delivery | — | dead |

## The forward-P/E definition trap (must be handled, not averaged away)

Forward P/E is not one number. For GOOGL at a 344.00 close:

- CNBC `fpe` **26.06** = 344.00 / `feps` 13.199 (next-twelve-months EPS)
- NASDAQ implied **16.77** = 344.00 / FY2026 consensus EPS 20.51
- NASDAQ implied **23.34** = 344.00 / FY2027 consensus EPS 14.74

All three are "forward P/E" and all are correct on their own basis. Cross-verifying
them against a 5% tolerance would fail forever and, worse, averaging them would
produce a number that means nothing. **The scraper must record the EPS basis
alongside every forward P/E and only compare like bases.** Trailing P/E has no
such ambiguity (price ÷ TTM diluted EPS) and is the number to verify first.

## Bonus find — machine-readable analyst targets

`api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks` returns
`summaryData.OneYrTarget` — `$430.00` for GOOGL, `$1,500.00` for MU — plus
`PreviousClose`, `MarketCap`, `AnnualizedDividend`, `Yield`, 52-week range. For
ETFs (`assetclass=etf`) it returns `ExpenseRatio` (SOXL 0.90%), `AUM`, `Beta` 5.73
instead — exactly the ETF metadata the collector had to hand-note.

This means `data/analyst-targets.json` could move from WebSearch-synthesised
figures to a scraped, cron-refreshable consensus (NASDAQ `OneYrTarget` × CNBC ×
stockanalysis). Worth its own design pass — **out of scope for the P/E work**, but
recorded here so it is not rediscovered.

## Implications for `scripts/scrape-fundamentals.mjs`

1. CNBC batched `quote.htm` is the primary — one request covers all 22 tickers
   with `pe`, `fpe`, `eps`, `feps`.
2. Second source for **trailing** P/E: SEC XBRL computed (authoritative) and/or
   stockanalysis HTML. Verify trailing P/E at the documented tolerance.
3. **Forward** P/E: publish CNBC's NTM figure with `basis: "NTM"` recorded, plus
   NASDAQ's FY-based figures under their own basis labels. Do not cross-verify
   across bases; a forward P/E is `verified` only against another source on the
   same basis, otherwise it stays `verified: false` with the basis stated.
4. ETFs (SOXL, TSMU) keep `notApplicable: true`, now with a real `expenseRatio`
   from the NASDAQ ETF summary instead of a hand-noted one.
