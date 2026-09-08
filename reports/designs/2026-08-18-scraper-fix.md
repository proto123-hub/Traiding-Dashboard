# Fix design — scrape-quotes.mjs quote verification outage

Grounded in `/home/user/Traiding-Dashboard/scripts/scrape-quotes.mjs`, `scripts/lib/io.mjs`, `.github/workflows/data-refresh.yml`, and the audit drops in `reports/raw/2026-08-05..17-quotes.json`. Note: the sandbox proxy blocks all finance hosts (CONNECT 403), so live probing was impossible; evidence below is from the repo's own raw drops. One correction to the premise: **the outage is not "since 2026-08-13" — every retained raw drop back to 2026-08-05 shows the identical signature** (stooq 24/24 `http_404`, yahoo 26–27/27 `http_429`, nasdaq 23/23 OK). This is a stable, structural failure, not a transient.

---

## 1. Root cause per source

**Stooq — HTTP 404 on `GET /q/l/?s=<sym>&f=sd2t2ohlcv&h&e=csv` for all 24 attempted symbols, every run, ≥9 business days.** A uniform 404 across valid and previously-working symbols (incl. `nvda.us`, `^spx`) rules out symbol-mapping errors. Most likely: Stooq now serves 404 (rather than 403/challenge) to the request pattern coming from GitHub-hosted runner IPs (Azure ranges) — either per-request bot scoring (24 rapid CSV hits, concurrency 6, no cookies/Referer) or a block of the `/q/l/` path for datacenter IPs. Stooq already captcha-gated the history endpoint (`q/d/l/`, per the comment at scrape-quotes.mjs:69-74), so tightening the quote endpoint is consistent behavior. **Confidence: medium** (mechanism certain from logs; bot-scoring-vs-IP-block attribution unverifiable from this sandbox).

**Yahoo v8 chart — HTTP 429 on ~27/27 despite concurrency 2 + 400 ms gaps; occasionally exactly 1 symbol succeeds (NDX on 08-05 and 08-17).** The existing throttle is already conservative, and 429s hit from the first request of the run — so this is **IP-reputation rate limiting of shared Azure/GitHub-runner egress IPs, plus Yahoo's cookie gating** (requests carry no Yahoo `A1/A3` cookie; anonymous datacenter traffic gets near-zero quota). Request pacing inside one run cannot fix a reputation/cookie problem; only fewer requests + a session cookie can. **Confidence: high** for "not request-rate, it's per-IP/session quota"; medium that a cookie + batching lifts it enough.

**NASDAQ — healthy** (23/23 attempted symbols, with prevClose). Not a root cause; do not touch.

**Net effect:** only one live source per symbol → `verified` (needs ≥2 within 0.2%) is impossible for all 23 covered symbols, and SPX/VIX/DXY/US10Y have **zero** live sources (stooq-skip + nasdaq-skip + yahoo dead) — they've been silently carry-forwarding prices since ≥08-05. (Note: `USDKRW` is named in NASDAQ_SKIP but is **not currently in `data/tickers-universe.json`** — universe is 22 tickers + SPX/NDX/VIX/DXY/US10Y = 27.)

---

## 2. Chosen fix, ordered by expected impact

### Fix A (highest impact) — add Cboe delayed-quotes CDN as a new independent source

This immediately restores `verified=true` for all 22 equities + NDX (pairing with the already-healthy NASDAQ source) and gives SPX/VIX their first live source, without depending on rescuing either broken source.

- **URL shape:** `https://cdn.cboe.com/api/global/delayed_quotes/quotes/{SYM}.json`
  - Indices are underscore-prefixed: `_SPX`, `_NDX`, `_VIX` (also try `_TNX` for US10Y — Cboe owns the TNX index; validate in CI, see §4).
  - Equities: plain uppercase, e.g. `NVDA.json`, `GOOGL.json` (15-min-delayed consolidated tape).
- **Parsing:** JSON body → `data.current_price` (number), `data.prev_day_close`, `data.price_change`, `data.price_change_percent`. Map to the existing `{price, change, changePct, prevClose}` shape.
- **Headers:** existing `UA` const + `Accept: application/json` + `Referer: https://www.cboe.com/`. It's a public CDN (CloudFront) — bot pressure is low.
- **Concurrency/timeout:** `new Semaphore(4)`, existing `withTimeout(…, TIMEOUT_MS)` (8 s), **1 retry** after 2 s on 5xx/network error only (no retry on 404 = symbol not covered).
- **Delay caveat handled by schedule:** both cron slots (11:00 UTC pre-market, 21:00 UTC = close+30 min... 21:00 UTC is 17:00 ET, 1 h after close) are outside RTH, so a 15-min-delayed quote equals the same settled price NASDAQ reports — well inside 0.2 %.
- **Wiring:** add `cboeMap` alongside the three existing maps; add `perSource.cboe`; include in `perSourceRaw.cboe` in the raw drop; add `'cboe'` to the output `sources` array; slot Cboe's `prev_day_close` into the prevClose chain after NASDAQ. Per repo convention, document the new `perSource.cboe` key in `data/README.md`.

### Fix B — make the `verified` check "any-two-agree" instead of "all-in-range"

The current check (scrape-quotes.mjs:245-252) takes min/max across **all** sources — one stale/outlier source would un-verify a symbol that two good sources agree on. With 3–4 sources this becomes the binding bug. Replace with: `verified = true` iff **any pair** of distinct sources satisfies `|a−b|/min(a,b) ≤ 0.002`. This is the faithful implementation of the stated contract ("≥2 independent sources agreeing within tolerance") and keeps the output shape (`verified`, `sourceCount`, `perSource`, `tolerance: 0.002`) byte-compatible.

### Fix C — Yahoo: batch via v7 spark + cookie warm-up + host rotation + real backoff

Cut request count from 27 to 2 and attach a session cookie — attacking both halves of the 429 cause.

- **Warm-up (once per run):** `GET https://fc.yahoo.com/` with the browser UA; ignore the 404 body, capture the `Set-Cookie` (`A3`/`A1`) header(s); reuse as `Cookie:` on all Yahoo requests. Pure stdlib (`res.headers.getSetCookie()` on Node 20).
- **Batched endpoint:** `https://query1.finance.yahoo.com/v7/finance/spark?symbols=<comma-joined>&range=2d&interval=1d` — chunk the 27 mapped symbols (`^GSPC,^NDX,^VIX,DX-Y.NYB,^TNX,NVDA,…`) into **2 chunks of ≤14**. Parse `j.spark.result[i].symbol` + `j.spark.result[i].response[0].meta.{regularMarketPrice, previousClose ?? chartPreviousClose, regularMarketTime}` — same meta object the current `fetchYahooChartOne` reads, so the mapping code is reused.
- **Retry/backoff:** sequential chunks, 1 s gap; on 429/5xx retry up to **4 attempts** with backoff `2 s → 5 s → 10 s → 20 s` (±20 % jitter), alternating hosts `query1.finance.yahoo.com` ↔ `query2.finance.yahoo.com` per attempt. Worst case ≈ 2 × ~45 s — fine.
- **Fallback inside the run:** if spark returns 401/404 (endpoint gated), fall back to the existing per-symbol v8 chart fetch **with the warm-up cookie**, concurrency 1, gap 1500 ms, max 1 retry per symbol, and a hard phase deadline of **3 minutes** (`Date.now()` budget check) so the workflow's 8-minute timeout is never threatened. Yahoo becomes best-effort: any symbols it does land add a third/fourth verification leg (and the only live legs for DXY).

### Fix D — Stooq: single batched request + host fallback (rescue attempt, cheap)

- Replace the 24-request fan-out with **one request**: `https://stooq.com/q/l/?s=googl.us+cls.us+…+^spx+^ndx+usdkrw&f=sd2t2ohlcv&h&e=csv` — the `q/l/` endpoint accepts `+`-separated multi-symbol lists and returns one CSV row per symbol. Build the URL with a literal `+` join (do **not** `encodeURIComponent` the joined list; encode nothing — symbols are `[a-z0-9.^]`). Parse the multi-row CSV, matching the `Symbol` column case-insensitively back through a reverse of `stooqSymbol()`; treat `N/D` closes as per-symbol misses, not request failure.
- Headers: add `Referer: https://stooq.com/` and `Accept-Language: en-US,en;q=0.9` to the existing UA/Accept.
- On 404/403: retry once after 3 s on the mirror host `https://stooq.pl/q/l/?…` (same path/params). If both fail, log the single failure row and move on — Stooq drops to best-effort and the run no longer burns 24 requests on a dead source. Keep `STOOQ_SKIP` as-is.
- Also demote Stooq from first place in the `primary` selection chain (line 228) to **NASDAQ > Cboe > Stooq > Yahoo** — NASDAQ has been the empirically reliable source for a month and carries real prevClose.

### Fix E (index-gap filler, behind CI validation) — CNBC restQuote for DXY / US10Y

DXY and US10Y are the only symbols Fix A–D may leave single-source (see §5). One batched, key-less request covers them:

- **URL:** `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.DXY|US10Y|.SPX|.NDX|.VIX&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json` (symbols `|`-separated, URL-encoded as `%7C`).
- **Parsing:** `j.FormattedQuoteResult.FormattedQuote[]` → `{symbol, last, change, change_pct, previous_day_closing}`; strip `[$,%+]` with the same `parseNum` used for NASDAQ (values are comma-formatted strings).
- Ship it **indices-only** (one request, timeout 8 s, 1 retry), gated behind a branch `workflow_dispatch` run confirming shape/reachability from runner IPs before it participates in verification.

**Runtime budget after fix:** cboe ~27 req @ conc 4 (<60 s) + nasdaq unchanged (~90 s) + stooq 1–2 req + yahoo 2 req w/ worst-case backoff (~90 s) + cnbc 1 req ≈ **3–4 min worst case**, comfortably under the 8-minute job timeout.

---

## 3. What NOT to change

- **The NASDAQ fetch path** (`fetchNasdaqOne`, its 3-assetclass fallback, headers, skip set) — it is the only thing that has worked for a month. Surgical rule applies.
- **Output contract:** `data/price-quotes.json` top-level shape, per-symbol `{price, change, changePct, prevClose, verified, sourceCount, perSource, lastUpdated}`, `tolerance: 0.002`, the `perSource.kapture` merge (lines 287-297), and the all-sources-failed guard (`exit(2)`, lines 282-285). New source keys are additive only.
- **Raw-drop audit trail:** keep `reports/raw/YYYY-MM-DD-quotes.json` with `perSourceRaw` + `failures`; only add `cboe`/`cnbc` keys.
- **`verify-quotes.mjs` / comparator** — they consume `perSource`; additive keys are safe, semantics unchanged.
- **FV bands / valuations** — price refresh never touches them (evaluator-only).
- **No new UA spoofing beyond the existing Chrome UA const, no keys, no secrets, no npm deps** — everything above is Node 20 stdlib `fetch`.
- **`data/tickers-universe.json`** — do not add USDKRW as part of this fix; that's a separate scope decision.
- **Workflow cron/timeout** — unchanged; `workflow_dispatch` already exists for iteration.

---

## 4. Fallback plan (iterate via `workflow_dispatch` on branch `claude/scraper-fix-quotes`)

Sequence each run's raw drop tells us exactly which leg failed:

1. **Yahoo spark gated (401/`Invalid Crumb`):** do the full cookie+crumb dance — reuse the fc.yahoo.com cookie, `GET https://query2.finance.yahoo.com/v1/test/getcrumb` with it (returns a bare crumb string), then use the batched **v7 quote** endpoint `https://query1.finance.yahoo.com/v7/finance/quote?symbols=<comma-joined>&crumb=<crumb>` (fields `regularMarketPrice`, `regularMarketPreviousClose`). Still stdlib, still 2 requests.
2. **Yahoo unrecoverable from runner IPs:** accept it — mark Yahoo best-effort permanently. Verification then rests on NASDAQ+Cboe (23 symbols) + Cboe/CNBC (SPX/VIX) — still ≥25/27 verified. Record the decision in the script header comment + `SESSION_LOG.md`.
3. **`_TNX` / CNBC probe fails:** US10Y and DXY stay single-source (yahoo-only or carried). Last-resort *sanity* source for US10Y: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10` (key-less CSV, last row = latest yield) — but it is 1-business-day delayed, so use it only as a plausibility band, **never** for `verified=true` (would violate the 0.2 % contract on volatile days).
4. **Cboe CDN blocks runner IPs** (unlikely — public CDN): fall back to CNBC (Fix E) for indices and accept equities as NASDAQ+Yahoo-only pairs; if Yahoo is also dead, equities stay unverified and we escalate to considering a self-hosted/residential runner or a keyed source — an explicit conventions change, out of scope here.
5. **Stooq batched request still 404 on both hosts:** delete the rescue attempt in a follow-up, update the header comment (per the "header comments are authoritative" gotcha) and the `data/README.md` source list.

Acceptance gate per dispatch run: raw drop shows `verifiedCount ≥ 23/27`, no source phase >3 min, `verify-quotes.mjs` green, JSON-validate loop green. Two consecutive green dispatch runs → mark PR ready.

---

## 5. Risks

**Index coverage matrix (the core structural risk):**

| Symbol | stooq (if rescued) | nasdaq | yahoo (if rescued) | cboe (new) | cnbc (probe) |
|---|---|---|---|---|---|
| SPX | ✓ `^spx` | ✗ | ✓ `^GSPC` | ✓ `_SPX` | ✓ `.SPX` |
| NDX | ✓ `^ndx` | ✓ | ✓ `^NDX` | ✓ `_NDX` | ✓ `.NDX` |
| VIX | ✗ (N/D) | ✗ | ✓ `^VIX` | ✓ `_VIX` | ✓ `.VIX` |
| DXY | ✗ (N/D) | ✗ | ✓ `DX-Y.NYB` | ✗ (ICE index) | ✓ `.DXY` |
| US10Y | ✗ (N/D) | ✗ | ✓ `^TNX` | `_TNX` unverified | ✓ `US10Y` |
| USDKRW* | ✓ `usdkrw` | ✗ | ✓ `KRW=X` | ✗ | ✓ `KRW=` |

*not currently in the universe. **DXY and US10Y are the fragile rows** — if Yahoo stays dead and CNBC fails validation, they remain single-source/carried and permanently `verified=false`; the dashboard must keep tolerating that (it already does — they've been carried since 08-05).

- **Cboe↔NASDAQ independence:** both ultimately read the consolidated tape, but they are operationally independent (different operators, infra, failure modes) — consistent with how stooq/yahoo were treated as independent. Flag in `data/README.md` so the validator convention stays honest.
- **US10Y unit mismatch:** Yahoo `^TNX` vs Cboe `_TNX` vs CNBC `US10Y` may report yield×10 vs yield — a 10× disagreement would (correctly) fail the 0.2 % check rather than corrupt data, but would silently keep US10Y unverified; check units explicitly in the first dispatch run.
- **Cboe 15-min delay:** safe at both cron slots, but a future intraday `workflow_dispatch` during RTH could see Cboe-vs-NASDAQ drift >0.2 % on fast movers → sporadic unverified symbols. Acceptable; note in header comment.
- **CNBC endpoint is unofficial** (partner API, no SLA, sketchier ToS posture than Cboe's CDN) — that's why it's indices-only and probe-gated, and why Cboe is the primary new source.
- **Yahoo cookie warm-up may itself get blocked** for runner IPs; the design degrades gracefully (Yahoo best-effort) rather than failing the run.
- **Any-pair verification (Fix B) slightly loosens semantics** vs all-in-range when ≥3 sources disagree: two colluding-stale sources could verify against a moved third. Mitigated by non-RTH cron timing and 0.2 % tightness; it is also the literal contract as documented.
- **Bot-detection whack-a-mole:** the same forces that killed stooq/yahoo can hit Cboe/CNBC later. Mitigation is architectural: after this fix the pipeline has 3–5 legs and the `exit(2)` guard, so any single-source death degrades verification, not data integrity.
