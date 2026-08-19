# Phase-3 source probe — verdicts from a GitHub runner IP (2026-08-19 11:04 UTC)

Captured by `scripts/probe-sources.mjs` in CI (run 32245778866, job 96045841081).
The dev sandbox reaches none of these hosts, so this is the authoritative record.

A first attempt (run 185) died on the 8-minute job timeout: six FRED requests
each hung ~72s on TCP connect with no per-request deadline, so nothing past FRED
was tested. Re-run with an 8s `withTimeout` on every request — 24 candidates
settled in 80 seconds.

## Sovereign yields

| source | verdict | detail |
|---|---|---|
| **FRED** `fredgraph.csv` | ❌ **DEAD** | All 8 requests (DGS10/DGS2/DGS30 + the five OECD `IRLTLT01<CC>M156N` series + PCU33443344) timed out at 8s. Not an HTTP status — the connection never completes. `fred.stlouisfed.org` does not answer GitHub runner IPs. **This retires the scout's highest-confidence candidate and the "one CSV mechanism covers all six countries" plan.** |
| **US Treasury** daily par yield curve | ✅ **WORKS, and is better than FRED would have been** | HTTP 200 · `text/csv` · 12.9KB · 280ms. Full 2026 daily history, **every maturity 1Mo→30Yr** in one file. Latest row `08/18/2026: 2Y 4.19, 10Y 4.71, 30Y 5.28`. |
| **Japan MoF** `jgbcme.csv` (English) | ✅ **WORKS** | HTTP 200 · `text/csv` · 1.3KB · 953ms. Daily, **1Y→40Y**. Header `Interest Rate (August 2026)` — **current month only**, so history needs the archive files. 10Y ran 2.824 → 2.848 in early August. |
| Japan MoF `jgbcm.csv` (Japanese) | ⚠️ works, do not use | Same data, but Shift-JIS (mojibake through `res.text()`) and Reiwa-era dates (`R8.8.3`). The English file is the same series without either problem. |
| **Eurostat** `irt_lt_mcby_m` | ✅ **WORKS** | HTTP 200 · `application/json` · 212KB · 1029ms. "EMU convergence criterion series — monthly data", `updated: 2026-08-13`. Covers DE/FR/IT per country. **JSON-stat format**: a flat `value` object keyed by integer offset, so the dimension index must be decoded to map a number to (country, month). Monthly, 10y only. |
| ECB `YC` dataset | ⚠️ works, wrong granularity — as predicted | HTTP 200 · `text/csv` · 3.2KB. Euro-area **aggregate** curve, not per country. Probed only to close the question; do not revisit. |
| **BoE** `IUAAMNPY` | ⚠️ works, **wrong series** | HTTP 200 · 54 bytes · returned exactly two rows: `31 Dec 2024, 4.143` and `31 Dec 2025, 4.5833`. This is the **annual average**, confirming the scout's suspicion. The IADB endpoint itself is reachable and key-less — only the series code is wrong. UK is the one unresolved leg. |

### Coverage after the probe

| country | source | cadence | maturities |
|---|---|---|---|
| US | US Treasury CSV | daily | 1Mo–30Y |
| Japan | MoF `jgbcme.csv` | daily | 1Y–40Y (current month; archive needed for history) |
| Germany / France / Italy | Eurostat `irt_lt_mcby_m` | monthly | 10y |
| **UK** | **unresolved** — BoE IADB reachable, need the daily/monthly 10y series code | — | — |

Five of six countries are automatable today. UK needs one more series-code hunt
against the same reachable BoE endpoint; until then it is a curated row, which
the schema already supports (same row shape, different `source`/`agent`).

Note US 10Y here is **4.71** against `data/price-quotes.json`'s 4.724 from
cboe `_TNX` + cnbc — 0.3% apart, inside the 0.5% index tolerance. Treasury is
therefore also usable as an independent third source for the existing US10Y
quote, not only for history.

## Memory share and NAND pricing

Every host is **reachable** (no blocks, no paywall at the HTTP layer) and every
one returns a full HTML page rather than a data feed:

| source | HTTP | size | shape |
|---|---|---|---|
| TrendForce press release (HBM/DRAM share) | 200 | 185KB | HTML article, figures in prose |
| TrendForce press-center index | 200 | 269KB | HTML listing |
| Counterpoint DRAM/HBM share | 200 | 176KB | Next.js app shell |
| TrendForce DRAM spot price | 200 | 215KB | HTML, priced tables gated |
| DRAMeXchange market activity | 200 | 22.6KB | small shell — values not in the initial HTML |

**Verdict: curated, as the scout judged.** Reachability was never the obstacle;
the absence of a stable machine-readable series is. A regex over a 185KB
marketing page would be a silent-breakage source of truth for numbers that enter
valuation reasoning — the wrong trade for a quarterly/monthly cadence. HBM share
stays quarterly collector→validator; NAND pricing stays monthly collector→validator.

FRED's semiconductor PPI (`PCU33443344`), the one key-less numeric alternative,
is dead along with the rest of FRED — and was only ever a too-broad proxy.

## Incidental findings from the same run

- The two new watchlist tickers landed cleanly: `scrape-quotes: 29/29 symbols,
  27 verified` (PANW and SNDK included) and `scrape-fundamentals: 13/22 trailing
  verified`, up from 11/20.
- The rebase-and-retry added on 2026-08-18 fired for real: the refresh push was
  rejected non-fast-forward, rebased onto origin, and pushed successfully. Before
  that fix this run's entire refresh would have been discarded.
