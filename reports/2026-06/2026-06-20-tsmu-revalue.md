# TSMU — 최초 Risk 프로파일 산출 + 진입 판단 (정기 검토 2026-06-20)

**데이터 as-of:** 2026-06-05 EOD (provisional, 단일소스 nasdaq — 신규 세션 시세 없음)
**검토 기준일:** 2026-06-20 (nextReview 도달 — 정기 검토)
**작성일:** 2026-06-07 (데이터·검토 기준일이 작성일 이후임에 유의)
**다음 정기 검토:** 2026-07-04

**Sector:** 반도체 파운드리 2x 레버리지 ETF (기초자산: TSM) · **보유:** 없음 (watchlist-only)
**현재가:** $70.40 (provisional, 단일소스 nasdaq, 2026-06-05 EOD)
**FV 밴드:** $67 / $83 / $103 · **업사이드(mid 기준):** 17.90%
**Risk score:** 23 (low) · **Verdict:** WATCHLIST 유지 — 진입 보류

---

## TL;DR

- **최초 risk 프로파일 산출 완료.** Score 23 (low; leveraged-ETF +15, sector-macro +8). 이 리포트가 TSMU entryZone / stop / target / RRR의 공식 최초 기재처다.
- **RRR 1.22는 진입 기준 미달.** decay-adjusted RRR (77 − 70.40) ÷ (70.40 − 65.00) = 1.22 — SOXL RRR 7.73, 일반 기준 ≥2.0 대비 현저히 낮다. 안전하지만 보상이 빈약한 구조.
- **2-source 가격 미충족 + RRR 빈약 → 진입 보류.** 두 선결조건이 모두 미충족 상태. 2-source 교차 가격 확보 및 RRR 개선 시 재평가한다.

---

## Thesis (배경)

2026-06-07 리포트(PR #15)에 상세 기술됐으므로 핵심만 인용한다. TSM Q1 2026 실적이 예상을 상회했고 [1], 3nm 공정 가격이 H2 2026에 +15% 인상될 예정이며 [2], TSMC-Nvidia AI 파트너십이 확인됐다 [3] — 세 이벤트 모두 TSM 기초자산 thesis를 강화한다. TSMU는 TSM 단일 기초자산의 2x ETF이므로 이 우호는 SOXL(SOX 바스켓 3x) 대비 훨씬 직접적으로 NAV에 반영된다. 단, 2x daily-reset decay는 positive thesis와 무관하게 상시 작동한다.

TSMU 직접 tagged verified 뉴스 항목은 없음. 위 TSM 3건이 기초자산 분석의 유일한 검증 근거다.

---

## Risk Profile — 최초 산출 (2026-06-20)

| 항목 | 값 | 비고 |
|------|----|------|
| Score | **23** (low) | leveraged-ETF +15, sector-macro +8 |
| 산출 방법 | evaluator 정기 검토 | risk-scores.json 미등재 — valuations.json rationale 기재 |

**낮은 score(23)의 의미:** low score는 매수 신호가 아니다. 이 score는 현재 조건에서 포지션 리스크 수준이 상대적으로 낮다는 의미이며, 진입 매력과 별개다. RRR 1.22가 진입 비매력의 핵심 정량 근거다.

**Risk 항목:**

| Tag | Severity | Note |
|-----|----------|------|
| decay 상시 | **high** | 2x daily-reset: 60d decay ~7%, target.base에 이미 반영($83 × 0.93 = $77) |
| 2-source 미충족 | **high** | currentPrice $70.40 단일소스(nasdaq) provisional — 진입 선결조건 (2) 미충족 |
| 2x 하방 증폭 | medium | TSM -10% → TSMU approximately -20~22%(decay 포함) |
| 대만 지정학 | medium | 대만 리스크 2x 증폭 [1][2][3] 기초자산 직접 노출 |

---

## Valuation (FV 밴드 무변경)

FV 밴드 $67 / $83 / $103은 2026-06-07 산출값에서 무변경이다. 근거: 새로운 DCF/EV 정량 입력값 없음 — 뉴스 확인만으로는 밴드 수정 불가 (evaluator 정책). TSM FV $390/$487/$600 역시 무변경.

- **산출 구조:** TSM FV × TSMU/TSM 비율 0.1708 (= $70.40 ÷ $412.11) → TSMU FV $67 / $83 / $103
- **현재가 위치:** $70.40은 fvLow($67) 바로 위, entryZone($67–$72) 내에 위치
- **upsideMidPct:** 17.90% (단, 60일 보유 시 decay ~7% 차감 후 실질 ≈ 10.9%)

---

## Entry / Exit Plan — 공식 최초 기재

| 항목 | 값 | 산출 근거 |
|------|----|-----------|
| Entry zone | $67 – $72 | evaluator 산출 |
| Stop-loss | **$65.00** | TSM fvLow $390 × 비율 0.1708 = $66.61 → 노이즈 버퍼 하향 |
| Target base | **$77** | fvMid $83 × 60d-decay 0.93 |
| Target bull | **$99** | fvHigh $103 × 30d-decay 0.965 |
| Target bear | **$60** | fvLow $67 × 90d-decay 0.90 |
| **RRR** | **1.22** | (77 − 70.40) ÷ (70.40 − 65.00); target이 decay 반영이므로 decay-adjusted RRR 동일 |

**RRR 1.22 해석:** 일반 진입 기준 ≥2.0, SOXL RRR 7.73 대비 현저히 미달. 잠재 수익($6.60) 대비 잠재 손실($5.40)의 비율이 빈약하다. "안전하지만 보상이 빈약" — 리스크 profile이 양호해도 리워드 구조가 진입을 정당화하지 못한다.

---

## Decision — 진입 Go/No-Go

**판정: NO-GO — WATCHLIST 유지, 진입 보류**

| 선결조건 | 현황 |
|----------|------|
| (1) Risk score 산출 | **완료** (score 23) |
| (2) 2-source 교차검증 가격 | **미충족** (단일소스 nasdaq provisional) |
| (3) decay-adjusted RRR | **완료이나 빈약** (1.22, 기준 ≥2.0 미달) |

진입 가능 조건:
- 2-source 이상 교차검증된 TSM/TSMU 신규 가격 확보
- RRR 개선: TSM이 fvMid 방향으로 추가 상승하거나 TSMU가 entryZone 하단($67 부근)으로 조정될 경우 RRR 재산출 필요
- 두 조건 동시 충족 시 2026-07-04 정기 검토에서 재판단

**다음 정기 검토:** 2026-07-04

---

## Sources

(1) MSN — "TSM stock spikes overnight: Q1 print tops estimates on strong demand for AI chips" — 2026-04-27
    Cross-verified: MSN + CNBC + timothysykes.com · verified=true · eventType: earnings-beat
    URL: https://news.google.com/rss/articles/CBMingNBVV95cUxNeUxucS0xbmFBNGZWZkJZVDZEMFoxczRGd3czYnZUUUtsa1laelhXYlBmaktZYWU0TDdnU0s5YXgzRUpOVGF2TGdSV1pwdnBqTS1hNVZoUFJXQ3g2UXc4ZnBiZUZOSXFzdFJHWERJWTRGLU45Skd2VnA0Um9PUnQ1SHRWSjI4aDlUSnA3c3hFUTBnMnhWaVVuV1JhYk9yUFRJaEh6aDNWSVN5YjUxMUtEMTh3VzcxSnFELUM1NW5pSThqd3Q3MXFRRHk0d21XdWRKNUUydVM5R0d4dWl4YVVBZ1lYVXNkUk56dHpDaG1KcW1Na240R3F3cUdIWFp4Vk83MVA0cENENjZMY3hFZmIyX1k5MERPeVR5TUFKLTh1R3JXR3pVVkdsaTV2Yi0yNkVXWGNKcWZ0enBzb2EwXzA2V3dESW1renRwMF9ndWdFUFN0TG5Pd0pCbm0xWXRxbFRvMThXejY3djNmei1zT3JCMThQNUcwQ1BqZXJRLXdmMWp4TDVYT2lxZlI4QjNQSlNCcDRHM1pNanhlY2Z4RHc?oc=5

(2) Seeking Alpha — "Taiwan Semi will hike 3 nm price by 15% in second half, potentially more in 2027" — 2026-05-27
    Cross-verified: Seeking Alpha + Investor's Business Daily · verified=true · eventType: pricing-action
    URL: https://news.google.com/rss/articles/CBMiwAFBVV95cUxPQ0ZqUVozeXdvdzl1WHdUcmdKTFlERXBLR2VXZk1scGxZeTVPTGlBdXJ0Z0xIcW5fbmpNTzVkWFhsYUtoRnJGUktYbFR3Vk9XM0JBZTYxY3EyX3ZsMkZGQTlOTUFHbWNLeVJ3d2JGbG5SWDVvYWd1QXQ1bnZ4QldZN09UOTdWUS1CTGtseHpaNV9KdXJlZjZlSzRIV0ZuZm03TlNkaWdrUHRVdDdDQWtYRno4eFRTREdLQWhyUzJ3emw?oc=5

(3) TipRanks/Investing.com/Benzinga — "TSMC Stock (TSM) Soars on Teaming Up with Nvidia to Bring More AI into Chipmaking" — 2026-06-01
    Cross-verified: TipRanks + Investing.com + Benzinga · verified=true · eventType: strategic-partnership
    URL: https://news.google.com/rss/articles/CBMiwwFBVV95cUxPRUFxS3BKck8zUUgyNTRFNEJxRFJEMG5Zdjh5bjA3eDdTM3JpODhNcUZSZVF3eVliRTNaeFhqRFJzWC1rR3FMRHNvaTM0YkpwRHhLRW5yYUJmOWMtdllKMFFuVGQ5NG96X2JmMjdBM1duaGFyVFgxWXVkQUNON05DZ2NScEJ3cnBzeVB1VjVNMGp4SVJoS2hpeXJJZUhGOTFSWDJfOEZMTDFSLWZwMWpOczg2amRseHY0N21PUlREazRLYlE?oc=5

TSMU 직접 tagged verified 뉴스 항목 없음. 위 TSM 3건이 기초자산 분석의 유일한 교차검증 근거임을 명시. 미검증(verified=false) 항목 인용 없음.

---

*데이터 출처: evaluator 산출 (data/valuations.json TSMU, updated 2026-06-20). data/risk-scores.json에 TSMU 항목 미등재 — 수치는 valuations.json rationale에 기재된 evaluator 산출값을 그대로 인용함. 재계산 없음.*
*Produced by evaluator + interpreter. Every number above cites evaluator output or a verified source.*
