# Validation Report: SOXL / TSMU / TSM Early Re-Assessment

| Field | Value |
|---|---|
| date | 2026-06-07 |
| agent | validator |
| data as-of | 2026-06-05 |
| scope | ticker IN (SOXL, TSMU, TSM) |
| method | intra-feed cross-source (>=2 independent publishers per event) |

---

## Summary Counts

| Ticker | Total items | Noise removed | Thesis candidates | Verified (>=2 src) | Single-source | Unclassified false |
|---|---|---|---|---|---|---|
| SOXL | 56 | 29 | 27 | 11 | 2 | 14 |
| TSMU | 15 | 7 | 8 | 2 | 0 | 6 |
| TSM | 135 | 0 | 135 | 26 | 2 | 107 |
| **Total** | **206** | **36** | **170** | **39** | **4** | **127** |

---

## Noise / Mis-tagged Items Excluded (36 items, verified=false)

These items were flagged with a `validatorNote` field. No thesis content. Evaluator must disregard.

**SOXL (29 noise items)**
- ChartMill static quote/chart pages (×12) — no news content, pure data pages
- Moomoo user chat posts (×7): "300 is just a milestone", "The party's starting!", "We'll be family soon", etc.
- Moomoo Stock Forum/Discussion page (×1)
- Moomoo Options Chain page (×1)
- Mshale mis-tags (×5): Amber Alert, Seattle immigration judge, Nestory Irankunda soccer goals, Atlanta United soccer highlights, Argentina 2026 World Cup — SOXL appears only as a ticker suffix appended to unrelated viral content
- Mshale mis-tag (×1): "Eternity — Official Trailer | Apple TV" — same pattern
- Moomoo Options Chain (×1): SOXL options chain page
- Moomoo Stock Chart page (×1)

**TSMU (7 noise items)**
- TradingView static chart pages (×3): BOATS:TSMU, NASDAQ:TSMU (two separate dates)
- Texas A&M University Stories (×2): "Buc-ee's Items Now Available at Texas A&M University" (Aug 2025); "Texas A&M University Announces NASCAR/INDYCAR Partnerships" (Apr 2025) — TSMU ticker collision with university abbreviation; entirely unrelated
- Moomoo options chain page (×1): TSMU260515P25000 options page
- Moomoo user chat post (×1): "Bottom-fishing" post

---

## Verified Items (>=2 independent sources) — 39 items promoted to verified=true

### SOXL — 11 verified items across 3 events

**Event 1: SOXL Leverage-Decay / Volatility Risk** (6 items)
Cross-sources: Seeking Alpha, Yahoo Finance, Stock Traders Daily

| id | headline (truncated) | source |
|---|---|---|
| 2026-03-16-soxl-soxl-levered-semis-are-a-risky-bet... | SOXL: Levered Semis Are A Risky Bet As Volatility Rises | Seeking Alpha |
| 2025-09-24-soxl-soxl-evaluating-the-valuation-case... | SOXL: Evaluating the Valuation Case After Recent Volatility | Yahoo Finance |
| 2025-12-01-soxl-big-returns-and-big-risk... | Big Returns and Big Risk: See How SOXL and SSO Measure Up | Yahoo Finance |
| 2026-04-19-soxl-understanding-the-setup-soxl... | Understanding the Setup: (SOXL) and Scalable Risk | Stock Traders Daily |
| 2026-05-26-soxl-soxl-lost-90-percent-in-2022... | SOXL Lost 90% in 2022 While Semiconductors Fell 35% | Yahoo Finance |
| 2026-06-02-soxl-trading-systems-reacting-to-soxl... | Trading Systems Reacting to (SOXL) Volatility | Stock Traders Daily |

**Event 2: SOXL YTD Rally (2026)** (3 items)
Cross-sources: Benzinga, 24/7 Wall St., eciks.org

| id | headline (truncated) | source |
|---|---|---|
| 2026-05-05-soxl-up-160-in-one-month... | Up 160% in One Month, This AI ETF Can Still 5X | 24/7 Wall St. |
| 2026-06-02-soxl-soxl-soars-450-ytd... | SOXL Soars 450% YTD As AI Chip Rally Ignites Leveraged ETF Frenzy | Benzinga |
| 2026-06-05-soxl-soxl-stock-surges-over-320-year-to-date... | SOXL stock surges over 320% year-to-date on AI chip rally | eciks.org |

Note on number discrepancy: Benzinga cites 450% YTD (as of Jun 2), eciks.org cites 320%+ YTD (as of Jun 5). These figures are inconsistent but both cover the same directional event (massive YTD rally). The specific percentage figures are not independently cross-confirmed to the 1% tolerance; only the existence of the YTD rally is verified. Evaluator should treat the exact number as unverified; use only as directional confirmation.

**Event 3: SOXL Multi-Bagger Performance Features** (2 items)
Cross-sources: Yahoo Finance, 24/7 Wall St.

| id | headline (truncated) | source |
|---|---|---|
| 2026-05-28-soxl-etf-turns-100k-to-1-28m... | ETF Turns $100k to $1.28m in 1 Year. Reddit Says It'll Double Again | Yahoo Finance |
| 2026-06-02-soxl-10-000-in-soxl-became-131-000... | $10,000 in SOXL Became $131,000 in 13 Months, but Almost Nobody Held It | 24/7 Wall St. |

---

### TSMU — 2 verified items, 1 event

**Event: GraniteShares 2x Long TSM Daily ETF (TSMU) Launch** (2 items)
Cross-sources: Yahoo Finance, ETF Trends

| id | headline (truncated) | source |
|---|---|---|
| 2024-11-13-tsmu-graniteshares-expands-lineup... | GraniteShares Expands Lineup With 3 Tech-Focused ETFs | Yahoo Finance |
| 2024-11-18-tsmu-etf-industry-kpi-11-18-2024... | ETF Industry KPI – 11/18/2024 | ETF Trends |

Note: etftrends.com and ETF Trends carry the same article (same headline, same date). They are the same publisher; counted as one source. Yahoo Finance is the independent second source.

---

### TSM — 26 verified items across 10 events

**Event 1: TSMC Stock Record High ~Apr 24 2026** (5 items)
Cross-sources: Barron's, Seeking Alpha, TipRanks, Investor's Business Daily
Trigger: Taiwan government loosened fund investment limits; Taiex +3.3%.

**Event 2: TSMC Q1 2026 Earnings Beat** (4 items)
Cross-sources: MSN, CNBC, timothysykes.com
Claim: Q1 print topped estimates on strong AI chip demand.

**Event 3: TSMC A13 Technology Unveil** (2 items)
Cross-sources: timothysykes.com, Yahoo Finance
Context: 2026 North America Technology Symposium.

**Event 4: TSMC Arizona $20B Capital Increase** (2 items)
Cross-sources: Stock Titan, TipRanks
Date: May 12 2026.

**Event 5: TSMC Board Greenlights Q1 Dividend + $31B Capacity Expansion** (2 items)
Cross-sources: TipRanks, The Globe and Mail
Date: May 12-13 2026.

**Event 6: Taiwan Stock Market Overtakes India (TSMC-driven)** (2 items)
Cross-sources: Seeking Alpha, Benzinga
Date: May 26 2026.

**Event 7: TSMC 3nm Node Price Hike 15% H2 2026** (2 items)
Cross-sources: Seeking Alpha, Investor's Business Daily
Date: May 27 2026. Potentially more in 2027 per Seeking Alpha.

**Event 8: TSMC 52-Week High Late May 2026** (3 items)
Cross-sources: Benzinga, 24/7 Wall St.
Date: May 27-29 2026.

**Event 9: TSMC-Nvidia Partnership — Stock Surges Jun 1 2026** (3 items)
Cross-sources: TipRanks, Investing.com, Benzinga
Claim: TSMC soars on teaming up with Nvidia to bring more AI into chipmaking.

**Event 10: TSMC CEO — Sustained AI Chip Demand Guidance** (2 items)
Cross-sources: Investor's Business Daily, Stocktwits
Date: Jun 4 2026. Note: IBD says "forecasts sustained demand"; Stocktwits headline says "CEO says AI chip shortage isn't ending anytime soon" — consistent directional claim across two independent sources. CEO quote not verbatim in feed (rawExcerpt empty for both items); quote fidelity cannot be confirmed.

---

## Single-Source Items (verified=false, validatorNote set) — 4 items

| id | ticker | reason |
|---|---|---|
| 2026-04-27-soxl-michael-burry-says-sox-will-return-to-earth... | SOXL | Stocktwits-only; specific claim of $330 SOX puts not corroborated in feed |
| 2026-04-29-soxl-michael-burry-says-sox-will-return-to-earth... | SOXL | Duplicate Stocktwits item (same publisher as above) |
| 2026-05-06-tsm-tsmc-stock-rallies-56-billion-ai-expansion... | TSM | Benzinga-only; $56B AI expansion figure not cross-confirmed in feed |
| 2026-06-05-tsm-tsmc-shareholders-approve-2025-results... | TSM | Globe and Mail only; no independent corroboration |

Note on Burry: The specific claim (Michael Burry $330 puts on SOX/SOXL) appears only in Stocktwits. However, the broader thesis that SOXL carries leverage-decay and volatility risk IS independently verified across Seeking Alpha, Yahoo Finance, and Stock Traders Daily (Event 1 above).

---

## Price Verification: Single-Source Limitation Warning

SOXL price $181.46 and TSMU price $70.40 (from price-quotes.json) have sourceCount=1 (Nasdaq only). No independent price confirmation exists in the feed. These prices cannot be verified to the 0.2% tolerance. Evaluator must treat them as indicative, not confirmed. Do not use as precise valuation anchors without an independent price check.

---

## Unclassified False Items (127 items, verified=false, no note)

These are thesis-adjacent items (analyst commentary, institutional trades, sector pieces) that were not part of a named event cluster with >=2 sources. They remain verified=false. The majority are TSM commentary articles (107 items) that are broadly consistent with verified events but do not independently corroborate a specific claim. They are not noise but cannot be promoted without a corresponding cross-source match.

---

## Top 5 Verified Events for Evaluator

These are the highest-confidence anchors for a SOXL/TSMU re-evaluation:

1. **TSM Q1 2026 Earnings Beat** — AI demand strong, tops estimates (MSN + CNBC + timothysykes.com); directly supports TSMU underlying asset strength.
2. **TSM 3nm Price Hike 15% H2 2026** — Pricing power confirmed (Seeking Alpha + IBD); supports margin expansion thesis for TSM and by extension TSMU NAV.
3. **TSMC-Nvidia Partnership Jun 1 2026** — Stock catalyst confirmed (TipRanks + Investing.com + Benzinga); short-term TSM price appreciation verified.
4. **SOXL YTD Rally (2026)** — 320-450% YTD figure directionally confirmed across 3 sources; validates SOXL bull-run but also raises leverage-decay risk at elevated price level.
5. **SOXL Leverage-Decay / Volatility Risk** — Persistent multi-source warning (Seeking Alpha + Yahoo Finance + Stock Traders Daily, spanning 2025-2026); material for risk score, especially at post-rally valuations. SOXL lost 90% in 2022 while SOX fell 35% — leverage amplification confirmed.

---

## Files Modified

- `/home/user/Traiding-Dashboard/data/news-feed.json` — verified/validatorNote fields updated for 79 target items; top-level `updated` and `agent` fields set.
- `/home/user/Traiding-Dashboard/reports/validation/2026-06-07-soxl-tsmu-check.md` — this file.

