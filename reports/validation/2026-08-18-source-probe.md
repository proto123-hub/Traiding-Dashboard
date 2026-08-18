# Source probe — ground truth from a GitHub runner IP (2026-08-18 11:20 UTC / 07:20 ET, pre-market)

Raw payloads captured by `scripts/probe-sources.mjs` in CI (run 32131178808). The
dev sandbox cannot reach any finance host, so this is the authoritative record of
what each upstream actually returns.

## 1. Cboe — we were reading the wrong field

```jsonc
// cdn.cboe.com/api/global/delayed_quotes/quotes/MRVL.json
{"data": {"current_price": 236.2,   // Cboe venue's own last print
          "price_change": 12.31,     // change belonging to that print's session
          "close": 234.33,           // OFFICIAL consolidated close  ← what we want
          "prev_day_close": 234.33,
          "last_trade_time": "2026-08-17T15:59:59",  // note: 15:59:59, NOT 16:00
          "exchange_id": 2, "open": 227.56, "high": 240.18, "low": 226.89}}
```

`current_price` is Cboe's **own venue's** last trade, stamped `15:59:59` — one
second *before* the 16:00 closing auction, so it misses the auction print.
`close` is the official consolidated close. Our adapter read `current_price`,
which is why MRVL showed 236.20 against NASDAQ's 234.33 (0.8% off) and why
`price − prev_day_close` never matched the `price_change` field.

Cboe carries **no pre/post-market data at all** — every field is from the last
completed regular session (`last_trade_time` 2026-08-17T15:59:59 on an 08-18
pre-market request).

## 2. NASDAQ — primaryData vs secondaryData is the session split

```jsonc
// api.nasdaq.com/api/quote/MRVL/info?assetclass=stocks
{"primaryData":   {"lastSalePrice":"$222.25", "lastTradeTimestamp":"Aug 18, 2026 7:20 AM ET",
                   "isRealTime":true},                       // ← live PRE-MARKET print
 "secondaryData": {"lastSalePrice":"$234.33", "lastTradeTimestamp":"Closed at Aug 17, 2026 4:00 PM ET",
                   "isRealTime":false},                      // ← official prior close
 "marketStatus": "Pre-Market"}
```

Our adapter read `primaryData` unconditionally, so during the pre-market cron it
published a live extended-hours print and compared it against Cboe's
regular-session number. **Category error, not a tolerance problem.**

`marketStatus` is served explicitly (`Pre-Market` / `Market Open` / `After Hours`
/ `Closed`) — the scraper can key off it rather than guessing from the clock.

Note: `assetclass=stocks` returns `"Symbol not exists."` for SOXL (NYSE Arca);
the existing 3-assetclass fallback already handles this — leave it alone.

## 3. CNBC — explicitly session-tagged, and it agrees with everyone

```jsonc
{"symbol":"SOXL", "last":"151.53", "last_time":"2026-08-17",   // regular close
 "previous_day_closing":"151.53", "curmktstatus":"PRE_MKT",
 "ExtendedMktQuote": {"type":"PRE_MKT", "last":"137.27",
                      "change":"-14.26", "change_pct":"-9.41%",
                      "last_time":"2026-08-18T07:20:13.618-0400"}}
```

CNBC separates the two cleanly and covers equities **and** indices, so it is a
much stronger source than the "indices-only probe" the previous design assumed.

## 4. Like-for-like, the three sources agree almost exactly

| symbol | official close (cboe `close` / nasdaq `secondaryData` / cnbc `last`) | extended (nasdaq `primaryData` / cnbc `ExtendedMktQuote`) |
|---|---|---|
| MRVL | 234.33 / 234.33 / 234.33 | 222.25 / — |
| GOOGL | 344.00 / 344.00 / — | 342.15 / — |
| SOXL | 151.53 / — / 151.53 | 137.20 / 137.27 (0.05% apart) |

The 22/23 exact `prevClose` agreement seen in the 11:15 UTC drop is the same
signal: **the settled close is cross-verifiable; live extended-hours prints are
venue-specific and are not.**

## 5. Yahoo — dead from runner IPs, confirmed

Cookie warm-up succeeded (`fc.yahoo.com` → `A3=d=AQABBOs_hGoC…`), and *with* that
cookie both endpoints still refused:

- `query1…/v7/finance/spark?symbols=SOXL,MRVL,GOOGL` → **HTTP 429** "Too Many Requests"
- `query2…/v8/finance/chart/SOXL` → **HTTP 429**

First request of the run, 3 symbols, warmed cookie, alternate host — still 429.
This is per-IP reputation blocking, not pacing. Yahoo is unrecoverable here.

## 6. Stooq — endpoint removed, not IP-blocked

All three variants return a branded Stooq 404 page ("The page you requested does
not exist or has been moved" / "Wybrana lokalizacja nie istnieje"):

- `stooq.com/q/l/?s=soxl.us+mrvl.us+googl.us&f=sd2t2ohlcv&h&e=csv` → 404
- `stooq.com/q/l/?s=googl.us&…` (single) → 404
- `stooq.pl/q/l/?s=googl.us&…` (mirror) → 404

A styled 404 from the site's own template means the **path is gone**, not that we
were fingerprinted. No UA/Referer/batching change can recover it.

## 7. Cboe `_TNX` is a degenerate feed

```jsonc
{"current_price":47.24, "close":47.24, "prev_day_close":47.24,
 "open":0.0, "high":0.0, "low":0.0, "volume":0, "price_change":0.0,
 "last_trade_time":"2026-08-17T00:00:00-05:00"}
```

Yield ×10 (47.24 = 4.724%), all OHLC zeroed. CNBC reports US10Y = 4.74. After
÷10 normalisation the two are 0.34% apart — inside the 0.5% macro tolerance the
comparator convention already specifies, but outside the 0.2% equity default.

## Implications

1. Read `close` from Cboe and `secondaryData` from NASDAQ → the official close
   becomes cross-verifiable for ~all equities.
2. Publish the extended-hours print as its own session-tagged value, verified
   separately (nasdaq × cnbc), never mixed into the close comparison.
3. Drop Yahoo and Stooq — both are structurally gone; keeping them only burns
   ~2 minutes of runtime and fills `failures[]` with noise.
4. Promote CNBC from indices-probe to a first-class source (equities + indices).
5. Implement the per-class tolerance the comparator convention already documents
   (equity 0.2% / index-yield 0.5% / FX 0.1%) and normalise `_TNX` ÷10.
