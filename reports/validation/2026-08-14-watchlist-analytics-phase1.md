# Validation Report — Watchlist Analytics Phase 1 (Analyst Targets + Fundamentals)

**Date:** 2026-08-14
**Agent:** validator
**Scope:** Cross-verify the 3 collector raw drops (`reports/raw/2026-08-14-analyst-fundamentals-{held,semis,software}.json`,
22 tickers) and stamp `data/analyst-targets.json` + `data/fundamentals.json` per
`reports/designs/2026-08-14-watchlist-analytics-view.md`. Also regenerates
`data/news-latest.json` from `data/news-feed.json`.

---

## 0. Collection-method caveat (applies to every figure below)

All three collector drops report the same limitation: **WebFetch was
EGRESS_BLOCKED for every candidate financial-data domain this session**
(confirmed org-level via a control test against `example.com`, not
source-specific). Every figure in the raw drops — and every re-check the
validator performed — was obtained via the **WebSearch** tool with
`allowed_domains` restricted per source, which returns an AI-generated
synthesis of that domain's indexed snippets, not a direct parse of the page.

This is materially weaker provenance than a normal scrape. Practically:
- `verified: true` in the output files means **"≥2 independently-queried
  search snapshots agree within tolerance,"** not "confirmed against a
  primary filing or a directly-fetched page."
- Several sources' own snippets show internally inconsistent or
  self-contradicting numbers across repeated queries (e.g., MRVL's
  stockanalysis.com pull surfaced a "46.89% higher" statement that
  contradicted its own low/high math; AMAT's TipRanks pull surfaced two
  different mean/upside figures in the same session). The collector
  consistently flagged and did not silently pick a winner in these cases —
  the validator adjudicated them explicitly below.
- The `collectionMethod` field is carried verbatim (summarized) into the top
  level of both `data/analyst-targets.json` and `data/fundamentals.json`.

The validator spent 8 targeted WebSearch re-checks (same tool, same
limitation) on the held tickers and the worst cross-source disagreements —
see §2. These re-checks corroborate or contradict the original figures but do
**not** escape the underlying weakness (still search-snapshot synthesis).

---

## 1. Results summary

| Metric | Verified | Not verified | Not applicable | Total |
|---|---|---|---|---|
| Analyst targets (`data/analyst-targets.json`) | **15** | **5** | 2 (SOXL, TSMU) | 22 |
| Fundamentals / PE (`data/fundamentals.json`) | **0** | **20** | 2 (SOXL, TSMU) | 22 |

**Key finding:** not a single ticker achieved a fully cross-verified PE this
cycle (both trailingPE and forwardPE agreeing across ≥2 independent sources
within tolerance). Most tickers had only one source report a numeric PE at
all; the handful with 2+ numeric PE readings (GOOGL, AVGO, MRVL, MU, TSM,
MSFT) disagreed by double-digit percentages — in several cases plausibly
because sources are on different EPS bases (GAAP vs. non-GAAP/adjusted), not
because either number is simply "wrong." GOOGL's trailingPE is the one
exception where the validator independently resolved the disagreement (see
§2) — it is presented as effectively cross-verified at ~17.95 even though the
schema's combined `verified` boolean stays `false` (forwardPE remains
single-source).

Analyst-target consensus fared much better: 15/20 real tickers (i.e.
excluding the two notApplicable ETFs) verified via ≥2-source agreement within
the 5% mean tolerance, several with exact-match low/high figures across
independently-queried sources (strong corroboration signal).

---

## 2. Targeted re-checks performed (8 WebSearch calls, budget-capped)

| # | Ticker | Question | Result |
|---|---|---|---|
| 1 | GOOGL | trailingPE 17.94 (SA) vs 27.8 (TipRanks) — which is right? | GuruFocus TTM PE = 17.37 (as of 08-13) and 17.96 (as of 08-10) — clusters with SA (17.94), rejects TipRanks (27.8) as the outlier. **trailingPE effectively resolved to ~17.95.** |
| 2 | AVGO | Is targetLow $215.88 a scraping fluke? | Reproduced identically on recheck ($215.88 / $527.88 / $675) — real, reproducible figure, but still judged a likely stale/unadjusted individual analyst target in the S&P Global aggregate (48% below current price, inconsistent with the otherwise bullish mean/high). |
| 3 | MU | Is MarketBeat's $1,260.31 mean stale? | Reproduced identically (also cites "37 brokerages" this time) — real, but MarketBeat's own snippet cites constituent targets (Mizuho $800, Citi $425, Bernstein $330) explicitly described as reflecting "different report dates over the past year," i.e. not fully refreshed post-rally. **Excluded from consensus.** |
| 4 | CRWD | Which range is current — SA's $103-250 or MarketBeat/Benzinga's $295-613? | Recheck surfaced evidence CRWD fell from ~$450 (Apr 2026) with a Street-high cut from $805 (Jun 4) to a low of $169 (Jul 6) — consistent with a ~50% decline into the current $225.65 price. **SA's $103-250/mean $195.39 is the current, post-decline reading; MarketBeat/Benzinga reflect a stale pre-decline regime.** Largest correction this session. |
| 5 | INTC | Which forward PE is right (76.86 / 71.42 / 138.89)? | GuruFocus's 76.86 (as of 08-11) reproduced exactly on recheck. The other two figures were never captured as structured sources by the collector — remains technically single-source despite reproducibility. |
| 6 | ORCL | Is the SA ($247) vs MarketBeat/TipRanks (~$350) gap real? | SA's $247.17/44-analysts reproduced exactly, plus a corroborating alternate citation matching SA's price basis. MarketBeat/TipRanks show identical low/high (shared vendor data, not independent) and TipRanks' stated "last price" ($257.85) is confirmed stale vs. the live quote (~$156). **SA treated as current; MarketBeat/TipRanks excluded as stale (pre-decline regime, same pattern as CRWD).** |
| 7 | GOOGL (retry 1) | *(first attempt blocked — `wsj.com` not accessible to WebSearch's user agent)* | Retried with macrotrends.net/ycharts/gurufocus.com instead — see #1. |
| 8 | KLAC | Did KLA's rumored 10-for-1 split actually happen, and are sources on a consistent basis? | **Confirmed real**: KLA executed a 10-for-1 forward split effective 2026-06-11 (record date 06-04, split-adjusted trading from 06-12) — official press release / 8-K. All 3 collector sources (~$197-210 price context, ~$165-325 targets) are consistently on the **post-split** basis, matching the live post-split price ($209.55). No basis mismatch. |

---

## 3. Analyst targets — per-ticker verdicts

### Verified (15) — held tickers first

| Ticker | mean (used) | basis | spread | note |
|---|---|---|---|---|
| **GOOGL** (held) | $425.32 | stockanalysis.com + tipranks.com avg | 1.29% | MarketBeat corroborates. TipRanks' price context stale (-7.7% vs live) but doesn't affect the $ target. |
| **CLS** (held) | $453.06 | stockanalysis.com + tipranks.com avg | 4.03% | MarketBeat's low/high are individual quotes, not official consensus (per its own note). |
| **AVGO** (held) | $522.10 | stockanalysis.com + tipranks.com avg | 2.19% | targetLow $215.88 outlier reproduced but flagged — see §2 #2. |
| **MRVL** (held) | $258.06 | SA + MarketBeat pairing (4.27%) | — | Preferred SA+TipRanks pairing narrowly MISSES tolerance (5.32%) — verified rests on the weaker pairing. Flagged with caution. |
| **MU** (held) | $1,535.54 | stockanalysis.com + tipranks.com avg | 4.27% | MarketBeat ($1,260.31) excluded — see §2 #3. |
| TSM | $533.36 | 4-way average | max 3.63% | All 4 sources agree tightly despite stale price context (3.5-9.4% below live). |
| PLTR | $193.10 | 3-way average | max 3.71% | Low/high exact matches across SA/TipRanks. |
| NVDA | $306.24 | 3-way average | max 2.29% | High ($500) exact match SA/TipRanks. |
| AMD | $626.83 | SA + tipranks.com avg | 4.37% | MarketBeat excluded as outlier (10.8-14.7% off). High ($1,250) exact match. |
| AMAT | $634.41 | SA + tipranks.com avg | 1.67% | High ($900) exact match. |
| LRCX | $373.58 | SA + tipranks.com avg | 2.87% | MarketBeat corroborates. |
| KLAC | $231.95 | 3-way average | max 4.33% | 10-for-1 split confirmed real, no basis mismatch — see §2 #8. |
| MSFT | $566.02 | SA + tipranks.com avg | 1.24% | TipRanks' $700 high is an individual target, not consensus — excluded from high. |
| TSLA | $389.58 | SA vs MarketBeat/TipRanks (identical) | 3.55% | MarketBeat/TipRanks byte-identical (not independent). $19.05 low excluded as a likely pre-split stale outlier. |
| INTC | $117.00 | SA + tipranks.com avg (only passing pair) | 3.55% | MarketBeat (6.12%) and WallStreetZen (15.9%, dated 08-11, a genuine minority view not staleness) both fall outside tolerance. |

### Not verified (5)

| Ticker | Best-available figure | Reason |
|---|---|---|
| **ARM** | TipRanks $301.06 (low $150/high $500) | stockanalysis.com excluded — page self-dated 2026-06-24, 51 days stale (>30-day rule), predates ARM's Jul 29 post-earnings target cuts. Remaining 2 sources (TipRanks $301.06 vs MarketBeat $285.33) diverge 5.23% — marginally outside tolerance. |
| **META** | stockanalysis.com $754.14 (low $580/high $1000) | All 3 sources disagree pairwise beyond tolerance (max 17.0%). MarketBeat/TipRanks price context is 7.6-8.5% ABOVE live price — likely an earlier/higher snapshot; SA's price context is only 2.4% off. |
| **ORCL** | stockanalysis.com $247.17 (low $110/high $400) | MarketBeat/TipRanks (~$346-354, identical to each other — shared vendor data) excluded as stale/pre-decline, reconfirmed via recheck — see §2 #6. ~30-40% unreconciled gap, largest previously-unflagged discrepancy found this session besides CRWD. |
| **SNOW** | stockanalysis.com $302.29 (low $110/high $500) | TipRanks excluded — price context 18.9% below live, treated as a substantially dated snapshot. MarketBeat too partial (no low/mean/high captured). Only 1 usable source remains. |
| **CRWD** | stockanalysis.com $195.39 (low $103.25/high $250) | MarketBeat (explicitly dated Oct 2025) and Benzinga both excluded as reflecting a pre-decline CRWD regime — see §2 #4. **This is the highest-confidence correction in the dataset — the evaluator should use the $103-250/mean $195 range, NOT the $295-613 range originally surfaced by MarketBeat/Benzinga.** |

### Not applicable (2)

SOXL (3x leveraged semis ETF), TSMU (2x leveraged TSM ETF) — no sell-side
analyst coverage exists for either, consistent with the collector's raw
drops.

---

## 4. Fundamentals (PE) — per-ticker verdicts

**Zero of 20 real tickers achieved a fully verified PE** (both trailingPE and
forwardPE cross-checked within tolerance). Breakdown of why:

**Single-source only, no cross-check possible (13):** CLS, MRVL (trailing
only), MU (trailing only), PLTR, NVDA, AMD, AMAT, LRCX, KLAC, META, TSLA,
ORCL, CRWD (forward only).

**Two+ sources but fail tolerance, unreconciled (5):**
- **GOOGL** trailingPE — resolved via independent recheck to ~17.95 (SA
  17.94 + GuruFocus 17.37/17.96); TipRanks' 27.8 rejected as an outlier. See
  §2 #1. forwardPE remains single-source, so the combined `verified` flag
  stays false per schema, but trailingPE specifically should be trusted.
- **AVGO** trailingPE 69.25 vs 62.23 (10.1% off); forwardPE 26.4 vs ~83
  (~3.1x off) — plausibly a GAAP vs. non-GAAP/adjusted EPS basis difference
  (Broadcom's GAAP EPS runs well below adjusted due to VMware-related
  intangible amortization) — hypothesis only, not confirmed.
- **MU** forwardPE 5.99 vs 11.1 (46% off) — MU is a highly cyclical memory
  name where small forward-EPS-estimate differences swing PE hugely; not
  reconciled.
- **TSM** trailingPE 29.70 vs 37.57/35.59 (21% off, and WallStreetZen itself
  cited two different figures in the same pull) — not reconciled.
- **MSFT** trailingPE 28.07 vs 38.75 — MarketBeat's own collector note
  flagged this figure's metric definition as ambiguous (unclear if truly
  trailing) — not treated as a genuine cross-check.

**Not meaningful (GAAP loss, consistent across all sources) (2):** SNOW
(trailing + forward both null — forward wasn't captured numerically anywhere
structured), CRWD (trailing null; forward is Yahoo Finance single-source,
181.82), INTC (trailing null; forward is GuruFocus single-source, 76.86,
reproducibly confirmed but only one structured source — see §2 #5).

**Excluded / no usable data (1):** ARM — its only PE source
(stockanalysis.com) is the same page excluded for staleness in §3; no other
source reported numeric ARM PE. `trailingPE`/`forwardPE` written as `null`
rather than passing along an unverified stale figure.

**Not applicable (2):** SOXL, TSMU.

---

## 5. Trust list for the evaluator

**Analyst targets — trust (verified:true, 15):** GOOGL, CLS, AVGO, MRVL
(caution flag — see above), MU, TSM, PLTR, NVDA, AMD, AMAT, LRCX, KLAC, MSFT,
TSLA, INTC.

**Analyst targets — do NOT trust as verified (verified:false, 5):** ARM,
META, ORCL, SNOW, CRWD. Best-available figures are still populated (per the
schema's single-source convention) and are the validator's best current
estimate, but should be displayed/used with a "single-source, not
cross-verified" caveat, not as confirmed consensus. **CRWD and ORCL in
particular carry corrected figures that differ drastically (60-70% lower)
from what a naive single-source pull would show if it happened to land on
MarketBeat/Benzinga/TipRanks instead of stockanalysis.com — this is the most
important caution to carry forward.**

**Fundamentals/PE — do NOT trust ANY ticker's `verified:true` for PE this
cycle (0/20).** Even where only one number is on file (13 tickers), treat it
as directional/unconfirmed, not a validated figure. Where two numbers
disagree (GOOGL, AVGO, MU, TSM, MSFT), the headline `trailingPE`/`forwardPE`
values written to `data/fundamentals.json` are the validator's primary
pick (usually stockanalysis.com, the fullest source) — read the `note` field
per ticker before using in any downstream calculation. The one partial
exception is **GOOGL trailingPE (~17.95)**, which the validator independently
cross-verified via a second, differently-sourced recheck (GuruFocus) and is
safe to treat as reliable despite the schema's combined `verified:false`.

**Not applicable (both files):** SOXL, TSMU.

---

## 6. `data/news-latest.json`

Regenerated wholesale from `data/news-feed.json` (8,316 total items across
all tickers — file itself was never loaded via the Read tool, only processed
in a Node subprocess per CLAUDE.md's news-feed.json handling rule). All 22
tickers received the full `maxItemsPerTicker: 5` (110 items total, 75KB,
under the 100KB budget). `verified` flags were carried through as-is from
`news-feed.json` — not re-adjudicated this session.

Coverage is thin: most tickers had **zero** `verified:true` items available
in `news-feed.json` and were fully backfilled with unverified items (sorted
by recency). Exceptions: MU (1 verified), ARM (1 verified), TSM (26
verified), TSMU (2 verified, but both dated 2026-05 — since the design's
selection rule is "verified first regardless of recency, backfilled after,"
TSMU's top slots show 2 old-but-verified items ahead of more-recent
unverified ones; flagged here as expected-but-worth-knowing UI behavior, not
a bug), SOXL (11 verified).

---

## 7. Files written this session

- `data/analyst-targets.json` (22 tickers, `updated: "2026-08-14"`,
  `agent: "validator"`)
- `data/fundamentals.json` (22 tickers, same stamps)
- `data/news-latest.json` (22 tickers × ≤5 items, 110 items total)
- This report

Not touched (per task scope): `index.html`, `data/README.md`,
`data/valuations.json`, `data/risk-scores.json`, `data/news-feed.json`,
`data/price-quotes.json`.
