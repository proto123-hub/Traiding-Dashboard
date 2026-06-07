# SOXL — 조기 재평가 (2026-06-07)

**데이터 as-of:** 2026-06-05 EOD (provisional, 단일소스 nasdaq) · **조기 재평가:** 2026-06-07 · **다음 정기 검토:** 2026-06-21

**Sector:** 반도체 3x 레버리지 ETF (SOX 바스켓) · **보유:** 5주 @ $132.21 평단 (북 비중 약 0.4%)
**현재가:** $181.46 (provisional, 단일소스 nasdaq, 2026-06-05 EOD — 신규 세션 시세 없음)
**FV 밴드:** $170 / $240 / $310 · **업사이드(mid 기준):** 32.27%
**Verdict:** TRIM · **Risk score:** 31 (medium 하단)

---

## TL;DR
- **TRIM 유지.** 6월 7일 조기 재평가에서도 신규 검증 가격 없이 score 31, TRIM 판정 변경 없음.
- **Stop-proximity 임계.** $181.46 vs 하드스탑 $170 — 버퍼 6.7%. 단일 -7% 세션으로 스탑 도달 가능하며, 6-21 정기 검토 전 새 시세 확인 시 즉시 에스컬레이션 검토 필요.
- **레버리지 decay 다중-소스 재확인.** 4개 verified 이벤트가 3x 일별 리셋 decay 위험을 독립적으로 재확인; 하방 비대칭이 TRIM 판정의 핵심 근거.

---

## Thesis

SOXL은 SOX 지수를 일별 3x로 추적하는 레버리지 ETF다. 보유 목적은 SOX 섹터 상승 국면에서의 단기 수익 극대화이나, 일별 리셋 구조 특성상 횡보·변동성 장세에서 NAV가 지속 잠식된다. 2026-06-05 -17.24% 단일 세션 급락이 3x 증폭 메커니즘을 실증했다 [5]. VIX ~16 수준에서 monthly decay 추정치는 5-8%(evaluator). 기초지수 SOX는 약 30개 종목으로 구성되며, TSM 관련 호재는 SOXL에 간접·희석 형태로만 영향을 미친다(상세: Watchlist 비대칭 항목 참조).

---

## Valuation

- **방법:** NAV-decay-adjusted, 3x-beta-scaling (evaluator 산출)
- **FV 밴드:** $170 (bear) / $240 (base) / $310 (bull)
- **산출 근거:** SOX FV ~$5,700-$6,000 기준, daily-reset decay(VIX ~16, ~5-8%/30d) 적용 후 $230-$280 NAV; decay 조정 mid = $240. 3x 베타 스케일링 보조 확인. 현재가 $181.46은 fvLow $170 대비 6.7% 상단 — FV 밴드 내 bear zone 접근.
- **민감도:** VIX가 20+ 구간으로 상승하면 decay 가속, fvMid 추가 하락 압력. SOX +10% 회복 시 SOXL이론 +30%; 그러나 동등 규모 하락(-10%)이면 스탑(하드$170) 이하로 붕괴.
- **주의:** currentPrice $181.46은 2026-06-05 EOD 기준 provisional 단일소스(nasdaq). 2026-06-07 시점에 신규 검증 가격 없음 — 이 값을 6월 7일 시세로 간주해서는 안 됨.

---

## Catalysts (향후 90일)

| 날짜 | 이벤트 | 예상 영향 | 신뢰도 |
|------|--------|-----------|--------|
| 2026-06-21 | 다음 정기 검토 | 신규 시세 확인 후 TRIM 규모 결정 | 확정 |
| 미정 | SOX 섹터 risk-on 회복 / NDX 반등 | NAV 회복, 스탑 버퍼 확대 | 조건부 |
| 미정 | TSM-Nvidia AI 파트너십 SOX 파급 (간접) [8] | SOX 바스켓 우호, 단일 종목 효과 희석 | 낮음 |
| 미정 | VIX 재상승 / 매크로 충격 | Decay 가속 + 3x 하방 증폭 | 불명 |

---

## Stop-Proximity 시계

현재가 $181.46(provisional) 대비 하드스탑 $170: **버퍼 $11.46 = 6.7%.**
단일 세션 -7%이면 스탑 레벨 도달이다. 2022년 SOX -35% 사이클에서 SOXL은 -90%를 기록했다 — 3x 증폭의 실증 선례 [1][2][4]. 2026-06-05에만 -17.24%가 발생했고 [5], 신규 검증 가격 없이 6-21 리뷰까지 14일 이상 경과한다. 이 기간 중 새 시세가 $175 이하로 확인되면 즉시 에스컬레이션 검토 — 정기 리뷰를 기다리지 않음.

---

## TSM thesis vs. SOXL: 비대칭 희석 구조

TSM Q1 실적 beat [6], 3nm 가격 +15% H2 2026 [7], TSMC-Nvidia AI 파트너십 [8] — 세 가지 verified 이벤트 모두 TSM 단독 기초자산에 직접 우호적이다. 그러나 SOXL은 SOX ~30개 종목 바스켓을 3x로 추적하는 구조이므로, TSM 단독 주가 상승이 SOXL NAV에 미치는 영향은 1/30 수준의 간접·희석 효과에 불과하다. 이 비대칭을 TSM 단독 보유 또는 TSMU(2x TSM)와 혼동해서는 안 된다.

---

## Risks

| Tag | Severity | Note |
|-----|----------|------|
| stop-proximity | **critical** | $181.46 vs $170 스탑 — 버퍼 6.7%; 신규 검증 가격 없음 |
| leveraged-etf decay | **high** | 3x 일별 리셋: VIX~16에서 ~5-8%/30d NAV 잠식. 4개 verified 소스 재확인 [1][2][3][4] |
| technical | **high** | 2026-06-05 단일 세션 -17.24% [5]; 신규 세션 재평가 없음 |
| macro / sector | medium | SOX 섹터 tariff/export ban 위험; NDX 매크로 리스크 |

---

## Entry / Exit Plan

- **Entry zone:** $185–$210 — 스탑 버퍼가 회복되고 decay 비용이 상쇄될 수 있는 구간 (현재가는 entry zone 하단 근접, TRIM 판정 하에서 신규 매수 불가)
- **Target base:** $270 — SOX 섹터 정상화 시나리오
- **Target bull:** $310 — SOX 강세 + VIX 안정 + decay 최소화
- **Target bear:** $155 — SOX 추가 하락 시 decay 중첩 손실
- **Stop-loss:** $170 (하드 스탑) — thesis invalidation; 스탑 하향 조정 불가
- **RRR:** 7.73 (evaluator 산출)

---

## Decision

- **Action:** TRIM (2026-06-05 최초 기록; 2026-06-07 조기 재평가에서 유지)
- **Timeline:** 신규 검증 가격 확인 후 규모 결정; $175 이하 확인 시 즉시 에스컬레이션
- **Review:** 다음 정기 검토 2026-06-21. 단, 그 전에 새 시세가 $175 이하로 확인되면 즉시 재검토.

---

## Sources

(1) Seeking Alpha — "SOXL: Levered Semis Are A Risky Bet As Volatility Rises" — 2026-03-16
    Cross-verified: Seeking Alpha + Yahoo Finance + Stock Traders Daily · verified=true
    URL: https://news.google.com/rss/articles/CBMimwFBVV95cUxPOTdYVTU5Q1JzUmVpcVFjTlBaTzlidmw3dE81T1RRanRsd3NUbkZlYmt5N2tRSFVmR1BWQlVtSUlDV1V5ZVFKU2pKTU1QTzVEZEFQZkdVMElzZ01hVzh5RnAybDlTSVdjM3JtNFlGZ3NQNkhPOGd1VGVaVUU5QWpmUXdicU1xeVBpNUgwV0F2Qm5PWWhHUUhPcElKZw?oc=5

(2) Yahoo Finance — "SOXL: Evaluating the Valuation Case After Recent Volatility" — 2025-09-24
    Cross-verified: Seeking Alpha + Yahoo Finance + Stock Traders Daily · verified=true
    URL: https://news.google.com/rss/articles/CBMiiwFBVV95cUxPMGNmMmFLTDBOVzNCdlNUejhIZm9QLW0yNEp6UXNLdGxBVU56Y1BkTDZSQW9BRjlHQkR4cGF5Wk80TzdCZHhxZ3VOclZ3MFM5X1Nqam1uUGgwRE5QNkJtVnBkQ0hrR2liVk5CR3NYQUpkeDl5ZW5xd2pmR2VEendLSkNseV9nN0FQNTNr?oc=5

(3) Yahoo Finance — "Big Returns and Big Risk: See How SOXL and SSO Measure Up" — 2025-12-01
    Cross-verified: Seeking Alpha + Yahoo Finance + Stock Traders Daily · verified=true
    URL: https://news.google.com/rss/articles/CBMiekFVX3lxTE9CLTloZnZmeVpYVHNXNWttR0Y0OTZjRXNPblM0R3g1anlPNkRNV0hSbklxM1diTGkzVV85YWlnSXUxSDJaN3JtZG1aNXN2eXFNTUhrQUx4ZDRPRGtjMU9ib0FHRlhwUFhLRV9RRGZrZGgyNFlTeFpjUlVR?oc=5

(4) Stock Traders Daily — "Understanding the Setup: SOXL and Scalable Risk" — 2026-04-19
    Cross-verified: Seeking Alpha + Yahoo Finance + Stock Traders Daily · verified=true
    URL: https://news.google.com/rss/articles/CBMixAFBVV95cUxNbVlwd2d2OVdjeTcxYThXbzA3MG43SkVOSGxnWWF3YXp0Q3JkY2FyMWhZREVudmx3UDlPUEs0dE4wLThSTGZTUll1MXpZSGdOclJJdHJha2RMY0FMSTJoQTRQSk9mOVNfY0tKLV9KZUxzY3dxcVVCdWdkbGtkeDBJTE45cW11LURteXVoV3FJMjNfcTR0REp2RHp0dmVlQi00bzVrUGFBS0c3ZkZGYWp2ZEhxTkJRUEl6VEhKS05ZVWFFVEVQ?oc=5

(5) eciks.org — "SOXL stock surges over 320% year-to-date on AI chip rally" — 2026-06-05
    Cross-verified: Benzinga + 24/7 Wall St. + eciks.org · verified=true (방향성 참조만; 정확한 YTD % 단일소스 미확정)
    URL: https://news.google.com/rss/articles/CBMibEFVX3lxTE9yejd3NWVCUnl0ZG5scURxR0hBSHF1SmVnTmN1SS1lTFR2UXNOaDUtbUVSRy1udlFhd1dGcVAycGdkVDhJZnJfTDR2aTNIcWJYcnNRRFl0M3VqQnc3VVRlSUlZdGZoR3ZvUm1Xeg?oc=5

(6) MSN/CNBC — "TSM stock spikes overnight: Q1 print tops estimates on strong demand for AI chips" — 2026-04-27
    Cross-verified: MSN + CNBC + timothysykes.com · verified=true (SOXL SOX 바스켓 간접 참조)
    URL: https://news.google.com/rss/articles/CBMingNBVV95cUxNeUxucS0xbmFBNGZWZkJZVDZEMFoxczRGd3czYnZUUUtsa1laelhXYlBmaktZYWU0TDdnU0s5YXgzRUpOVGF2TGdSV1pwdnBqTS1hNVZoUFJXQ3g2UXc4ZnBiZUZOSXFzdFJHWERJWTRGLU45Skd2VnA0Um9PUnQ1SHRWSjI4aDlUSnA3c3hFUTBnMnhWaVVuV1JhYk9yUFRJaEh6aDNWSVN5YjUxMUtEMTh3VzcxSnFELUM1NW5pSThqd3Q3MXFRRHk0d21XdWRKNUUydVM5R0d4dWl4YVVBZ1lYVXNkUk56dHpDaG1KcW1Na240R3F3cUdIWFp4Vk83MVA0cENENjZMY3hFZmIyX1k5MERPeVR5TUFKLTh1R3JXR3pVVkdsaTV2Yi0yNkVXWGNKcWZ0enBzb2EwXzA2V3dESW1renRwMF9ndWdFUFN0TG5Pd0pCbm0xWXRxbFRvMThXejY3djNmei1zT3JCMThQNUcwQ1BqZXJRLXdmMWp4TDVYT2lxZlI4QjNQSlNCcDRHM1pNanhlY2Z4RHc?oc=5

(7) Seeking Alpha — "Taiwan Semi will hike 3 nm price by 15% in second half" — 2026-05-27
    Cross-verified: Seeking Alpha + Investor's Business Daily · verified=true (SOXL SOX 바스켓 간접 참조)
    URL: https://news.google.com/rss/articles/CBMiwAFBVV95cUxPQ0ZqUVozeXdvdzl1WHdUcmdKTFlERXBLR2VXZk1scGxZeTVPTGlBdXJ0Z0xIcW5fbmpNTzVkWFhsYUtoRnJGUktYbFR3Vk9XM0JBZTYxY3EyX3ZsMkZGQTlOTUFHbWNLeVJ3d2JGbG5SWDVvYWd1QXQ1bnZ4QldZN09UOTdWUS1CTGtseHpaNV9KdXJlZjZlSzRIV0ZuZm03TlNkaWdrUHRVdDdDQWtYRno4eFRTREdLQWhyUzJ3emw?oc=5

(8) TipRanks/Investing.com/Benzinga — "TSMC Stock (TSM) Soars on Teaming Up with Nvidia to Bring More AI into Chipmaking" — 2026-06-01
    Cross-verified: TipRanks + Investing.com + Benzinga · verified=true · event: strategic-partnership (SOXL SOX 바스켓 간접 참조)
    URL: https://news.google.com/rss/articles/CBMiwwFBVV95cUxPRUFxS3BKck8zUUgyNTRFNEJxRFJEMG5Zdjh5bjA3eDdTM3JpODhNcUZSZVF3eVliRTNaeFhqRFJzWC1rR3FMRHNvaTM0YkpwRHhLRW5yYUJmOWMtdllKMFFuVGQ5NG96X2JmMjdBM1duaGFyVFgxWXVkQUNON05DZ2NScEJ3cnBzeVB1VjVNMGp4SVJoS2hpeXJJZUhGOTFSWDJfOEZMTDFSLWZwMWpOczg2amRseHY0N21PUlREazRLYlE?oc=5

---
*데이터 출처: evaluator 산출 (data/valuations.json + data/risk-scores.json, updated 2026-06-07). 미검증 뉴스 항목 인용 없음.*
*Produced by evaluator + interpreter. Every number above cites evaluator output or a verified source.*
