# Price Stamp — 2026-06-05 (EOD 22:15Z Refresh — Supersedes 13:51Z Stamp)

> 이전 13:51Z 스탬프 supersede — 22:15Z EOD 마감 기준으로 갱신

**Stamped by:** validator  
**Stamped at:** 2026-06-05T22:15:40Z  
**Input sources:** reports/validation/2026-06-05-compare.json (runAt 22:15Z), data/price-quotes.json (updated 2026-06-05T22:15:40Z)  
**Scope:** 7 portfolio symbols — GOOGL, AVGO, CLS, MRVL, MU, SOXL, TSM  
**No external live research performed. All decisions based on in-repo data only.**

---

## Adopted Price Table

| Symbol | Adopted Price (USD) | Source Basis | Accepted? | Note |
|--------|--------------------:|--------------|-----------|------|
| GOOGL  | $365.51 | nasdaq primary (yahoo $368.53 / nasdaq $365.51 — mismatch 0.83%, outside 0.2% tolerance) | single-source-accepted | Two sources present but mismatch exceeds tolerance. nasdaq adopted as primary per price-quotes note. yahoo value rejected. |
| AVGO   | $386.4982 | nasdaq single-source (stooq: no_close, yahoo: http_429) | single-source-accepted | Only nasdaq returned a value. Accepted provisionally. |
| CLS    | $370.5752 | nasdaq single-source (stooq: no_close, yahoo: http_429) | single-source-accepted | Only nasdaq returned a value. Accepted provisionally. |
| MRVL   | $277.50 | nasdaq single-source (stooq: no_close, yahoo: http_429) | single-source-accepted | Only nasdaq returned a value. Accepted provisionally. price-quotes.json price field = $277.50 (nasdaq). No stooq conflict in this refresh. |
| MU     | $875.07 | nasdaq single-source (stooq: no_close, yahoo: http_429) | single-source-accepted | Only nasdaq returned a value. Accepted provisionally. |
| SOXL   | $181.46 | nasdaq single-source (stooq: no_close, yahoo: http_429) | single-source-accepted | Only nasdaq returned a value. Accepted provisionally. RISK FLAG: $181.46 is 6.7% above hard-stop $170.00 — stop proximity watch. |
| TSM    | $412.11 | nasdaq primary (stooq $415.17 / nasdaq $412.109 — mismatch 0.74%, outside 0.2% tolerance; nasdaq adopted per policy) | single-source-accepted | Two sources present but mismatch exceeds tolerance. nasdaq adopted as primary. stooq value $415.17 noted but rejected. Rounded to $412.11. |

---

## GOOGL Mismatch Note

comparator recorded: yahoo $368.53 vs nasdaq $365.51, delta = 0.83% (tolerance 0.2%).  
yahoo value reflects prevClose carry-forward (price-quotes.json stores prevClose: 368.53 from yahoo, price: 365.51 from nasdaq). The yahoo perSource value in this refresh appears to be the prior close, not an independent intraday quote. nasdaq $365.51 is consistent with the EOD close and is adopted.

## TSM Mismatch Note

comparator recorded: stooq $415.17 vs nasdaq $412.109, delta = 0.74% (tolerance 0.2%).  
Mismatch exceeds tolerance; not verified. nasdaq is the designated primary feed per price-quotes note. nasdaq value $412.109 adopted, rounded to $412.11. stooq value $415.17 is retained in price-quotes.json `price` field as the refresher's primary — evaluator must use the stamped $412.11 from this document, not the file's $415.17.

---

## Source Failure Context

- stooq: returned `no_close` for the majority of symbols in this run. Feed substantially degraded. stooq values where present (TSM, ORCL, PLTR) treated as unconfirmed cross-sources only.
- yahoo: returned `http_429` (rate-limited) for most symbols. GOOGL, NVDA got partial values through before rate limit hit.
- As a result, most symbols are single-source (nasdaq). This is consistent with the 13:51Z run pattern — third-party feeds remain degraded across both refreshes on 6/5.

---

## Summary

0 of 7 symbols verified by 2+ independent sources within 0.2% tolerance. All 7 are single-source-accepted from nasdaq, which is the designated primary feed. Two symbols (GOOGL, TSM) had a second source but mismatched beyond tolerance — nasdaq adopted in both cases per policy, with the dissenting values noted above. SOXL at $181.46 is 6.7% above hard-stop $170 and should be flagged for stop-proximity monitoring. Evaluator must use stamped prices from this document, not raw price-quotes.json values, for GOOGL and TSM.
