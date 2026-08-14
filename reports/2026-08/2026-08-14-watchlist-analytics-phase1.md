# 워치리스트 분석 오버홀 Phase 1 — 평가 리프레시 브리프 — 2026-08-14

**Scope:** UI 배포 요약 + 보유 6종(GOOGL/AVGO/CLS/MRVL/MU/SOXL) 재평가 + 워치 16종 informational risk 커버리지 + 데이터 provenance 경보
**작성:** interpreter · 2026-08-14

---

## TL;DR

- **MU와 CLS가 HOLD→BUY로 전환, SOXL은 TRIM→SELL로 전환.** MU는 fvMid $868→$1,196(검증된 애널리스트 컨센서스 $1,535.54 + 바이백 재료가 근거이나 Burry의 신규 숏 공시로 상단이 절제됨), SOXL은 하드스탑 $170을 -14% 이탈해 evaluator가 실행 가능한 손절 트리거로 판단했다.[^2][^3]
- **가격 데이터 provenance에 구조적 결함이 있다.** 2026-08-13 22종 전 티커의 currentPrice가 단일소스(stooq 404, yahoo 429 — 유니버스 전체 장애)이며, 이 때문에 MRVL(-12%)과 CLS(-1.6%)의 스탑 이탈은 "플래그"만 되고 기계적으로 실행되지 않았다 — SOXL만 예외(테제 정합적 붕괴로 실행).[^2][^3]
- **CRWD 컨센서스 정정이 이번 사이클 최대 발견.** 실제 유효 레인지는 $103–250/평균 $195.39이며, 오래된 MarketBeat/Benzinga 수치($295–613)는 절대 사용해선 안 된다.[^1][^4]

---

## 오늘 배포된 것 (What shipped today)

`index.html`에 워치리스트 22종(보유 6 + 워치 16)을 한 화면에서 보는 신규 master-detail 아코디언 뷰(`#analytics-panel`)가 배포됐다 — 종목별 추세/리스크/뉴스/애널리스트 컨센서스/PER을 요약 행에서 보고, 클릭 시 상세 그리드가 펼쳐지는 구조다.[^5] 신규 데이터 파일 3종(`data/analyst-targets.json`, `data/fundamentals.json`, `data/news-latest.json`)이 함께 배포됐고, `data/risk-scores.json`은 `coverage` 필드(“full” 보유 6종 vs “informational” 워치 16종)를 새로 얻었다.[^3][^5] 1024px/380px 브레이크포인트가 추가돼 좁은 화면에서 컬럼이 단계적으로 축소되는 모바일 표시 문제가 해결됐다.[^5] Phase 2로 이연된 항목: 실제 다중일 추세(가격 히스토리 스토어 필요), `scripts/scrape-fundamentals.mjs` 논-인터랙티브 스크레이퍼, 워치 16종의 full risk 확장(entryZone/target/stopLoss/rrr 워크업).[^5]

---

## 보유 종목 — 평가 변경사항 (Held book — evaluation changes)

| Ticker | Verdict (6/5→8/14) | fvMid (6/5→8/14) | Score | Stop | 핵심 메모 |
|---|---|---|---|---|---|
| GOOGL | HOLD→HOLD | $367→$400 | 35 | $325(하향 조정) | 집중도 41.2%, DOJ 오버행 |
| AVGO | BUY→BUY | $424→$458 | 16 | $390(상향) | 인사이더 매도 경계, $215.88 아웃라이어 제외 |
| CLS | HOLD→BUY | $399→$424 | 15 | $325(리셋) | 스탑 테스트 플래그, 미실행 |
| MRVL | TRIM→HOLD | $307→$295 | 26 | $205(리셋) | 스탑 이탈 플래그, 미실행, 실적 임박 |
| MU | HOLD→BUY | $868→$1,196 | 15 | $850(상향) | 검증 컨센서스 $1,535.54, 바이백 vs Burry 숏 |
| SOXL | TRIM→SELL | $240→$205 | 31 | $170(이탈됨) | 하드스탑 -14% 이탈, 실현된 decay |

**GOOGL — HOLD, score 35.** currentPrice $346.35은 fvLow $350보다도 낮은 위치다.[^2] fvMid는 4가지 방법 평균으로 $400까지 상향됐는데, Q2 클라우드 마진 비트와 검증된 애널리스트 컨센서스(평균 $425.32, 64명, 1.29% 스프레드, stockanalysis.com+tipranks.com)가 근거다.[^2][^4] 그러나 EOD 시총 기준 집중도가 41.2%로 40% 임계를 돌파해 +25점 페널티가 붙었고, DOJ Chrome/ad-tech 판결이 여전히 active 오버행이다.[^2][^3] 스탑은 $325로 재설정됐다. 신규 매수 없이 홀드.

**AVGO — BUY, score 16.** currentPrice $419.4693은 6/5 이후 +8.5% 상승했고 fvMid는 $458로 올랐다.[^2] 검증 컨센서스 평균 $522.10(2.19% 스프레드)이 상단을 지지하지만, 공동창업자의 분기 스톡 매도 $720M+가 정성적 경계 플래그로 남아 있다.[^2][^3] targetLow $215.88은 validator가 재현 확인했으나 stale/미조정 아웃라이어로 판단해 실질 하방 시나리오로 쓰지 말라고 명시했다 — TipRanks의 $390이 더 대표성 있는 로우다.[^4] 진입존은 $395–425로 상향, 스탑은 $390.

**CLS — BUY, score 15 (HOLD에서 전환).** currentPrice $349.44은 6/5 이후 +7.15% 단일세션 급등을 포함한 상승 흐름을 반영한다.[^2] 검증 컨센서스 평균 $453.06(4.03% 스프레드)이 fvMid $424 상향의 근거다.[^2][^4] 다만 $349.44은 구 하드스탑 $355 대비 -1.6%로 근접했는데, 이는 단일소스 가격이라 evaluator는 이를 “테스트”로만 플래그하고 기계적 이탈로 취급하지 않았다 — 스탑은 구조적 완충용으로 $325 재설정됐다.[^2][^3] RRR 3.05로 북 내 최우수 수치.

**MRVL — HOLD, score 26 (TRIM에서 전환).** currentPrice $224.39은 6/5 이후 -19.1% 하락해 보유 6종 중 유일한 대형 하락 종목이다.[^2] 구 하드스탑 $255 대비 -12%로, SOXL 다음으로 큰 이탈 폭이지만 이 역시 단일소스 가격이며 실적 발표가 임박한 것으로 보여(“quick bounce before earnings”, Barchart 8/12 — valuations.json 인용) evaluator는 URGENT 검증 항목으로 플래그만 하고 기계적 트리거로 실행하지 않았다.[^2][^3] 검증 컨센서스는 평균 $258.06이나 선호 페어링(SA+TipRanks)이 5.32%로 5% 허용치를 근소하게 벗어나 caution flag가 붙어 있다 — 차선 페어링(SA+MarketBeat, 4.27%)으로 verified 처리됐다.[^1][^4] 스탑은 $205로 재설정, HOLD 유지.

**MU — BUY, score 15 (HOLD에서 전환), 이번 사이클 최대 FV 상향.** currentPrice $961.88은 6/5 이후 +9.9%.[^2] fvMid가 $868→$1,196으로 이동한 것은 검증된 컨센서스 평균 $1,535.54(4.27% 스프레드, high $2,200 SA/TipRanks 정확 일치)와 “최대 12% 자사주 매입 가능” 바이백 재료(Seeking Alpha 8/13 — valuations.json 인용)가 근거다.[^2][^4] MarketBeat의 $1,260.31은 미갱신 구성종목 타깃을 근거로 컨센서스에서 명시적으로 제외됐다.[^1][^4] Michael Burry의 신규 MU 숏 공시(Yahoo Finance 8/12 — valuations.json 인용)를 반영해 fvMid는 애널리스트 평균에 완전히 수렴시키지 않고 절제됐다.[^2] 진입존 $920–980, 스탑 $850.

**SOXL — SELL, score 31 (TRIM에서 전환), 실행 가능한 손절 트리거.** currentPrice $146.2784은 하드스탑 $170을 -14% 이탈해 보유 6종 중 최대 폭이다.[^2][^3] 같은 기간 반도체 관련 보유/워치 종목은 대체로 상승했다(MU +9.9%, AVGO +8.5%, NVDA +9.9%, TSM +5.1%, AMD +4.0%, LRCX +10.2%, INTC +8.2%, MRVL만 -19.1%)인 반면 SOXL 자체는 -19.4% 하락했다 — 3배 daily-reset decay가 실현된 결과로 evaluator가 명시적으로 판단했다.[^2] 이 이탈은 (a) 테제 정합적(decay 실현, 이상치 아님), (b) 포지션이 de minimis(5주, 북 대비 0.36%, 약 $731)라는 점에서 단일소스 가격 한계에도 불구하고 실행 가능한 트리거로 처리됐다.[^2][^3] 최종 청산 실행 여부는 PM 결정 사항이다 — 아래 액션 아이템 참조.

---

## 데이터 Provenance 경보 (Data provenance callout)

2026-08-13 세션에서 **22개 티커 전체의 currentPrice가 단일소스**다 — stooq는 404, yahoo는 429 응답으로 유니버스 전체 스크레이퍼 장애였으며, GOOGL/특정 종목 국지적 문제가 아니다.[^2] `CLAUDE.md`의 원칙상 “verified=true는 ≥2개 독립 소스 합치”이며 단일소스 가격은 보통 보유 포지션 평가를 차단해야 한다. 이번 사이클은 이를 우회하지 않고, 대신 **검증된 애널리스트 컨센서스(analyst-targets.json, 15/22 종목 verified) 및 펀더멘털 방법론(DCF/EV-EBITDA/PEG)에 근거해 FV 밴드 재산출을 진행**했으며, 모든 rationale 텍스트에 단일소스 캐비어트를 명시적으로 남겼다.[^1][^2] 가격 트리거형 손절 판단은 기계적으로 실행하지 않고 플래그만 남겼다 — MRVL(-12%), CLS(-1.6%)가 해당된다. **SOXL만 예외**로 실행됐는데, 이는 이탈이 realized decay라는 별도 정합 근거(analyst coverage 부재 leveraged ETF, de minimis 포지션)가 있었기 때문이다.[^2][^3]

**권고:** (1) 스크레이퍼 장애 원인 조사(stooq 404 / yahoo 429), (2) `scripts/scrape-quotes.mjs` + `verify-quotes.mjs` 리프레시 파이프라인 재실행, (3) MRVL·CLS 스탑 상태를 검증된(2-소스) 가격으로 재확인한 후 행동.

---

## 워치리스트 시그널 (Watchlist signals)

워치 16종 전체가 이번에 처음으로 informational risk 커버리지를 받았다 — score 범위 5~25, 전부 low band(30 미만).[^3] 애널리스트 타깃이 이번 사이클에 검증되지 않은 5개 종목(ARM/META/ORCL/SNOW/CRWD)은 모두 보수적 HOLD 판정을 받았다 — 데이터 품질 리스크가 명시적으로 태깅됐다.[^1][^3][^4]

**CRWD는 반드시 짚어야 할 정정 건이다.** 검증기가 확인한 실제 유효 컨센서스는 $103–250/평균 $195.39(stockanalysis.com, 52명)이며, MarketBeat/Benzinga가 제시한 $295–613 레인지는 CRWD가 2026년 4월경 ~$450에서 현재 $225.65 수준으로 약 50% 하락하기 전의 낡은 레짐을 반영한 것으로 확인됐다 — 이 오래된 숫자로 행동하면 안 된다.[^1][^4] ORCL도 유사한 패턴이 나타났다: stockanalysis.com $247.17 vs MarketBeat/TipRanks ~$346–354로 30–40% 격차가 있으며, 후자는 stale 가격 컨텍스트(“last price” $257.85가 실거래가 ~$156과 불일치)로 배제됐다.[^1][^4]

**검증된 업사이드 스탠드아웃:** NVDA는 61명 애널리스트 기준 평균 타깃 $306.24(2.29% 스프레드, high $500이 SA/TipRanks 정확 일치)로 이번 사이클 워치리스트 중 가장 촘촘하게 검증된 컨센서스 중 하나다.[^4] TSM은 4-way 소스 평균 $533.36(최대 스프레드 3.63%)으로 전 소스가 tight하게 합치했다 — 다만 두 종목 모두 valuations.json의 fvMid/currentPrice는 6/5 기준으로 미갱신 상태이므로, FV 밴드 대비 업사이드%를 산출하려면 evaluator의 다음 정기 리뷰를 기다려야 한다(§“What shipped today” phase-2 백로그 참조).[^2][^4][^5]

---

## 액션 아이템 / 다음 리뷰 (Action items / next review)

1. **긴급 — MRVL 스탑 상태를 검증된 2-소스 가격으로 재확인.** 현재 -12% 이탈은 단일소스이며 실적 발표가 임박한 것으로 보인다 — 확정 전 포지션 액션 보류.[^2][^3]
2. **CLS 스탑 상태도 동일하게 재확인.** -1.6% 테스트는 단일소스, 새 스탑 $325 기준으로 재평가 필요.[^2][^3]
3. **SOXL 청산 여부는 PM(Daniel) 결정 사항.** evaluator는 SELL로 판정했고(하드스탑 -14% 이탈, thesis-consistent decay, de minimis 포지션) 근거는 명확하나 최종 실행은 PM 승인 필요.[^2][^3]
4. **스크레이퍼 장애 수정.** stooq 404 / yahoo 429의 원인 파악 후 `scripts/scrape-quotes.mjs` + `verify-quotes.mjs` 재실행, 22종 전체 2-소스 가격 복원.
5. **Phase 2 백로그 착수 순서:** (a) 다중일 추세용 가격 히스토리 스토어, (b) `scripts/scrape-fundamentals.mjs` 논-인터랙티브 PER 스크레이퍼, (c) 워치 16종 full risk 확장(entryZone/target/stopLoss/rrr) — 순차 진행, 상호 블로킹 없음.[^5]

---

## Sources

[^1]: validator · `reports/validation/2026-08-14-watchlist-analytics-phase1.md` — 수집방식 caveat(WebFetch EGRESS_BLOCKED → WebSearch 대체), 결과 요약(analyst targets 15 verified/5 not verified/2 N/A; fundamentals 0/20 verified), 타겟 재확인 8건, per-ticker 판정, trust list — 2026-08-14
[^2]: evaluator · `data/valuations.json` — fvLow/fvMid/fvHigh/currentPrice/upsideMidPct/method/rationale/catalysts/risks, 보유 6종(2026-08-14 갱신) + 워치 16종(2026-06-05~06-20, 미갱신)
[^3]: evaluator · `data/risk-scores.json` — score/verdict/entryZone/target/stopLoss/rrr/decisionLog(coverage:"full", 보유 6종) 및 score/verdict/risks(coverage:"informational", 워치 16종) — 2026-08-14
[^4]: validator · `data/analyst-targets.json` — 검증된 컨센서스 타깃 15종, 미검증 5종(ARM/META/ORCL/SNOW/CRWD), N/A 2종(SOXL/TSMU), tolerance 0.05 — 2026-08-14
[^5]: architect · `reports/designs/2026-08-14-watchlist-analytics-view.md` §1-2 — 배포 범위(master-detail 아코디언, `#analytics-panel`, 22종), 신규 파일 3종, 브레이크포인트(1024/768/480/380px), phase-2 이연 항목(§8)
[^6]: `data/portfolio-current.json` — 보유 6종 포지션(shares/avgCost/weight), asOf 2026-05-05 sync

---

*Produced by interpreter. 모든 수치는 [^1]–[^6] 출처에 근거하며, 재계산되거나 새로 추정된 값은 없습니다. evaluator decisionLog에 기록되지 않은 행동은 이 브리프에서 권고하지 않습니다.*
