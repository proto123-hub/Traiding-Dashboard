# Price Stamp — 2026-06-05 (Abbreviated Validator Pass)

**Stamped by:** validator  
**Stamped at:** 2026-06-05T14:00:00Z  
**Input sources:** reports/validation/2026-06-05-compare.json, data/price-quotes.json  
**Scope:** 7 portfolio symbols — GOOGL, AVGO, CLS, MRVL, MU, SOXL, TSM  
**No external live research performed. All decisions based on in-repo data only.**

---

## Adopted Price Table

| Symbol | Adopted Price (USD) | Source Basis | Accepted? | Note |
|--------|--------------------:|--------------|-----------|------|
| GOOGL  | $369.775 | nasdaq (single-source; stooq: no_close, yahoo: http_429) | single-source-accepted | Only one live feed returned a value. Accepted provisionally for evaluator use. |
| AVGO   | $402.23  | nasdaq + yahoo (delta 0.04%, within 0.2% tolerance) | verified | Cross-source confirmed. price-quotes.json verified=true. Adopt nasdaq value $402.23. |
| CLS    | $398.675 | nasdaq (single-source; stooq: no_close, yahoo: http_429) | single-source-accepted | Only one live feed returned a value. Accepted provisionally for evaluator use. |
| MRVL   | $288.83  | nasdaq (override; stooq $296.95 rejected — see MRVL note below) | single-source-accepted (override) | See MRVL resolution note. price-quotes.json stores $296.95 (stooq); evaluator MUST use $288.83. |
| MU     | $927.93  | nasdaq (single-source; stooq: no_close, yahoo: http_429) | single-source-accepted | Only one live feed returned a value. Accepted provisionally for evaluator use. |
| SOXL   | $217.41  | nasdaq (single-source; stooq: no_close, yahoo: http_429) | single-source-accepted | Only one live feed returned a value. Accepted provisionally for evaluator use. |
| TSM    | $427.5403 | nasdaq (single-source; stooq: no_close, yahoo: http_429) | single-source-accepted | Only one live feed returned a value. Accepted provisionally for evaluator use. |

---

## MRVL Resolution Note

comparator recorded: stooq $296.95 vs nasdaq $288.8251, delta = 2.81% (tolerance 0.2%).  
price-quotes.json `price` field currently holds $296.95 (stooq, the primary feed by refresher design).

**Resolution:** The stooq value is rejected for 6/5 because:

1. Stooq returned no_close for 18 of 27 symbols on this run, indicating a systemic data lag or feed disruption on 6/5. The partial population of MRVL from stooq is therefore suspect — it may carry a prior-session close rather than the 6/5 intraday close.
2. The 6/5 session was a broad risk-off selloff (NDX -1.93%, semis severely hit: CLS -6.27%, AVGO -3.98%, ARM -8.91%, MU -6.83%). A delta of +2.81% for MRVL from the stooq feed against nasdaq is directionally inconsistent with the sector tape on this date — stooq appearing higher while nasdaq shows deeper decline is the expected signature of a stale/lagged stooq quote.
3. nasdaq is the only source that returned a value for MRVL that is consistent with the sector drawdown pattern.

**Adopted price for MRVL: $288.83 (nasdaq)**  
price-quotes.json MRVL `price` field = $296.95 — this value is NOT corrected per instruction. Evaluator must override: use $288.83, not $296.95 from the file.

---

## Source Failure Context

- stooq: returned `no_close` for 18/27 symbols on this run. Feed was substantially degraded. Any stooq-only value on 6/5 should be treated as unconfirmed.
- yahoo: returned `http_429` (rate-limited) for 19/27 symbols. AVGO and MSFT/AMD got through before the limit hit.
- As a result, most symbols ended up single-source (nasdaq) through no fault of the collector — the third-party feeds were both unavailable.

---

## Summary

AVGO is the only symbol with a cross-source verified price (nasdaq + yahoo, delta 0.04%). The remaining 6 symbols are single-source-accepted from nasdaq, which is the most reliable feed available on this date given stooq degradation and yahoo rate-limiting. MRVL is a special case: price-quotes.json holds $296.95 (stooq), but the stamp overrides to $288.83 (nasdaq) due to evidence of stooq lag. Evaluator should use stamped prices from this document, not raw price-quotes.json values, wherever they differ.
