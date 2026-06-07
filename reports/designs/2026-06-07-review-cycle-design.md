# Design: 정기 리뷰 사이클 공식화

**Date:** 2026-06-07
**Author:** architect agent
**Scope:** 월간 브리프 + 이벤트 트리거 혼합 리뷰 사이클 정의. 에이전트 파이프라인 매핑, 대상 선정 규칙, 산출물 경로, nextReview 갱신 정책 명문화. 기존 스키마 무변경 — 이 설계는 현재 `data/*.json` 구조로 동작 가능하다. 코드/데이터 파일 변경 없음.

---

## 1. 목적 및 범위

### 정의하는 것

- 두 종류의 리뷰 트리거(월간 close, 이벤트)의 발동 조건과 우선순위
- 매 사이클에 포함될 종목의 선정 규칙
- 에이전트(collector → validator → evaluator → interpreter) 실행 순서와 각 단계 입출력 경로
- 산출 파일의 명명 규칙(reports/README.md와 정합)
- evaluator가 `nextReview`를 다음 사이클로 갱신하는 정책
- 데이터 의존성 및 현재 존재하는 갭

### 정의하지 않는 것

- 브리프의 글쓰기 스타일 (interpreter.md 에이전트 명세에 위임)
- 신규 포지션 편입/편출 결정 절차 (사용자의 수동 결정 사항)
- 실제 2026-06 브리프 생성 (이 설계 승인 후 별도 실행)
- 가격 자동 수집 인프라 변경 (GH Actions / refresher agent 범위)

---

## 2. 사이클 정의

### 2-1. 두 가지 트리거

| 트리거 | 발동 조건 | 우선순위 | 산출 리포트 |
|--------|-----------|----------|-------------|
| **월간 정기** | 매월 마지막 거래일 close 이후 (~월말 +1 영업일 이내 착수) | 기본 | `monthly-brief` 1건 |
| **이벤트 트리거** | 보유/관심 종목의 `nextReview` ≤ 사이클 기준일, 또는 실적 발표 7일 이내 | 월간과 겹칠 시 월간에 통합 | `ticker-evaluation` (단독 재평가) |
| **섹터 이벤트** | 동일 섹터 2개 이상 종목이 동시에 이벤트 트리거 발동 | 월간과 겹칠 시 월간에 통합 | `sector-review` (선택적) |

### 2-2. 트리거 우선순위 규칙

1. 월간 close 기준일이 도달하면 **모든 활성 이벤트 트리거를 월간 브리프에 흡수**한다. 이미 트리거된 단독 평가가 있더라도 해당 월 마감 전이라면 월간 브리프의 Position review 섹션에 통합한다.
2. 월간 기준일 **사이**에 이벤트가 발생하면 단독 `ticker-evaluation`을 생성한다.
3. 같은 섹터에서 2개 이상의 단독 평가가 동시에 발생할 경우 `sector-review`로 묶는 것을 권장하지만 필수는 아니다. 플래너가 판단한다.

### 2-3. 리포트 종류 매핑

```
트리거 종류              →  템플릿                       →  저장 경로
────────────────────────────────────────────────────────────────────
월간 close              →  monthly-brief.md              →  reports/2026-MM/2026-MM-DD-monthly-close.md
이벤트(단독)            →  ticker-evaluation.md           →  reports/2026-MM/2026-MM-DD-{ticker}-revalue.md
이벤트(섹터 묶음)       →  sector-review.md               →  reports/2026-MM/2026-MM-DD-{sector}-review.md
```

---

## 3. 대상 선정 규칙

### 3-1. 매 사이클 포함 기준 (명문화)

```
포함 대상 = (
  tickers-universe.json의 held: true 종목 전체  ← 보유 포지션은 항상 포함
  +
  tickers-universe.json의 held: false 종목 중
    valuations.json[ticker].nextReview ≤ 사이클 기준일 인 종목
)
```

- 기준일(cycle_date): 월간 트리거는 해당 월의 마지막 거래일, 이벤트 트리거는 이벤트 발생일.
- held 여부는 `tickers-universe.json`의 `held` 필드를 1차 출처로 사용하되, `portfolio-current.json`의 positions 목록과 교차 확인 후 불일치 시 `portfolio-current.json`을 우선한다(더 세밀한 원본).

### 3-2. 2026-06 말 월간 사이클의 실제 포함 종목

**사이클 기준일: 2026-06-30** (6월 마지막 거래일 예정)

#### 보유 6종 (항상 포함)

| Symbol | held | portfolio-current.json shares | avgCost |
|--------|------|-------------------------------|---------|
| GOOGL | true | 240 sh | $317.88 |
| CLS | true | 110 sh | $366.59 |
| AVGO | true | 70 sh | $377.37 |
| MRVL | true | 172 sh | $130.85 |
| MU | true | 12 sh | $481.54 |
| SOXL | true | 5 sh | $132.21 |

#### 관심 종목 중 nextReview ≤ 2026-06-30인 종목 (이벤트 트리거)

아래는 `valuations.json`에서 직접 읽은 `nextReview` 값 기준이다.

| Symbol | held | nextReview (valuations.json) | ≤ 2026-06-30? | 포함 여부 |
|--------|------|------------------------------|----------------|-----------|
| SOXL | true | 2026-06-20 | 예 | 보유로 이미 포함 (단독 트리거 추가 발생) |
| TSMU | false | 2026-06-20 | 예 | **포함** |
| GOOGL | true | 2026-07-01 | 아니오 | 보유로 이미 포함 |
| MRVL | true | 2026-07-01 | 아니오 | 보유로 이미 포함 |
| MU | true | 2026-07-01 | 아니오 | 보유로 이미 포함 |
| NVDA | false | 2026-07-01 | 아니오 | 제외 |
| AMD | false | 2026-07-01 | 아니오 | 제외 |
| ARM | false | 2026-07-01 | 아니오 | 제외 |
| KLAC | false | 2026-07-01 | 아니오 | 제외 |
| MSFT | false | 2026-07-01 | 아니오 | 제외 |
| META | false | 2026-07-01 | 아니오 | 제외 |
| TSLA | false | 2026-07-01 | 아니오 | 제외 |
| PLTR | false | 2026-07-01 | 아니오 | 제외 |
| CRWD | false | 2026-07-01 | 아니오 | 제외 |
| AVGO | true | 2026-07-15 | 아니오 | 보유로 이미 포함 |
| CLS | true | 2026-07-15 | 아니오 | 보유로 이미 포함 |
| TSM | false | 2026-07-15 | 아니오 | 제외 |
| INTC | false | 2026-07-15 | 아니오 | 제외 |
| AMAT | false | 2026-07-15 | 아니오 | 제외 |
| LRCX | false | 2026-07-15 | 아니오 | 제외 |
| ORCL | false | 2026-07-15 | 아니오 | 제외 |
| SNOW | false | 2026-07-15 | 아니오 | 제외 |

#### 2026-06 월간 브리프 최종 대상 목록 (7종)

```
보유 6종: GOOGL, CLS, AVGO, MRVL, MU, SOXL
이벤트 트리거 추가 1종: TSMU (nextReview 2026-06-20)
```

**SOXL 비고:** `nextReview 2026-06-20`으로 6월 말 이전에 단독 이벤트 트리거도 발생한다. 이 경우 선택지는 두 가지다.
- (a) 6월 월간 브리프 착수 전에 SOXL 단독 `ticker-evaluation`을 먼저 생성 후 월간에 흡수.
- (b) 월간 착수 시점까지 SOXL 재평가를 보류하고 월간 브리프에서 일괄 처리.
플래너가 착수 시점에 판단한다. 기본 권장: (a) — SOXL은 stop-proximity critical 상태(EOD $181.46, hard-stop $170, 간격 6.7%)이므로 조기 단독 평가가 리스크 관리상 바람직하다.

---

## 4. 에이전트 실행 순서

### 4-1. 월간 브리프 파이프라인

```
[착수] 월말 close + 1 영업일
   │
   ▼
collector
  입력: tickers-universe.json (대상 종목 목록), 사이클 기준일
  작업: 대상 7종 + 매크로 지수 뉴스 수집, 가격 스냅샷 캡처
  출력:
    data/news-feed.json (items 추가, verified: false)
    reports/raw/2026-06-30-monthly-prices.json
    reports/raw/2026-06-30-monthly-news.json
   │
   ▼
validator                  ← 건너뛰기 금지 (CLAUDE.md 규칙)
  입력:
    reports/raw/2026-06-30-monthly-prices.json
    reports/raw/2026-06-30-monthly-news.json
  작업: ≥2 독립 소스 교차 확인, verified 스탬핑
  출력:
    data/news-feed.json (verified: true/false 업데이트)
    reports/validation/2026-06-30-monthly.md
   │
   ▼
evaluator                  ← validated 입력만 소비
  입력:
    data/news-feed.json (verified: true 항목만)
    data/portfolio-current.json (농도 계산용)
    data/valuations.json (현재 FV 밴드 비교)
    data/risk-scores.json (기존 점수 비교)
  작업: 대상 7종 FV 밴드 + 리스크 점수 갱신, decisionLog 추가
  출력:
    data/valuations.json (7종 업데이트, updated: "2026-06-30")
    data/risk-scores.json (보유 6종 업데이트, updated: "2026-06-30")
   │
   ▼
interpreter                ← 마지막 실행
  입력:
    data/valuations.json
    data/risk-scores.json
    data/news-feed.json (verified: true만)
    data/portfolio-current.json
  작업: 월간 브리프 서술, monthly-brief.md 템플릿 사용
  출력:
    reports/2026-06/2026-06-30-monthly-close.md
```

### 4-2. 이벤트 트리거 파이프라인 (단독 재평가)

월간 사이클 외에 nextReview 도달 시 동일 파이프라인을 단일 종목 대상으로 실행한다.

```
[착수] nextReview 도달 날짜 (또는 실적 발표 7일 이내 확인 시)
   │
   collector → validator → evaluator → interpreter
   출력: reports/YYYY-MM/YYYY-MM-DD-{ticker}-revalue.md
```

### 4-3. CLAUDE.md 규칙 반영 사항

- validator는 collector 이후 **항상** 실행. 건너뛰는 것은 CLAUDE.md에서 명시적으로 금지.
- evaluator는 `verified: true`인 항목만 입력으로 소비. `verified: false` 항목이 있으면 evaluator를 시작하지 않고 validator에 재위임.
- 에이전트는 한 번에 하나 실행. 단, collector가 2개의 무관한 섹터를 병렬 수집하는 경우에만 병렬 허용(플래너 판단).
- FV 밴드(`fvLow/fvMid/fvHigh`)는 가격 변동만으로 갱신하지 않는다. `currentPrice`와 `upsideMidPct`만 price 스냅샷 시 re-anchor 가능. 밴드 변경은 반드시 evaluator가 새 fundamental input을 소비한 후에만 허용.

---

## 5. 산출물 경로 및 명명

reports/README.md와 정합한 규칙이다.

### 5-1. collector 산출

```
reports/raw/YYYY-MM-DD-monthly-prices.json     # 월간 가격 스냅샷
reports/raw/YYYY-MM-DD-monthly-news.json       # 월간 뉴스 수집
reports/raw/YYYY-MM-DD-{ticker}-prices.json    # 단독 재평가용 가격
reports/raw/YYYY-MM-DD-{ticker}-news.json      # 단독 재평가용 뉴스
```

### 5-2. validator 산출

```
reports/validation/YYYY-MM-DD-monthly.md         # 월간 검증 요약
reports/validation/YYYY-MM-DD-{ticker}-check.md  # 단독 재평가 검증 요약
```

`data/news-feed.json` 업데이트 (items[]의 verified 필드 스탬핑)

### 5-3. evaluator 산출

```
data/valuations.json      # 7종 항목 업데이트 (updated, currentPrice, nextReview 포함)
data/risk-scores.json     # 보유 6종 항목 업데이트 (updated, decisionLog 추가)
```

TSMU와 TSM은 valuations.json에만 등장(watchlist-only). risk-scores.json는 held 종목만 포함하므로 TSMU 항목 없음.

### 5-4. interpreter 산출

```
reports/2026-06/2026-06-30-monthly-close.md          # 월간 브리프
reports/2026-06/2026-06-20-soxl-revalue.md           # SOXL 단독 재평가 (조기 실행 시)
reports/2026-06/2026-06-20-tsmu-revalue.md           # TSMU 단독 재평가 (조기 실행 시)
```

월간 브리프에 SOXL/TSMU를 흡수하는 경우 단독 파일은 생성하지 않는다.

### 5-5. 보고서 파일명 패턴 요약

| 보고서 종류 | 패턴 | 예시 |
|-------------|------|------|
| 월간 브리프 | `YYYY-MM-DD-monthly-close.md` | `2026-06-30-monthly-close.md` |
| 단독 재평가 | `YYYY-MM-DD-{ticker-lower}-revalue.md` | `2026-06-20-soxl-revalue.md` |
| 섹터 리뷰 | `YYYY-MM-DD-{sector-lower}-review.md` | `2026-06-30-semis-equip-review.md` |

모든 파일은 이벤트가 발생한 날짜를 기준으로 prefix한다(작성일이 아님).

---

## 6. nextReview 갱신 규칙

### 6-1. 기본 원칙

evaluator가 재평가를 완료하는 시점에 `nextReview`를 다음 값으로 설정한다.

| 재평가 유형 | nextReview 설정 방법 |
|-------------|----------------------|
| 월간 사이클(보유 종목) | 다음 달 마지막 거래일 (예: 6월 말 재평가 → `2026-07-31`) |
| 월간 사이클(watchlist 이벤트 흡수) | 다음 달 마지막 거래일 (예: `2026-07-31`) |
| 실적 발표 트리거 | 다음 실적 발표일 -7일 (evaluator가 earnings date 확인 후 설정) |
| nextReview 도달 단독 재평가 | catalyst 성격에 따라 evaluator 재량: 기본 +1개월, 단기 이벤트 pending 시 +2주~+4주 |
| 레버리지 ETF (SOXL, TSMU) | 기본 +2주~+4주 (decay 성격상 짧은 주기 필요; evaluator가 VIX 수준에 따라 조정 가능) |

### 6-2. 갱신 예시 (2026-06 말 사이클 후)

```jsonc
// GOOGL: 월간 사이클 → +1개월
"nextReview": "2026-07-31"

// SOXL: 레버리지 ETF, stop-proximity 해소 여부에 따라 조정
"nextReview": "2026-07-10"   // 예: stop 여유 회복 시 +2주

// TSMU: 레버리지 ETF, 유사
"nextReview": "2026-07-10"

// AVGO, CLS: 7/15 nextReview가 이미 월간 사이클 이후이므로
//   7월 월간 브리프에서 자동 포함됨 — nextReview 변경 없음
```

### 6-3. decisionLog 규칙

- `decisionLog[]`는 **append-only**. 기존 항목은 절대 수정하지 않는다.
- 재평가마다 새 항목을 추가한다. 형식:
  ```jsonc
  { "date": "2026-06-30", "action": "HOLD", "by": "evaluator", "reason": "월간 close; FV 밴드 무변경; 농도 안정" }
  ```
- 25단어 이하 reason. action은 `STRONG_BUY / BUY / HOLD / TRIM / SELL` 중 하나.
- verdict가 score 밴드에서 이탈하는 경우 reason에 이유를 명시 (evaluator.md 규칙).

---

## 7. 데이터 의존성 및 갭

### 7-1. 가격 스냅샷 의존성

`portfolio-current.json`의 `asOf`는 2026-05-05이다. 6월 말 손익 계산에는 2026-06-30 기준 가격이 필요하다.

```
의존 흐름:
  collector → reports/raw/2026-06-30-monthly-prices.json
           → (validator 검증)
           → evaluator가 currentPrice re-anchor에 사용
           → interpreter가 Book MV / PnL 계산에 사용
```

collector가 2026-06-30 종가를 수집하지 않으면 evaluator는 `currentPrice`를 `2026-06-05` 스냅샷 값(valuations.json에 현재 기재된 값)으로 유지한다. 이 경우 interpreter의 Book MV / PnL은 6/5 기준 추정치가 된다. 허용 여부는 플래너가 결정하고 브리프에 명시한다.

### 7-2. news-feed.json 의존성

evaluator는 `verified: true`인 항목만 소비한다. validator가 충분한 교차 소스를 확보하지 못한 경우 일부 뉴스 항목은 브리프에서 누락될 수 있다. 이는 정책적으로 허용된 누락이며, interpreter는 "검증되지 않은 항목은 인용하지 않음"을 브리프 Sources 섹션에 명시한다.

### 7-3. 단일 소스 항목 현황 (2026-06-05 valuations.json 기준)

아래 종목들의 현재 `currentPrice`는 단일 소스(nasdaq only)로 기재되어 있다. validator가 재검증 시 교차 소스를 확보해야 한다.

```
단일 소스 위험 종목: AMD, ARM, INTC, AMAT, LRCX, KLAC, MSFT, META, TSLA, SNOW, CRWD
2-source 검증 완료: GOOGL, PLTR (stooq+yahoo)
2-source 불일치(stooq-primary 채택, verified=false): ORCL (stooq $213.68 vs nasdaq $212.40 = 0.6% > 0.2% tolerance)
```

### 7-4. TSM (보유 해제 종목)

`tickers-universe.json`에서 TSM의 `held: false`. `portfolio-current.json`에 TSM 포지션 없음 (5/5 exit). `risk-scores.json`에 TSM 항목 없음. `valuations.json`에 peer-reference로 TSM 항목 유지. 6월 브리프에서 TSM은 "Watchlist — 섹터 맥락용"으로만 언급 가능하며 risk score 섹션은 생략한다.

---

## 8. 스키마 변경 판단

### 8-1. 현재 스키마로 충분한가?

예. 이 설계가 정의하는 리뷰 사이클은 기존 스키마 필드만으로 동작 가능하다.

- `nextReview` (valuations.json): 이미 존재. 이벤트 트리거 판단에 직접 사용.
- `decisionLog[]` (risk-scores.json): 이미 존재. append-only 정책도 이미 명세에 있음.
- `updated` + `agent` (valuations.json, risk-scores.json): 이미 존재. 사이클 추적에 충분.
- 리포트 파일 경로: reports/YYYY-MM/*.md 구조 이미 확립.

### 8-2. 선택적 스키마 추가 가능성

다음 필드가 사이클 메타데이터 추적에 유용할 수 있으나, **이번 설계 스코프에서는 도입하지 않는다.**

```jsonc
// valuations.json 항목에 선택적 추가 후보 (미채택)
"reviewCycle": "monthly"   // "monthly" | "event" | "ad-hoc"
"lastReviewDate": "2026-06-05"
```

이유: 현재 `updated` 필드가 마지막 리뷰 날짜를 이미 기록한다. `reviewCycle` 메타데이터는 리포팅 편의 기능이며 에이전트 로직에 영향을 주지 않는다. 필요성이 확인되면 별도 architect → builder PR로 분리한다. **이 설계는 additive optional 원칙에 따라 기존 스키마로만 동작한다.**

---

## 9. 다음 단계 — 6월 브리프 생성 체크리스트

이 설계 문서 승인 후 아래 순서로 실행한다.

### Phase 0 — 선행 판단 (오케스트레이터 / 플래너)

- [ ] **0-1.** SOXL nextReview 2026-06-20 도달 — 단독 선행 평가 실행 여부 결정. 권장: 실행 (stop-proximity critical 상태).
- [ ] **0-2.** TSMU nextReview 2026-06-20 도달 — SOXL과 동시에 묶어 처리할지 결정.
- [ ] **0-3.** 6월 마지막 거래일(기준일 2026-06-30) 도달 후 월간 착수.

### Phase 1 — 수집 (collector)

- [ ] **1-1.** 대상 7종(GOOGL, CLS, AVGO, MRVL, MU, SOXL, TSMU) + 매크로(SPX, NDX, VIX, US10Y, DXY) 뉴스 수집.
- [ ] **1-2.** 2026-06-30 종가 스냅샷 수집 → `reports/raw/2026-06-30-monthly-prices.json`.
- [ ] **1-3.** 뉴스 항목 → `reports/raw/2026-06-30-monthly-news.json` + `data/news-feed.json` 추가(verified: false).
- [ ] 완료 기준: collector가 수집 항목 수 + raw drop 경로 + fetch 실패 목록 반환.

### Phase 2 — 검증 (validator)

- [ ] **2-1.** `reports/raw/2026-06-30-*` 파일 검증.
- [ ] **2-2.** 가격 항목: ≥2 소스 교차, 허용 오차 0.2%.
- [ ] **2-3.** 뉴스 항목: ≥2 독립 소스 확인, verified 스탬핑.
- [ ] **2-4.** 검증 요약 → `reports/validation/2026-06-30-monthly.md`.
- [ ] 완료 기준: verified/total 비율, 실패 항목 목록 반환.

### Phase 3 — 평가 (evaluator)

- [ ] **3-1.** verified: true 항목만 소비. 미달 시 validator 재위임.
- [ ] **3-2.** 대상 7종 FV 밴드 검토 (fundamental input 변화 없으면 currentPrice + upsideMidPct만 re-anchor).
- [ ] **3-3.** 보유 6종 risk score + verdict 갱신.
- [ ] **3-4.** 각 종목 `decisionLog[]`에 항목 추가 (append-only).
- [ ] **3-5.** `nextReview` 갱신 (규칙 §6 적용).
- [ ] **3-6.** `data/valuations.json`, `data/risk-scores.json` 저장.
- [ ] 완료 기준: 갱신 종목 목록 + 요약 테이블(ticker | score | verdict | entryZone | target.base | stopLoss | rrr) 반환.

### Phase 4 — 해석 (interpreter)

- [ ] **4-1.** 월간 브리프 초안 작성 — `reports/templates/monthly-brief.md` 템플릿 사용.
- [ ] **4-2.** 한국어 본문 + 영어 ticker/숫자 (interpreter.md 기본값).
- [ ] **4-3.** 모든 수치는 evaluator 산출값 그대로 인용 (재계산 금지).
- [ ] **4-4.** 출처 주석 — news-feed.json verified 항목 URL 인용.
- [ ] **4-5.** 저장 경로: `reports/2026-06/2026-06-30-monthly-close.md`.
- [ ] 완료 기준: 파일 경로 + 제목 + 단어 수 + 인용 소스 목록 반환.

### Phase 5 — 커밋

- [ ] **5-1.** 브랜치 생성: `claude/2026-06-monthly-close`.
- [ ] **5-2.** 커밋 대상: `data/valuations.json`, `data/risk-scores.json`, `data/news-feed.json`, `reports/2026-06/2026-06-30-monthly-close.md`, `reports/raw/2026-06-30-*`, `reports/validation/2026-06-30-monthly.md`.
- [ ] **5-3.** 커밋 메시지 형식: `review: 2026-06 monthly close — 6 holdings + TSMU revalue`.
- [ ] **5-4.** Draft PR 생성. 사용자가 "ready for review" 표시.

---

## 부록 A — 전체 종목 nextReview 캘린더 (valuations.json 기준, 2026-06-05 갱신)

```
2026-06-20:  SOXL (보유), TSMU (watchlist)      ← 6월 이벤트 트리거
2026-07-01:  GOOGL (보유), MRVL (보유), MU (보유)
             NVDA, AMD, ARM, KLAC, MSFT, META, TSLA, PLTR, CRWD
2026-07-15:  AVGO (보유), CLS (보유), TSM, INTC, AMAT, LRCX, ORCL, SNOW
```

2026-07 월간 사이클 기준일(2026-07-31) 기준으로는 전체 22종이 대상에 포함된다.

---

## 부록 B — 에이전트 입출력 계약 요약

| 에이전트 | 읽는 파일 | 쓰는 파일 |
|----------|-----------|-----------|
| collector | `data/tickers-universe.json` | `data/news-feed.json` (items 추가, verified: false), `reports/raw/YYYY-MM-DD-*.json` |
| validator | `reports/raw/YYYY-MM-DD-*.json`, `data/news-feed.json` | `data/news-feed.json` (verified 스탬핑), `reports/validation/YYYY-MM-DD-*.md` |
| evaluator | `data/news-feed.json` (verified: true만), `data/valuations.json`, `data/risk-scores.json`, `data/portfolio-current.json` | `data/valuations.json`, `data/risk-scores.json` |
| interpreter | `data/valuations.json`, `data/risk-scores.json`, `data/news-feed.json` (verified: true만), `data/portfolio-current.json` | `reports/YYYY-MM/YYYY-MM-DD-*.md` |
