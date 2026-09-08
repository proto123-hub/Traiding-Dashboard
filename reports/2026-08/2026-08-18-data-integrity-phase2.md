# 데이터 무결성 복구 Phase 2 — 평가 리프레시 브리프 — 2026-08-18

**Scope:** 시세·펀더멘털 파이프라인 근본 수정 + 보유 6종 스톱 재검증(검증 데이터 기준) + KLAC/CRWD 액면분할 오류 정정 + 워치 16종 재평가 시도(9건 기각). Phase 1(8/14)이 남긴 "22종목 전체 단일소스라 스톱 판단을 기계적으로 실행하지 못한다"는 블로커를 해소하는 작업이다.[^16]
**작성:** interpreter · 2026-08-18

---

## Daniel이 알아야 할 것

- **AVGO, BUY→HOLD.** 8/14 단일소스 가격 $419.47은 오류였다. 검증된 2026-08-17 종가(nasdaq+cboe+cnbc 3-way 합치)는 $392.43로 하드스탑 $390 위 단 $2.43(0.6%)이며, 검증된 프리마켓 프린트 $386.50은 이미 스탑 아래다.[^1][^2] 신규 매수 금지, 즉시 스탑워치 대상. **경고:** AVGO의 rrr 26.98은 북 내 최고 수치로 대시보드에 뜨지만 매력적인 리스크/보상이 아니라 그 반대다 — 가격이 스탑에 거의 붙어 분모($2.43)가 0에 가까워지며 생긴 계산 왜곡(artifact)이다.[^2]
- **SOXL SELL, 검증 데이터로 확정.** 검증 종가 $151.53은 하드스탑 $170을 -10.9% 이탈했다 — 단일소스가 시사했던 -14%보다 폭은 작지만 신뢰도는 더 높다.[^1][^2] 실행 여부는 Daniel의 결정 사항.
- **MRVL — 정확히 말하면.** 검증 종가 $234.33은 ORIGINAL 스탑 $255 대비 여전히 -8.1% 하회 상태다. HOLD로 남는 이유는 8/14에 evaluator가 스탑을 $205로 완화(decisionLog 기록)했기 때문이며, $205 기준으로는 +14.3% 위다.[^2] Daniel은 이 스탑 완화를 받아들일지 결정해야 한다.
- **KLAC·CRWD 공정가치 밴드가 액면분할 이전 주수로 산정돼 있었다.** KLAC은 2026-06-12 10:1 분할(자체 raw quote 6/11 $2,429.99 → 6/12 $254.19), CRWD는 2026-07-02 4:1 분할(raw quote 7/1 $769.90 → 7/2 $194.82) 이후에도 밴드가 그대로 방치돼 있었다.[^4] 이번에 각각 ÷10, ÷4로 정정: KLAC $145/$175/$220(신뢰도 낮음 — 기계적 단위 정정일 뿐 재평가는 아님), CRWD $100/$122.5/$160(마찬가지로 기계적 정정, 논지 자체는 미갱신 — nextReview 2026-07-01 이미 경과).[^3]
- **CLS 스톱 테스트, 해소.** 검증 종가 $340.40은 스탑 $325를 이탈하지 않았다(+4.7%). BUY 유지, rrr 5.43.[^2]

## 무엇이 고장났고 무엇이 고쳐졌는가

시세 검증이 0/27 → 25/27로 회복됐다. 원인은 모두가 짐작했던 "소스 장애"가 아니라 **필드 오독**이었다: Cboe의 `current_price`는 자사 거래소의 15:59:59 체결가로 16:00 종가 동시호가를 누락하고, NASDAQ의 `primaryData`는 프리마켓 세션에서 실시간 프리마켓 프린트를 반환한다 — 서로 다른 세션의 값을 비교하고 있었다.[^5][^6] Yahoo(러너 IP 429, 쿠키 웜업으로도 무효)와 Stooq(경로 자체가 404, 미러 포함)는 구조적으로 죽은 것으로 확인돼 제거했다.[^5][^7] 남은 미검증 2종 중 DXY는 Cboe가 취급하지 않는 ICE 지수라 구조적으로 단일소스이고, VIX는 이번 사이클 한정으로 Cboe $15.19 vs CNBC $15.65(3.0% 괴리, 0.5% 지수 허용치 초과)의 실제 소스 간 불일치다.[^8] US10Y는 이번에 처음 검증됐다(Cboe 4.732 vs CNBC 4.73).[^8]

`verified:true`가 어느 소스도 뒷받침하지 않는 값에 붙을 수 있는 결함도 있었다 — 발행값이 "합의된 값"이 아니라 "고정 우선순위 1번 소스"였기 때문이다. 이제는 합의 클러스터 값을 발행하고 불일치 소스는 `outlierSources`에 별도 기록한다.[^9]

PER 검증은 0/20 → 11/20으로 올랐다. SEC TTM EPS 수정이 핵심이었다 — 기업들은 4분기 10-Q를 제출하지 않으므로 Q4는 연간치에서 역산(FY − Q1 − Q2 − Q3)해야 했다.[^10] 잔여 미검증분은 정직하게 밝힌다: SNOW/CRWD/INTC는 적자 기업이라 의미 있는 P/E 자체가 없고(sourceCount 0, trailingPE null), ARM/AMAT/META/TSLA/ORCL은 GAAP-vs-조정 EPS 격차로 2소스가 있어도 불일치하며, TSM은 20-F 제출자라 분기 XBRL이 없다.[^12] Forward P/E는 설계상 구조적으로 0건 검증이다 — NTM 기준을 실제 발행하는 소스가 CNBC 하나뿐이고, 기준(basis)이 다른 forward P/E는 절대 섞어 비교하지 않는다.[^10][^11]

## 하지 않은 것과 이유

워치 16종 중 **9건의 재평가가 적대적 검토(adversarial review)에서 기각돼 6월 밴드로 남았다** — 미검증 수치를 발행하지 않겠다는 원칙을 지킨 결과다. 솔직히 말하면, 1차 시도는 데이터 파일에 존재하지 않는 수치를 근거로 인용한 rationale을 생성했고, 이는 검토 과정에서 발견돼 전량 반려됐다 — 병합된 것은 없다.[^13] 대시보드의 STALE 배너가 해당 종목들을 표시한다.[^14]

애널리스트 타깃(`data/analyst-targets.json`)은 여전히 스크레이핑이 아니라 WebSearch 합성치다(2026-08-14T12:00:00Z 이후 미갱신) — ARM/META/ORCL/SNOW/CRWD 타깃은 미검증 상태로 남아 있다.[^15]

## 다음 액션

**Daniel 결정**
1. SOXL 청산 여부 — SELL이 검증 데이터로 확정됐으나 실행은 PM 승인 사항.[^2]
2. MRVL의 8/14 스탑 완화($255→$205)를 수용할지 — 원 스탑 기준으로는 여전히 이탈 상태다.[^2]
3. AVGO 스탑 근접 대응 — $2.43(0.6%) 여유, 프리마켓은 이미 이탈.[^1][^2]

**파이프라인**
4. 기각된 9건의 워치 재평가 재실행.
5. Forward P/E의 NTM 기준 2번째 소스 확보 — 현재 구조상 검증 불가.[^10]
6. `analyst-targets.json`을 NASDAQ `summary.OneYrTarget` 스크레이핑으로 전환.[^11]
7. DXY 2차 소스 확보.[^8]
8. 스탑에서 ~1% 이내인 종목의 rrr을 대시보드에서 억제/주석 처리 — AVGO 사례가 그 필요성을 보여준다.[^2]

---

## Sources

[^1]: refresher · `data/price-quotes.json` (2026-08-18T12:21:22Z, session: pre-market) — AVGO/SOXL/MRVL/CLS 검증 종가(regular, nasdaq+cboe+cnbc 3-way) 및 extended 프리마켓 프린트
[^2]: evaluator · `data/risk-scores.json` (2026-08-18 갱신) — AVGO/SOXL/MRVL/CLS의 score/verdict/stopLoss/rrr/decisionLog, $419.47→$392.43 정정, $386.50 프리마켓 언급
[^3]: evaluator · `data/valuations.json` — AVGO/SOXL/MRVL/CLS/KLAC/CRWD fvLow/fvMid/fvHigh/currentPrice/rationale, KLAC·CRWD 분할 단위 정정 밴드(confidence: low)
[^4]: refresher · `reports/raw/2026-06-11-quotes.json`(KLAC $2,429.99) / `2026-06-12-quotes.json`($254.19) · `2026-07-01-quotes.json`(CRWD $769.9025) / `2026-07-02-quotes.json`($194.82) — 분할 전후 raw 시세 대조
[^5]: `reports/validation/2026-08-18-source-probe.md` — CI 러너 IP에서 캡처한 Cboe `current_price`/`close`, NASDAQ `primaryData`/`secondaryData` 원본 payload 및 근본원인
[^6]: architect · `reports/designs/2026-08-18-session-aware-quotes.md` §1a-1b — 세션 인식 스키마 설계, 근본원인 재요약
[^7]: architect · `reports/designs/2026-08-18-scraper-fix.md` — 초기 진단, Yahoo/Stooq 구조적 장애 확인(≥9영업일 동일 시그니처)
[^8]: `reports/validation/2026-08-18-compare.json` — 시세 검증 summary 25/27(verified)·2/27(failed: DXY 단일소스, VIX 3.0% 불일치), US10Y 최초 검증(Cboe 4.732 / CNBC 4.73)
[^9]: `scripts/scrape-quotes.mjs` — `consensusCluster()`/`outlierSources` 구현(합의 클러스터 발행, 이견 소스 별도 기록), Yahoo/Stooq 제거 tombstone 주석
[^10]: architect · `reports/designs/2026-08-18-fundamentals-scraper.md` §1b, §2 + `scripts/scrape-fundamentals.mjs` 헤더 — SEC TTM EPS 유도(FY−Q1−Q2−Q3), forward P/E basis 격리 원칙
[^11]: validator · `reports/validation/2026-08-18-fundamentals-probe.md` — CNBC/SEC/NASDAQ 소스 평가, forward P/E basis trap, NASDAQ `summary.OneYrTarget` bonus find
[^12]: refresher · `data/fundamentals.json` + `reports/validation/2026-08-18-fundamentals-compare.json` — trailingVerified 11/20, forwardVerifiedAnyBasis 0/20, SNOW/CRWD/INTC sourceCount 0, ARM/AMAT/META/TSLA/ORCL 2-source mismatch
[^13]: `SESSION_LOG.md` 2026-08-18 22:25 KST 엔트리 — "watch-16 재평가는 16건 중 9건 적대적 검증 기각 → 6월 밴드 유지(미검증 수치 발행 거부)"
[^14]: `index.html` `buildAnalyticsDetail()` STALE 배너 로직(L1174-1177) — nextReview 경과 종목에 경고 표시
[^15]: validator · `data/analyst-targets.json` — updated 2026-08-14T12:00:00Z 이후 미갱신, collectionMethod: WebSearch 합성(WebFetch EGRESS_BLOCKED 명시)
[^16]: interpreter · `reports/2026-08/2026-08-14-watchlist-analytics-phase1.md` "데이터 Provenance 경보" — 22종목 전체 단일소스로 스톱 트리거가 플래그만 되고 미실행됐던 phase 1 블로커

---

*Produced by interpreter. 모든 수치는 [^1]–[^16] 출처에 근거하며, 재계산되거나 새로 추정된 값은 없습니다. evaluator decisionLog에 기록되지 않은 행동은 이 브리프에서 권고하지 않습니다.*
