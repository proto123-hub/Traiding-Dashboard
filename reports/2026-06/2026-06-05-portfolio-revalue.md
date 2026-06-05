# 포트폴리오 재평가 브리프 — 2026-06-05

**작성:** interpreter · **입력 기준:** evaluator/validator 2026-06-05 산출물 전용  
**보유 6종:** GOOGL · AVGO · CLS · MRVL · MU · SOXL  
**채택가 출처:** reports/validation/2026-06-05-price-stamp.md

---

## TL;DR

- 6/5 광범위 반도체 리스크오프(NDX -1.93%, SOXL -17.24%, 섹터 -4~-9%)로 포트폴리오 전종목 하락. 그러나 FV 훼손은 없음 — evaluator는 AVGO·GOOGL을 **BUY**로 상향, MRVL만 **TRIM** 유지.
- 핵심 행동 2건: MRVL 부분 트림(+121% 미실현 이익 방어 + 22% 북 비중 관리), SOXL $170 하드스탑 실시간 모니터링(현재 $217.41 → 스탑까지 -20.9%).
- MU는 fvMid $868 대비 $927.93으로 6.9% 초과 + RRR 0.30 압축 — 추가 매수 근거 없음, $960 base target 도달 시 라운드트립 검토.

---

## Holdings View

### GOOGL — BUY · score 29(low)

**권고: $345–360 분할 추가 매입 대기.** 6/5 세션 종가 $369.775는 fvMid $367 대비 +0.75% 초과에 불과하며 essentially at-FV 상태다. avgCost $317.8767 대비 미실현 +16.3%($76,290 cost → $88,746 market). score 29는 북 내 최저 리스크 판정. 단, DOJ Chrome/ad-tech 분리 판결(Q4 예정)이 스프레드를 눌러 score가 낮음에도 즉시 추가 매입을 정당화하지 않는다 — 진입 존 $345–360 재진입 시에만 추가. 책 비중 39.5%는 집중도 리스크 태그(high severity)로 기록돼 있다. [1]

### AVGO — BUY · score 16(low)

**권고: 진입 존 $370–390 재진입 시 추가 매입.** 6/5 -3.98% 하락($402.23)으로 fvMid $424까지 5.41% 업사이드가 복원됐다. avgCost $377.37 대비 미실현 +6.6%($26,416 → $28,156). score 16은 북 내 최저이며 evaluator의 4/22 HOLD에서 6/5 BUY로 상향 기록됨. Google TPU ~30% AI 매출 고객 집중도가 주요 리스크. [1]

### CLS — HOLD · score 31(medium)

**권고: 홀드. 진입 존($355–375) 하회 시 재평가.** 4/22 TRIM-1/3(이벤트 리스크 관리) 후 6/5 실적 발표 이벤트가 소화됐다. score 68(이벤트 리스크 누적) → 31(이벤트 클리어 후 디컴프레션)로 하락. 이 score 재조정이 버딕트를 TRIM에서 HOLD로 이동시킨 근거다. 종가 $398.675는 fvMid $399 직하로 upside 0.08% — 중립 위치. avgCost $366.59 대비 미실현 +8.7%($40,325 → $43,854). 6/5 -6.27% 거래량 동반 낙폭이 50일선 하향 이탈 기술적 신호를 발생시켰으나, 이는 섹터 전반 리스크오프와 일치하며 단독 테제 훼손으로 분류되지 않는다. [1]

### MRVL — TRIM · score 31(medium)

**권고: 부분 트림 실행.** avgCost $130.8481에서 6/5 종가 $288.83으로 +120.7% 미실현 이익($22,506 cost → $49,679 market). evaluator는 다음 3가지를 근거로 TRIM을 로그했다: (i) 이익 방어 — 3-method FV 평균 $307 대비 현재가 fvLow~fvMid 구간, (ii) 비중 22.3% 집중도 초과(>20% 임계값), (iii) 6/5 -7.26% 거래량 동반 낙폭이 선행 지지선 하향 이탈. **핵심 텐션:** 테제는 손상되지 않았다 — 커스텀 ASIC 차세대 수주·데이터센터 인터커넥트 모멘텀은 유효하다. 6/5 -7.26%가 섹터 로테이션에 따른 것이라면 조기 트림은 기회비용이 된다. 반면 fvMid $307 → base target $330 잔여 업사이드가 기실현 이익 +121% 대비 크지 않으므로, 리스크 비대칭이 부분 트림을 지지한다. 트림 후 최소 일부 포지션을 유지하고 $255 스탑 아래 전량 청산 규칙을 적용한다. [1]

### MU — HOLD · score 23(low)

**권고: 홀드. 추가 매입 없음. $960 base target 도달 시 라운드트립 검토.** avgCost $481.5442 대비 6/5 종가 $927.93으로 미실현 +92.7%($5,779 cost → $11,135 market). fvMid $868을 6.9% 초과한 상태이며 RRR은 0.30으로 압축됐다($927.93 현재가, $960 base target, $820 스탑). HBM3E 퀄리피케이션은 2026-04-22 검증 뉴스에서 확인됐으나[2], 해당 테제는 이미 가격에 반영돼 있다. 메모리 사이클 피크 마진 평균회귀가 high severity 리스크로 기록됐다. $960 base target 달성 시 avgCost $481.54 대비 +99.3% — 해당 시점에 규모 축소를 재검토한다. [1][2]

### SOXL — HOLD · score 31(medium)

**권고: $170 하드스탑 실시간 집행 준비. 현재 홀드.** 5sh re-entry @ $132.21, 6/5 종가 $217.41 → 미실현 +64.5%($661 cost → $1,087 market). 6/5 -17.24% 단일 세션 낙폭은 3x 레버리지 특성상 섹터 -4~-9%의 배율 결과로 정상 범위 내다. exit 판단 프레임: (i) **하드 스탑 $170** — 현재 $217.41에서 -20.9% 여유. 이 선이 이탈되면 즉시 전량 청산. (ii) **time-stop** — portfolio-current 노트상 5/20 경과 이미 적시됨. 3x ETF는 장기 보유 시 daily-reset decay가 NAV를 잠식하므로 포지션 존속 기간을 제한한다. (iii) **thesis-stop** — SOX 섹터 지수가 구조적 하락 추세 확인 시 레버리지 도구를 보유할 근거가 없다. base target $270 대비 현재 $217.41로 25% 잔여 업사이드가 스탑($170) 리스크 -21.9%를 정당화하는 한 홀드 유지. [1]

---

## Watchlist Movers

| Ticker | 이전 verdict | 6/5 verdict | FV-Mid 변동 | 비고 |
|--------|-------------|-------------|-------------|------|
| GOOGL | HOLD (4/22) | BUY | $376 → $367 | 섹터 리스크오프 디레이트 반영 |
| AVGO  | HOLD (4/22) | BUY | $420 → $424 | 6/5 낙폭이 업사이드 복원 |
| CLS   | TRIM (4/22) | HOLD | $399 (신규) | 이벤트 리스크 소화 후 score 디컴프레션 |
| MRVL  | — (미평가)  | TRIM | $307 (신규) | 최초 evaluator 평가, 즉시 TRIM |

TSM은 5/5 포지션 청산 완료, 현재 peer-reference용으로만 유지.

---

## Sector / Macro

6/5 세션은 반도체 전 업종 동조 하락으로 특정 테제 훼손이 아닌 시장 레짐 전환 신호다. ARM -8.91%, MU -6.83%, CLS -6.27%, AVGO -3.98% 등 북 내 전종목이 섹터 범주 내 낙폭을 기록했다. 뉴스피드의 6/5 수집 항목("AVGO Soft AI Guidance" 후 칩 섹터 전반 이틀째 하락)[미검증 — 인용 제외]은 단일 소스로 검증되지 않아 본 브리프에서 팩트로 채용하지 않는다. evaluator가 채택한 섹터 컨텍스트(NDX -1.93%, SOXL -17.24%)는 price-stamp 채택가로 확인된다.[1] HBM3E 퀄리피케이션은 4/22 검증 데이터[2]에 근거하며, 해당 테제가 MU 현재가에 선반영된 상태임은 fvMid 초과와 RRR 압축이 확인한다.

---

## Risks Flagged This Cycle

- **[HIGH] GOOGL 북 집중도 39.5%** — 단일 포지션이 북의 40%를 구성. 시장 전반 이벤트 시 포트폴리오 변동성이 GOOGL 단독에 의해 결정됨.
- **[HIGH] SOXL $170 하드스탑 유효** — 현재 $217.41, 스탑까지 -20.9%. 3x ETF 특성상 SOX -7%면 도달 가능. 세션 중 모니터링 필수.
- **[HIGH] MU 사이클 피크 마진** — $927.93이 fvMid $868 초과 + RRR 0.30. 메모리 가격 정상화 또는 SK Hynix/삼성 HBM 공급 증가 시 빠른 다중 압축 가능.
- **[MEDIUM] MRVL TRIM 실행 지연 리스크** — 6/5 -7.26% 후 추가 하락 시 미실현 이익이 빠르게 침식됨. $255 스탑 준수 전제로 홀드 구간 유지.
- **[MEDIUM] DOJ 꼬리 리스크(GOOGL)** — Q4 Chrome/ad-tech 분리 판결이 현실화 시 SOTP 할인이 현재 모델 -15%를 초과할 가능성.
- **[MEDIUM] AI 칩 수출 규제 확대** — AVGO·MRVL·MU 3종에 공통 리스크 태그. 행정 조치 타임라인 불확실.

---

## Sources

(1) evaluator — data/valuations.json + data/risk-scores.json — 2026-06-05  
(2) Digitimes / TipRanks / Benzinga — "Micron HBM3E qualification confirmed by SK Hynix benchmark leak" (news-feed id: 2026-04-22-mu-hbm-confirm, verified=true, crossSources: TipRanks, Benzinga) — 2026-04-22  
(3) validator — reports/validation/2026-06-05-price-stamp.md (adopted price table, MRVL override note) — 2026-06-05T14:00:00Z  

---

*본 브리프는 in-repo evaluator/validator 산출물만을 해석합니다. 6/5 수집 뉴스피드 항목은 전종목 verified=false이므로 팩트 주장에 인용하지 않습니다.*
