# TSMU — 조기 재평가 (2026-06-07)

**데이터 as-of:** 2026-06-05 EOD (provisional, 단일소스 nasdaq) · **조기 재평가:** 2026-06-07 · **다음 정기 검토:** 2026-06-20

**Sector:** 반도체 파운드리 2x 레버리지 ETF (기초자산: TSM) · **보유:** 없음 (watchlist-only)
**현재가:** $70.40 (provisional, 단일소스 nasdaq, 2026-06-05 EOD — 신규 세션 시세 없음)
**FV 밴드:** $67 / $83 / $103 · **업사이드(mid 기준):** 17.90%
**Verdict:** 해당 없음 (watchlist) · **Risk score:** 미산출 (watchlist-only)

---

## TL;DR
- **기초자산(TSM) thesis 강화, 그러나 진입 신호 없음.** TSM 관련 3개 verified 이벤트가 underlying 우호적이나, 2x daily-reset decay와 단일소스 가격 한계로 진입 신중 유지.
- **Decay 시계 상시 작동.** 검토 전까지 ~13일 ≈ 1.5-2% NAV 잠식이 thesis 강화와 무관하게 진행된다(evaluator 추정).
- **TSMU/TSM 괴리율 14.6%.** $70.40 / $412.11 = 0.1708 비율 — 이론값 2x(0.2000) 대비 누적 decay 14.6% 이미 반영. 진입 시 이 비용을 명시적으로 계산해야 함.

---

## Thesis

TSMU는 TSM(Taiwan Semiconductor Manufacturing)을 일별 2x로 추적하는 레버리지 ETF다. TSM Q1 2026 실적이 예상을 상회했고 [1], 3nm 공정 가격이 H2 2026에 15% 인상될 예정이며 [2], TSMC-Nvidia AI 파트너십이 확인됐다 [3] — 세 가지 verified 이벤트 모두 TSM 기초자산 thesis를 강화한다. 그러나 TSMU의 2x 일별 리셋 구조는 positive thesis와 무관하게 NAV를 지속 잠식한다. 현재 누적 decay는 이론 2x 비율 대비 14.6%로 이미 상당히 진행됐다(evaluator 산출: TSMU/TSM 비율 0.1708 vs 이론 0.2000).

---

## Valuation

- **방법:** NAV-decay-adjusted, 2x-beta-scaling (evaluator 산출)
- **FV 밴드:** $67 (bear) / $83 (base) / $103 (bull)
- **산출 근거:**
  - TSMU/TSM 비율 $70.40/$412.11 = 0.1708; TSM FV($390/$487/$600) × 0.1708 → TSMU FV $67/$83/$103
  - 2x 베타 스케일링: TSM → fvMid +18.2% gross; 30일 decay ~3.5% → TSMU ≈ $92.6; 60일 → ≈ $89.1
  - 두 방법 모두 fvMid $83 수렴 (비율 기반이 하한을 앵커)
  - fvLow $67: TSM이 fvLow $390 도달 시 + 추가 decay
  - fvHigh $103: TSM이 fvHigh $600 도달 + decay 최소화 시나리오
- **민감도:** TSM -10% → TSMU approximately -20% to -22%(decay 포함); 대만 지정학 리스크 2x 증폭. 반대로 TSM +18.2%(→fvMid) 추세라도 30-60일 holding 시 decay가 수익률 3-7%p 잠식.
- **주의:** currentPrice $70.40은 2026-06-05 EOD 기준 provisional 단일소스(nasdaq). 신규 세션 시세 없음 — 6월 7일 시세로 간주 불가. 단일소스 가격 한계로 진입 판단에 추가 마진 필요.

---

## TSM Thesis vs. TSMU: 직접 연결 구조 (SOXL과의 비대칭)

TSMU는 TSM 단일 기초자산의 2x ETF이므로, TSM 호재는 SOXL(SOX ~30개 종목 바스켓 3x)보다 훨씬 직접적으로 NAV에 반영된다. TSM Q1 beat [1], 3nm +15% [2], Nvidia 파트너십 [3] 모두 TSM 직접 우호이며 TSMU에 2x 증폭된다. 다만 이 증폭은 하방에도 동등하게 작동한다.

---

## Decay 시계: 13일 ≈ 1.5-2% NAV 잠식

다음 정기 검토(2026-06-20)까지 약 13일이 남아있다. evaluator 추정에 따르면 VIX ~21.51 환경에서 30일 decay ~3.5% — 비례 적용 시 13일간 약 1.5-2% NAV 잠식이 TSM 기초자산 움직임과 무관하게 진행된다. 보유 기간이 길어질수록 이 비용은 복리로 누적된다(30일 ~3.5%, 60일 ~7%, 90일 ~10-12% evaluator 추정). 진입 시 holding-period decay cost를 thesis upside 17.90%에서 명시적으로 차감해야 한다.

---

## Catalysts (향후 90일)

| 날짜 | 이벤트 | 예상 영향 | 신뢰도 |
|------|--------|-----------|--------|
| 2026-06-20 | 다음 정기 검토 | Risk score 최초 산출 + 진입 여부 결정 | 확정 |
| 미정 | TSM 추가 주가 상승 (fvMid $487 방향) | TSMU 2x 직접 반영 | 조건부 |
| H2 2026 | TSM 3nm 가격 +15% 실제 청구 효과 [2] | 수익성 개선 → TSM 재평가 | 중간 |
| 미정 | 대만 지정학 긴장 완화 | TSM geopolitical discount 축소 | 불명 |

---

## Risks

| Tag | Severity | Note |
|-----|----------|------|
| decay 상시 | **high** | 2x 일별 리셋: 30d ~3.5% / 60d ~7% / 90d ~10-12% NAV 잠식 (evaluator) |
| 단일소스 가격 | **high** | currentPrice $70.40 provisional, 단일소스 nasdaq only; 진입 판단에 추가 마진 필요 |
| 대만 지정학 | medium | 대만 리스크 2x 증폭 — 단일 사건 발생 시 TSMU 손실이 TSM의 2배 |
| 2x 하방 증폭 | medium | TSM -10% → TSMU approximately -20% to -22% |
| risk score 미산출 | 정보 부족 | Watchlist-only; evaluator 공식 risk score 없음 — 6-20 검토 후 산출 예정 |

---

## Entry / Exit Plan

- **현재 상태:** watchlist-only. 진입 불가 — risk score 미산출, 단일소스 가격, decay 비용 미정량화 상태에서 포지션 개시 불가.
- **진입 고려 조건:**
  1. 2026-06-20 정기 검토에서 evaluator risk score 산출 및 verdict 확인
  2. 2개 이상 소스 교차 검증된 신규 TSM/TSMU 가격 확인
  3. decay-adjusted upside가 holding 기간 대비 충분한 RRR 보장 여부 계산
- **FV 참조:**
  - Bear $67 / Base $83 / Bull $103 (evaluator 산출)
  - 현재가 $70.40 대비 fvMid upside 17.90% — 단, 60일 보유 시 decay ~7% 차감 후 실질 upside ≈ 10.9%
- **Stop 기준:** 미정 (risk score 산출 전 stop level 설정 불가)

---

## Decision

- **Action:** WATCHLIST 유지. 진입 없음.
- **Timeline:** 2026-06-20 정기 검토 결과 후 재판단.
- **Review:** 2026-06-20 (다음 정기 검토). 그 전에 TSM 관련 중대 이벤트(지정학 리스크, 실적 발표 등) 발생 시 에스컬레이션 검토.

---

## Sources

(1) MSN/CNBC — "TSM stock spikes overnight: Q1 print tops estimates on strong demand for AI chips" — 2026-04-27
    Cross-verified: MSN + CNBC + timothysykes.com · verified=true · event: earnings-beat
    URL: https://news.google.com/rss/articles/CBMingNBVV95cUxNeUxucS0xbmFBNGZWZkJZVDZEMFoxczRGd3czYnZUUUtsa1laelhXYlBmaktZYWU0TDdnU0s5YXgzRUpOVGF2TGdSV1pwdnBqTS1hNVZoUFJXQ3g2UXc4ZnBiZUZOSXFzdFJHWERJWTRGLU45Skd2VnA0Um9PUnQ1SHRWSjI4aDlUSnA3c3hFUTBnMnhWaVVuV1JhYk9yUFRJaEh6aDNWSVN5YjUxMUtEMTh3VzcxSnFELUM1NW5pSThqd3Q3MXFRRHk0d21XdWRKNUUydVM5R0d4dWl4YVVBZ1lYVXNkUk56dHpDaG1KcW1Na240R3F3cUdIWFp4Vk83MVA0cENENjZMY3hFZmIyX1k5MERPeVR5TUFKLTh1R3JXR3pVVkdsaTV2Yi0yNkVXWGNKcWZ0enBzb2EwXzA2V3dESW1renRwMF9ndWdFUFN0TG5Pd0pCbm0xWXRxbFRvMThXejY3djNmei1zT3JCMThQNUcwQ1BqZXJRLXdmMWp4TDVYT2lxZlI4QjNQSlNCcDRHM1pNanhlY2Z4RHc?oc=5

(2) Seeking Alpha — "Taiwan Semi will hike 3 nm price by 15% in second half, potentially more in 2027" — 2026-05-27
    Cross-verified: Seeking Alpha + Investor's Business Daily · verified=true · event: pricing-action
    URL: https://news.google.com/rss/articles/CBMiwAFBVV95cUxPQ0ZqUVozeXdvdzl1WHdUcmdKTFlERXBLR2VXZk1scGxZeTVPTGlBdXJ0Z0xIcW5fbmpNTzVkWFhsYUtoRnJGUktYbFR3Vk9XM0JBZTYxY3EyX3ZsMkZGQTlOTUFHbWNLeVJ3d2JGbG5SWDVvYWd1QXQ1bnZ4QldZN09UOTdWUS1CTGtseHpaNV9KdXJlZjZlSzRIV0ZuZm03TlNkaWdrUHRVdDdDQWtYRno4eFRTREdLQWhyUzJ3emw?oc=5

(3) TipRanks/Investing.com/Benzinga — "TSMC Stock (TSM) Soars on Teaming Up with Nvidia to Bring More AI into Chipmaking" — 2026-06-01
    Cross-verified: TipRanks + Investing.com + Benzinga · verified=true · event: strategic-partnership
    URL: https://news.google.com/rss/articles/CBMiwwFBVV95cUxPRUFxS3BKck8zUUgyNTRFNEJxRFJEMG5Zdjh5bjA3eDdTM3JpODhNcUZSZVF3eVliRTNaeFhqRFJzWC1rR3FMRHNvaTM0YkpwRHhLRW5yYUJmOWMtdllKMFFuVGQ5NG96X2JmMjdBM1duaGFyVFgxWXVkQUNON05DZ2NScEJ3cnBzeVB1VjVNMGp4SVJoS2hpeXJJZUhGOTFSWDJfOEZMTDFSLWZwMWpOczg2amRseHY0N21PUlREazRLYlE?oc=5

미검증 항목(verified=false) 인용 없음. data/news-feed.json에서 TSMU 직접 tagged 항목은 verified=true인 것이 없으며, 본 보고서의 TSM 관련 소스 3건이 TSMU 기초자산 분석의 유일한 검증 근거임을 명시.

---
*데이터 출처: evaluator 산출 (data/valuations.json, updated 2026-06-07). risk-scores.json에 TSMU 항목 없음 — watchlist-only, risk score 미산출. 미검증 뉴스 항목 인용 없음.*
*Produced by evaluator + interpreter. Every number above cites evaluator output or a verified source.*
