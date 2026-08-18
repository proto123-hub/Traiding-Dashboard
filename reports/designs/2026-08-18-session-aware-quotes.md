# Design — session-aware quote pipeline (nasdaq + cboe + cnbc)

Grounded in `reports/validation/2026-08-18-source-probe.md` (CI ground truth),
`reports/designs/2026-08-18-scraper-fix.md` (superseded design — Fix A "add
Cboe" and Fix B "any-pair verify" landed and stay; Fix C/D "rescue
Yahoo/Stooq" are now known-wrong; Fix E "CNBC indices-only" is superseded by
promoting CNBC to full coverage), `scripts/scrape-quotes.mjs`,
`scripts/verify-quotes.mjs`, `scripts/lib/io.mjs`, `data/README.md`,
`data/tickers-universe.json`, `index.html` `bootValuations()` (L975-1047),
`.claude/agents/comparator.md`, and the live `data/price-quotes.json` /
`reports/raw/2026-08-18-quotes.json` (which currently shows the bug live:
`GOOGL` `nasdaq: 342.15` — a pre-market print — compared against
`cboe: 343.88` — the prior close — `verified: false`).

**Root cause recap (do not relitigate):** during the 11:00 UTC pre-market
cron, NASDAQ's `primaryData` is a live pre-market print while Cboe only has
regular-session data — a category error, not a tolerance problem. Read
like-for-like (Cboe `close` vs NASDAQ `secondaryData`), all three sources
agree almost exactly (MRVL 234.33 / 234.33 / 234.33).

---

## 1. Session-aware extraction

Every adapter returns a `{ regular, extended }` pair (`extended` may be
`null`). `regular` is the official close of the **last completed** regular
session; `extended` is a live pre/after-hours (or, for NASDAQ during RTH,
live-intraday) print, tagged with `sessionType`. The two are **never**
compared against each other for verification — only `regular` vs `regular`,
and `extended` vs `extended`.

### 1a. Cboe — read `close`, not `current_price`

```js
function extractCboeSession(sym, j) {
  const d = j?.data;
  if (!d || d.close == null) throw new Error('cboe:no_close');
  let price = d.close;                      // OFFICIAL consolidated close — NOT current_price
  let prevClose = d.prev_day_close ?? null;
  if (sym === 'US10Y') {                    // _TNX degenerate feed — see §5
    price = normalizeCboeYield(price);
    prevClose = prevClose != null ? normalizeCboeYield(prevClose) : null;
  }
  const change = prevClose != null ? +(price - prevClose).toFixed(4) : null;
  const changePct = (prevClose != null && prevClose !== 0)
    ? +((change / prevClose) * 100).toFixed(4) : null;
  return {
    regular: {
      price, prevClose, change, changePct,
      // _TNX's last_trade_time is a degenerate 00:00:00 stamp — don't trust it for sessionDate
      sessionDate: sym === 'US10Y' ? null : parseIsoDatePrefix(d.last_trade_time),
    },
    extended: null,   // Cboe carries NO pre/post-market data at all — never populate this
  };
}
```

`d.price_change` / `d.price_change_percent` are **never read** — they belong
to `current_price`'s session (Cboe's own venue print, stamped one second
before the closing auction), not to `close`. `change`/`changePct` are always
self-derived from `close` vs `prev_day_close`.

### 1b. NASDAQ — `isRealTime` gates primary vs secondary, not `marketStatus` alone

```js
const MARKET_STATUS_MAP = {
  'Pre-Market':  'pre-market',
  'Market Open': 'intraday',    // UNTESTED — see acceptance gates §7, neither cron slot hits RTH
  'After Hours': 'after-hours',
  'Closed':      'closed',
};

function extractNasdaqSession(j) {
  const status = j?.data?.marketStatus;
  const sessionType = MARKET_STATUS_MAP[status] || null;
  const sd = j?.data?.secondaryData;   // ALWAYS the last completed regular-session close
  const pd = j?.data?.primaryData;     // live print only when isRealTime === true

  const regular = (sd?.lastSalePrice != null) ? {
    price: parseNum(sd.lastSalePrice),
    prevClose: null,   // secondaryData carries no paired prevClose — see prevClose-chain note below
    sessionDate: parseNasdaqDate(sd.lastTradeTimestamp),  // strips optional "Closed at " prefix
  } : null;

  const extended = (pd?.isRealTime === true && pd?.lastSalePrice != null) ? {
    price: parseNum(pd.lastSalePrice),
    sessionType,
  } : null;   // omitted whenever isRealTime is false/absent — covers the "Closed" state where
              // primaryData mirrors secondaryData with isRealTime:false (nothing to show as "live")

  return { marketStatus: status, sessionType, regular, extended };
}
```

**Mapping table (every observed `marketStatus` value):**

| `marketStatus` | `regular` comes from | `regular` session semantics | `extended` present? | `extended` comes from | `sessionType` |
|---|---|---|---|---|---|
| `"Pre-Market"` | `secondaryData.lastSalePrice` | yesterday's completed close | yes | `primaryData.lastSalePrice` (`isRealTime:true`) | `"pre-market"` |
| `"Market Open"` (intraday) | `secondaryData.lastSalePrice` **if present**; if NASDAQ omits `secondaryData` mid-session (unconfirmed — no probe evidence), `regular` is unavailable from NASDAQ this cycle and the symbol falls through to Cboe/CNBC's `prev_day_close`/`previous_day_closing` for `regular` | yesterday's completed close (the CURRENT session hasn't closed yet, so there is no "today" regular value to read) | yes — this is the running regular-session trade itself | `primaryData.lastSalePrice` (`isRealTime:true`) | `"intraday"` — deliberately treated as `extended`, not `regular`: an in-progress session has no settled close yet, so it carries the same "not yet official" status as a pre/post-market print, even though colloquially it isn't "extended hours" |
| `"After Hours"` | `secondaryData.lastSalePrice`, now labeled "Closed at `<today>` 4:00 PM ET" | **today's** just-completed close | yes | `primaryData.lastSalePrice` (`isRealTime:true`) | `"after-hours"` |
| `"Closed"` | `secondaryData.lastSalePrice` (most recent completed session, e.g. Friday's close on a weekend) | most recent completed session | no — `primaryData.isRealTime` is `false` in this state (mirrors `secondaryData`, nothing separately "live" to show) | — | — (field omitted entirely) |

The **`isRealTime` flag, not the `marketStatus` string, is the actual gate**
for `extended`: `extended` is populated iff `primaryData.isRealTime === true`.
This one rule covers all four rows uniformly and needs no per-status
branching for that decision — only `sessionType` (the *label*) is looked up
from `marketStatus`.

**Assumption flagged for the builder:** the probe payload for `secondaryData`
only showed `{lastSalePrice, lastTradeTimestamp, isRealTime}` — no
`netChange`/`percentageChange`. Do not assume those fields exist on
`secondaryData`; `regular.prevClose` is deliberately left `null` from NASDAQ
and resolved later from Cboe/CNBC in the merge step (see §2 prevClose
chain). If the first CI dispatch shows `secondaryData` *does* carry a change
field, that's a future optimization, not required here.

**`"Market Open"` row is inferred, not probed** — neither cron slot
(11:00 UTC pre-market, 21:00 UTC after-hours) ever puts NASDAQ in this
state. Validate via a manual `workflow_dispatch` run during RTH (13:30–20:00
UTC weekdays) before fully trusting it; see falsification criteria in §7.

### 1c. CNBC — session-tagged natively, now first-class for equities too

```js
function cnbcSymbol(sym) {
  const map = { SPX: '.SPX', NDX: '.NDX', VIX: '.VIX', DXY: '.DXY', US10Y: 'US10Y' };
  return map[sym] || sym;   // equities/ETFs: bare symbol, e.g. "SOXL", "GOOGL"
}

function extractCnbcSession(row) {
  const price = parseCnbcNum(row.last);
  const regular = (price != null) ? {
    price,
    prevClose: parseCnbcNum(row.previous_day_closing),
    change: parseCnbcNum(row.change),          // unchanged from current code — CNBC's own top-level
    changePct: parseCnbcNum(row.change_pct),   // fields, already validated in production drops
    sessionDate: row.last_time || null,        // probe shows this is already "YYYY-MM-DD"
  } : null;

  const ext = row.ExtendedMktQuote;
  const extended = (ext && ext.last != null) ? {
    price: parseCnbcNum(ext.last),
    sessionType: mapCnbcExtType(ext.type),
  } : null;   // omitted when ExtendedMktQuote is absent (no live extended print this cycle)

  return { curmktstatus: row.curmktstatus, regular, extended };
}

function mapCnbcExtType(type) {
  if (type === 'PRE_MKT') return 'pre-market';                          // confirmed by probe
  if (type === 'AFTER_HOURS' || type === 'POST_MKT') return 'after-hours'; // UNCONFIRMED — validate on first post-close dispatch
  return 'intraday';
}
```

CNBC's own `change`/`change_pct` top-level fields are used as-is for
`regular` (matches current, already-working code — do not re-derive; a spot
check against `previous_day_closing` in production drops shows the vendor's
own field is sometimes more trustworthy than a same-value
`last`/`previous_day_closing` pair, which does occasionally coincide during
pre-market runs). `ExtendedMktQuote.change`/`change_pct`, by contrast, are
**not read** — the clean schema's `extended.changePct` is self-derived
against the row's own verified `price` in the merge step (§2), so it stays
internally consistent regardless of which source wins the extended slot.

---

## 2. Schema — `data/price-quotes.json`

`quotes[sym].price` / `.changePct` / `.verified` keep their exact key names
(`index.html` reads only these three — confirmed, no other field of
`quotes[sym]` is read anywhere in `index.html`) but their **meaning is now
precise**: `price` is the verified (or best-available) **official
regular-session close**, never a live/extended print. `changePct` is the
close-over-close day change. `verified` is unchanged semantics (any-pair
agreement, Fix B), now class-aware (§3).

```jsonc
{
  "note": "Owned by refresher agent + GitHub Actions data-refresh workflow. Sources: NASDAQ public API (primary) + Cboe delayed-quotes CDN (secondary) + CNBC restQuote (tertiary, full coverage) — see scripts/scrape-quotes.mjs header for the 2026-08-18 session-aware redesign and the Yahoo/Stooq removal rationale. quotes[sym].price/changePct/verified describe the official REGULAR-SESSION close only; a live pre/after-hours (or intraday) print, when available, is reported separately under quotes[sym].extended and is NEVER blended into the verified close. Kapture (TradingView) imports merge into perSource.kapture (regular only).",
  "updated": "2026-08-18T21:05:00Z",
  "asOfDate": "2026-08-18",
  "agent": "refresher",
  "sources": ["nasdaq", "cboe", "cnbc"],
  "session": "after-hours",              // NEW — market phase at scrape time: "pre-market" | "intraday" | "after-hours" | "closed"
  "tolerance": 0.002,                    // UNCHANGED scalar, kept for back-compat — equals toleranceByClass.equity, the default
  "toleranceByClass": {                  // NEW, additive — implements comparator.md's documented-but-unimplemented classes
    "equity": 0.002,                     // equities + ETFs (SOXL, TSMU included)
    "index": 0.005,                      // SPX/NDX/VIX/DXY/US10Y
    "fx": 0.001                          // reserved — no FX symbol in tickers-universe.json yet
  },
  "quotes": {
    "GOOGL": {
      "price": 344.00,                   // verified OFFICIAL close of regularSessionDate — never a live print
      "change": 7.04,
      "changePct": 2.12,
      "prevClose": 336.96,
      "regularSessionDate": "2026-08-17", // NEW — which completed session `price` belongs to (diagnostic; not verification-load-bearing — a parse miss leaves this null, never wrong)
      "verified": true,
      "sourceCount": 2,
      "assetClass": "equity",            // NEW — which toleranceByClass entry applied
      "perSource": { "nasdaq": 344.00, "cboe": 344.00, "kapture": 344.00 },  // UNCHANGED shape (symbol→number); now always regular-only values
      "lastUpdated": "2026-08-18T21:04:58Z",
      "extended": {                      // NEW, OPTIONAL — present only when ≥1 source has a live print this run
        "price": 342.15,
        "changePct": -0.54,              // self-derived vs the row's own verified `price`, not trusted from any single source
        "verified": false,               // pairwise-verified across extended-only perSource entries, same assetClass tolerance
        "sessionType": "pre-market",     // "pre-market" | "intraday" | "after-hours"
        "perSource": { "nasdaq": 342.15 }
      }
    },
    "DXY": {
      "price": 97.87, "change": 0.12, "changePct": 0.12, "prevClose": 97.75,
      "regularSessionDate": "2026-08-17",
      "verified": false,                 // single-source — see §4, DXY has no second source
      "sourceCount": 1,
      "assetClass": "index",
      "perSource": { "cnbc": 97.87 },
      "lastUpdated": "2026-08-18T21:04:58Z"
      // no "extended" key — CNBC's DXY row had no ExtendedMktQuote this cycle
    }
  },
  "failures": [
    { "symbol": "TSMU", "source": "cnbc", "reason": "cnbc:not_found" }   // per-symbol miss inside the batched CNBC response — same audit pattern as before
  ]
}
```

`extended` is a **sibling** of `perSource`, not a replacement — the existing
`quotes[sym].perSource` contract (flat `source → number`) is untouched byte-
for-byte in shape; `extended.perSource` is a new, separate flat map of the
same shape. Kapture imports are **not** wired into `extended` — out of
scope, deferred (kapture merge logic stays exactly as-is, regular-only).

### `data/README.md` delta

Replace the `### price-quotes.json` section (current lines 327–363) with:

~~~markdown
### price-quotes.json
Refreshed by `.github/workflows/data-refresh.yml` (cron 21:00 UTC + 11:00 UTC on
weekdays) and merged into `v3.seedQuotes` by the dashboard at boot and on Refresh.
Sources (see `scripts/scrape-quotes.mjs` header comment for the authoritative
rationale/rate parameters — Yahoo and Stooq were removed 2026-08-18, both
structurally dead from runner IPs, see the header tombstone): **NASDAQ**
public API (primary), **Cboe** delayed-quotes CDN (secondary), **CNBC**
restQuote (tertiary, full coverage — equities, ETFs, and indices), plus
manual **Kapture** imports merged into `perSource.kapture`. `verified: true`
iff ANY PAIR of distinct `perSource` values agrees within the symbol's
class-resolved tolerance (see `toleranceByClass`) — not all sources.

**Session-aware since 2026-08-18** (`reports/designs/2026-08-18-session-aware-quotes.md`):
`quotes[sym].price`/`.changePct`/`.verified` describe ONLY the official
**regular-session close** — never a live pre/after-hours print. A live print,
when available, is reported separately under the optional `quotes[sym].extended`
block and is verified independently; it is never blended into the close
comparison. `quotes[sym].regularSessionDate` states which completed session
`price` belongs to (diagnostic only — a parse miss leaves it `null`, it never
silently mislabels a session). Top-level `session` states the market phase at
scrape time (`"pre-market"|"intraday"|"after-hours"|"closed"`).

Note: Cboe and NASDAQ are operationally independent (different
operators/infra/failure modes) but both ultimately read the consolidated
tape, so their agreement is a weaker verification signal than two genuinely
distinct data pipelines; CNBC is a distinct, unofficial partner feed with no
SLA, kept in the priority chain last for primary-price selection even though
it participates fully in verification.

```jsonc
{
  "updated": "2026-08-18T21:05:00Z",   // ISO timestamp of last successful run
  "asOfDate": "2026-08-18",            // YYYY-MM-DD of the scrape run
  "agent": "refresher",
  "sources": ["nasdaq", "cboe", "cnbc"],
  "session": "after-hours",            // market phase at scrape time
  "tolerance": 0.002,                  // back-compat scalar = toleranceByClass.equity
  "toleranceByClass": { "equity": 0.002, "index": 0.005, "fx": 0.001 },
  "quotes": {
    "GOOGL": {
      "price": 344.00,
      "change": 7.04,
      "changePct": 2.12,
      "prevClose": 336.96,
      "regularSessionDate": "2026-08-17",
      "verified": true,
      "sourceCount": 2,
      "assetClass": "equity",
      "perSource": { "nasdaq": 344.00, "cboe": 344.00, "kapture": 344.00 },
      "lastUpdated": "2026-08-18T21:04:58Z",
      "extended": {                     // optional — omitted when no live print exists this cycle
        "price": 342.15,
        "changePct": -0.54,
        "verified": false,
        "sessionType": "pre-market",
        "perSource": { "nasdaq": 342.15 }
      }
    }
  },
  "failures": [
    { "symbol": "TSMU", "source": "cnbc", "reason": "cnbc:not_found" }
  ]
}
```
~~~

Also append one clause to the boot-order "Required" list entry (line 43):
`- \`data/price-quotes.json\`    — price + changePct + verified (+ optional
extended{} block, not yet consumed by index.html — see §6)`.

### `reports/raw/YYYY-MM-DD-quotes.json` delta (additive only, per constraint)

Existing flat per-symbol fields (`price`/`change`/`changePct`/`prevClose`)
under each `perSourceRaw.<source>[sym]` are **kept** (now representing the
correct regular-session values instead of the buggy live print) — new keys
are added alongside, never replacing:

```jsonc
"perSourceRaw": {
  "nasdaq": {
    "GOOGL": {
      "price": 344.00, "change": null, "changePct": null, "prevClose": null,
      "marketStatus": "Pre-Market",
      "regularSessionDate": "2026-08-17",
      "extended": { "price": 342.15, "sessionType": "pre-market" }   // omitted key entirely when no live print
    }
  },
  "cboe": {
    "GOOGL": { "price": 344.00, "change": 7.04, "changePct": 2.12, "prevClose": 336.96, "regularSessionDate": "2026-08-17" }
    // cboe never has an "extended" key
  },
  "cnbc": {
    "SPX": {
      "price": 7745.06, "change": -40.7, "changePct": -0.52, "prevClose": 7745.06,
      "curmktstatus": "PRE_MKT",
      "regularSessionDate": "2026-08-17",
      "extended": { "price": 7712.30, "sessionType": "pre-market" }
    }
  }
}
```

`change`/`changePct` are `null` for NASDAQ's raw entry (that source no
longer supplies them directly, per §1b) — this is a legitimate, documented
`null`, not a bug; the row-level `change`/`changePct` in `data/price-quotes.json`
is computed in the merge step from whichever source's `prevClose` resolves
first.

---

## 3. Per-class tolerance (implements the comparator.md contract)

**Symbol → class mapping — derived from `tickers-universe.json`, not
duplicated as a hardcoded parallel list**, except for FX which has no
entries in the universe today:

```js
const FX_SYMBOLS = new Set(['USDKRW']);   // none currently in tickers-universe.json — reserved for a future addition; comparator.md documents 0.1% FX tolerance
const TOLERANCE_BY_CLASS = { equity: 0.002, index: 0.005, fx: 0.001 };

function classifySymbol(sym, indexSymbolSet) {
  if (FX_SYMBOLS.has(sym)) return 'fx';
  if (indexSymbolSet.has(sym)) return 'index';   // indexSymbolSet = new Set(universe.indices.map(t => t.symbol)) — SPX/NDX/VIX/DXY/US10Y
  return 'equity';   // includes ETFs (SOXL, TSMU) — comparator.md groups ETFs with equities at 0.2%
}
```

Why derive from `universe.indices` instead of `sector-map.json`:
`sector-map.json` classifies by *sector/theme*, not *asset class* — it has
no equity-vs-index-vs-FX dimension and doesn't cover the 5 index symbols at
all (they're not in the 22-ticker watchlist). `tickers-universe.json` is
already loaded in `main()` and already partitions the universe into
`tickers[]` (equities/ETFs) vs `indices[]` (macro) — reusing that split is
zero-cost and can't drift out of sync with the watchlist. FX has zero
current members, so it stays an explicit override set in the script; adding
an `assetClass` field to `tickers-universe.json` itself would be a cleaner
long-term home but is out of scope here (surgical-change rule) — noted as a
future idea, not implemented.

**Where `tolerance` is represented in the output:** top-level `tolerance`
(scalar) is **kept unchanged** for back-compat — grep confirms the *only*
reader anywhere in the repo is `scripts/verify-quotes.mjs:28`
(`pq.tolerance ?? 0.002`), which this design also updates (below), and
`index.html` never reads `tolerance` at all. A new top-level
`toleranceByClass` object is added (additive), and each `quotes[sym]` gets a
new `assetClass` field so a reader can resolve `toleranceByClass[assetClass]`
without re-deriving it. Classification happens **once**, in
`scrape-quotes.mjs` (which already has `universe` in scope); it is **not**
re-derived in `verify-quotes.mjs` — that script just reads the already-
stamped `row.assetClass`:

```js
// verify-quotes.mjs — pq.toleranceByClass falls back to a synthesized map for old files
const toleranceByClass = pq.toleranceByClass || { equity: pq.tolerance ?? 0.002, index: 0.005, fx: 0.001 };

for (const [sym, row] of Object.entries(pq.quotes || {})) {
  const cls = row.assetClass || 'equity';
  const tolerance = toleranceByClass[cls] ?? pq.tolerance ?? 0.002;
  // ... existing pairwiseVerify(...) call now uses this class-resolved tolerance
  // compare[] entries gain an additive `assetClass: cls` field

  if (row.extended?.perSource) {
    const entries = Object.entries(row.extended.perSource).filter(([, v]) => v != null);
    if (entries.length >= 2) {
      const { verified: extOk, minDelta } = pairwiseVerify(Object.fromEntries(entries), tolerance);
      row.extended.verified = extOk;
      compare.push({ symbol: sym, scope: 'extended', status: extOk ? 'verified' : 'mismatch', deltaPct: minDelta, tolerance, assetClass: cls, sources: Object.fromEntries(entries) });
    } else if (row.extended) {
      row.extended.verified = false;
    }
  }
}
```

`compare[]` entries (in `reports/validation/YYYY-MM-DD-compare.json`, a
write-only audit artifact with no downstream reader) gain `assetClass` and,
for extended rows, `scope: 'extended'` — both additive.

---

## 4. Source roster after the probe

**Delete Yahoo and Stooq outright** (not "dormant behind a flag") —
both are structurally gone (429 from runner IPs even with a warmed cookie on
both hosts; branded Stooq 404 on every path variant including the `.pl`
mirror), and keeping dead code around invites someone to "fix" it again
without re-probing. Remove: `fetchStooqBatch`, `stooqSymbol`, `STOOQ_SKIP`,
`yahooWarmupCookie`, `fetchYahooSparkChunk`, `fetchYahooChartOne(WithRetry)`,
`yahooSymbol`, `yahooMetaToQuote`, `jitterMs`, the Yahoo/Stooq fan-out blocks
in `main()`, and `'stooq'`/`'yahoo'` from the `sources` array and
`data/README.md`. Replace the file's header comment (lines 2–57) with:

```js
// Scrape quote table from NASDAQ public API (primary) + Cboe delayed-quotes
// CDN (secondary) + CNBC restQuote (tertiary, full coverage). Session-aware
// since 2026-08-18: each adapter returns { regular, extended } — regular is
// the official close of the last COMPLETED session, extended is a live
// pre/after-hours (or intraday) print, tagged with sessionType. The two are
// never compared against each other for verification. See
// reports/designs/2026-08-18-session-aware-quotes.md for the full design.
//
// SOURCE HISTORY — Yahoo and Stooq were REMOVED 2026-08-18 (see
// reports/validation/2026-08-18-source-probe.md for raw evidence, captured
// from a GitHub Actions runner IP via scripts/probe-sources.mjs):
// - Yahoo v7 spark AND v8 chart both returned HTTP 429 on the FIRST request
//   of the run, from a freshly warmed fc.yahoo.com session cookie, on both
//   query1/query2 hosts — per-IP reputation blocking of GitHub-runner
//   egress ranges, not a pacing problem. Structurally dead; do not
//   re-attempt without a non-datacenter egress IP or a paid feed.
// - Stooq's q/l/ endpoint (single AND batched) returned a branded Stooq 404
//   page ("page you requested does not exist") on stooq.com AND the
//   stooq.pl mirror — a styled 404 from Stooq's own template means the path
//   itself is gone, not that we're being fingerprinted. Structurally dead.
// Roster is now NASDAQ + Cboe + CNBC — all key-less, all cover the full
// 27-symbol universe except DXY (single-source, CNBC-only — see the
// coverage table below). If a future probe finds Yahoo/Stooq alive again,
// re-add behind the same probe-then-integrate discipline; don't restore the
// old code from git history blind — it also read the wrong NASDAQ/Cboe
// fields (see the session-aware-quotes design, root-cause section).
//
// Why the previous "Fix A–E" design's C/D (rescue Yahoo/Stooq) turned out
// wrong and E (CNBC indices-only) turned out unnecessarily narrow: see
// reports/validation/2026-08-18-source-probe.md §5/§6 (dead sources) and
// §3 (CNBC covers equities cleanly, not just indices).
//
// Rate parameters: Cboe conc 4, 8s timeout, 1 retry (2s) on 5xx/network only
// (no retry on 404 = symbol not covered). NASDAQ: unchanged (concurrency 3,
// 3-assetclass fallback, 16s timeout). CNBC: ONE batched request covering
// all 27 symbols, 8s timeout, 1 retry. Expected runtime ≈2 min worst case
// (well under the 8-minute job timeout and the 5-minute design budget) —
// removing Yahoo's up-to-90s backoff phase and Stooq's mirror-retry phase
// is the main saving.
```

Update the workflow step display name in `.github/workflows/data-refresh.yml`
from `"Scrape quotes (nasdaq+cboe+stooq+yahoo)"` to
`"Scrape quotes (nasdaq+cboe+cnbc)"` — cosmetic, one line, no behavior
change. The `"TEMP probe sources"` step is a separate, already-repurposed
probe (now targeting fundamentals per its own header) — leave it untouched,
out of scope here.

**Promote CNBC to full coverage** (equities + ETFs + indices, not just the 5
indices) — the probe's SOXL example proves CNBC covers equities cleanly with
native session tagging. Expand `CNBC_SYMBOL_MAP` to cover all 27 symbols via
`cnbcSymbol()` (§1c) and fetch them in **one** batched request (URL length
for 27 symbols ≈200 chars, trivially fine — no need to chunk like the
removed Yahoo code did). Per-symbol misses inside the batch response are
recorded as `failures.push({symbol, source:'cnbc', reason:'cnbc:not_found'})`
— same audit pattern as the old Stooq per-symbol-miss handling — rather than
failing the whole request. **This equity-coverage expansion is inferred
from a single symbol (SOXL) in the probe** — watch the first CI dispatch for
any symbol silently missing from CNBC's response; if the batch endpoint
turns out to cap symbol count, split into 2 chunks of ~14 (trivial follow-up,
not implemented pre-emptively per Simplicity First).

**Primary-price selection chain** (unchanged pattern, sources removed):
`primary = nasdaq.regular ?? cboe.regular ?? cnbc.regular` — NASDAQ stays
first (longest track record, genuine historical reliability), Cboe second
(public CDN), CNBC last (unofficial partner API, no SLA) **for primary-price
selection only** — CNBC still participates fully in `perSource`/`verified`.

**Per-symbol coverage, all 27 universe symbols:**

| Symbol(s) | NASDAQ | Cboe | CNBC |
|---|---|---|---|
| 22 tickers (GOOGL, CLS, AVGO, MRVL, MU, TSM, PLTR, TSMU, NVDA, AMD, ARM, AMAT, LRCX, KLAC, MSFT, META, TSLA, ORCL, SNOW, CRWD, INTC, SOXL) | ✓ (3-assetclass fallback, untouched) | ✓ (plain uppercase) | ✓ (bare symbol, NEW) |
| NDX | ✓ | ✓ `_NDX` | ✓ `.NDX` |
| SPX | ✗ (`NASDAQ_SKIP`) | ✓ `_SPX` | ✓ `.SPX` |
| VIX | ✗ (`NASDAQ_SKIP`) | ✓ `_VIX` | ✓ `.VIX` |
| US10Y | ✗ (`NASDAQ_SKIP`) | ✓ `_TNX` (guarded ÷10, §5) | ✓ `US10Y` |
| **DXY** | ✗ (`NASDAQ_SKIP`) | ✗ (`CBOE_SKIP` — ICE-listed, not on Cboe's tape) | ✓ `.DXY` |

**Remaining single-source symbol: DXY only.** Every other symbol now has ≥2
sources (equities/NDX: 3-way NASDAQ+Cboe+CNBC; SPX/VIX/US10Y: 2-way
Cboe+CNBC). This is a strict improvement — previously SPX/VIX/US10Y/DXY were
all effectively single-source-or-carried; now only DXY remains so, and
US10Y gets its first-ever cross-source verification (§5).

---

## 5. US10Y normalization (Cboe `_TNX`)

Cboe's `_TNX` reports yield×10 with zeroed OHLC (`{current_price:47.24,
close:47.24, prev_day_close:47.24, open:0, high:0, low:0, volume:0}`).
Normalize with a **guarded** divide, not an unconditional one:

```js
function normalizeCboeYield(raw) {
  // Guarded: only divide when the raw value is implausible as a direct
  // yield (realistic US10Y range is roughly 0-20%). Protects against silent
  // corruption if Cboe ever changes the feed to report the yield directly —
  // an unconditional ÷10 would then quietly halve a correct number instead
  // of failing loud.
  return raw > 20 ? +(raw / 10).toFixed(4) : raw;
}
```

Applied to both `close` and `prev_day_close` before deriving `change`/
`changePct` (§1a) — never to `open`/`high`/`low`/`volume`, which stay
untouched/unused (degenerate zeros, not read for anything).

**Should `_TNX` be trusted at all?** Yes, as a verification-pairing
candidate with CNBC's `US10Y`, but flagged, not blindly: with the 0.5%
index/yield tolerance, normalized Cboe `4.724` vs CNBC `4.74` is **0.34%**
apart — inside tolerance, so US10Y would show `verified: true` for the first
time. The risk isn't the math, it's feed quality: a single-datapoint-derived
heuristic (÷10, guarded by a `>20` plausibility check) on a feed that is
otherwise completely degenerate (all-zero OHLC) could silently start
returning garbage without an obvious signal. Mitigation is the guard itself
(a format change that stops being "×10" would either pass through unchanged
if <20, or still divide correctly if the new value is still >20 and still
×10 — the guard only breaks silently in the narrow case where Cboe starts
reporting a *raw* yield >20%, which has never happened for US10Y and would
itself be a market-historic event) plus normal pairwise verification (if
Cboe's normalized value ever drifts from CNBC's, `verified` correctly flips
to `false` rather than corrupting the published price — NASDAQ never covers
US10Y, so there's no risk of a bad Cboe value winning `primary` unopposed;
CNBC is `primary` for US10Y whenever both report, per the priority chain).

---

## 6. Dashboard implications (documented, NOT implemented — deferred)

`index.html` needs **no change** to keep working — it reads only
`price`/`changePct`/`verified`, all preserved. Whether to surface `extended`
is a separate, deferred UI task. Recommendation for that future work,
minimal and honest:

- Render only when `quotes[sym].extended` exists, as a small secondary line
  next to the existing price cell — never replacing or blending into the
  verified close.
- Reuse the existing "single-source" convention already used for
  `analystVerified`/`peVerified` (index.html L1229, L1253-1254): dim text
  (`color:var(--faint)`, `font-size:10px`) with an explicit label when
  `extended.verified === false`, e.g. `프리마켓 -0.54% (단일소스)`; a slightly
  stronger treatment (still no new hex colors — `var(--amber)` /
  `var(--amber-soft)`, already used for warnings elsewhere in the sheet)
  only when `extended.verified === true`.
- ASCII mockup of the cell:
  ```
  $344.00  ▲2.12%           <- existing, unchanged (regular, verified)
  pre-mkt -0.54% (1-src)    <- new, dim, only if extended present
  ```
- **Hard rule carried into any future implementation:** never let an
  unverified (or even verified) `extended` value flow into the `price`,
  `changePct`, `verified`, `fvUpside`, or `trend` fields used elsewhere in
  `bootValuations()`/`deriveTrend()` — those must always resolve from the
  regular close only.
- Explicitly out of scope now: no Chart.js work, no new CSS variables, no
  index.html edit. This section exists so a future builder doesn't have to
  re-derive the convention from scratch.

---

## 7. Acceptance gates

**11:00 UTC (pre-market, ET ~07:00, NASDAQ `marketStatus: "Pre-Market"`,
CNBC `curmktstatus: "PRE_MKT"`):**
- `session: "pre-market"`.
- `regularSessionDate` for every symbol = **the previous trading day**
  (never today's date — that would mean the bug recurred).
- Expected verified: 26/27 (all except DXY). Equities+NDX: 3-source,
  should verify near-100%. SPX/VIX/US10Y: 2-source (Cboe+CNBC), expect
  verify ≥2/3 barring a genuine feed disagreement.
- `extended` present for symbols with a live pre-market print (NASDAQ
  `isRealTime:true` and/or CNBC `ExtendedMktQuote`) — informational only,
  `extended.verified` may legitimately be `false` more often (thinner
  pre-market liquidity → wider cross-venue spread) without failing the run.

**21:00 UTC (post-close, ET 17:00 = 1h after 16:00 close, NASDAQ
`marketStatus: "After Hours"`):**
- `session: "after-hours"`.
- `regularSessionDate` for every symbol = **today's date** (the session
  that just completed 1 hour ago) — this is the one slot where "today" in
  `regularSessionDate` is *correct*, not a bug; distinguish this from the
  pre-market slot's expectation above.
- Same 26/27 verified-symbol expectation as the pre-market slot.
- `extended` reflects the live after-hours print; expect it thinner/noisier
  than pre-market (lower AH volume), same "informational only" tolerance.

**`workflow_dispatch` during RTH (13:30–20:00 UTC weekdays) — not on the
cron schedule, but the only way to validate the `"Market Open"` row of the
NASDAQ table (§1b):** `session: "intraday"`, `regularSessionDate` = the
previous session (today hasn't closed yet), and NASDAQ's contribution to
`extended` should be populated (it's the running trade) while `regular`
should still resolve correctly from `secondaryData` (or fall through to
Cboe/CNBC if NASDAQ's `secondaryData` turns out to be absent mid-session —
the untested case flagged in §1b).

**What would falsify this design:**
1. `regularSessionDate` equals **today's date** on an 11:00 UTC pre-market
   run — means a live print was captured as `regular` again (the exact bug
   being fixed).
2. Verified count for the equity/NDX class drops below 20/23 on two
   consecutive dispatch runs — systemic session misalignment recurring.
3. `US10Y.verified` stays `false` for 3+ consecutive runs while both Cboe
   `_TNX` (normalized) and CNBC `US10Y` are present and historically ~0.3%
   apart — the ÷10 guard or CNBC's `US10Y` field likely broke.
4. Any symbol other than DXY shows `sourceCount === 1` for 2+ consecutive
   runs — means CNBC's equity-coverage promotion (§4) didn't hold for that
   symbol; check `failures[]` for a `cnbc:not_found` entry and consider it
   confirmed working only once `failures[]` stays empty for that symbol
   across a few runs.
5. `DXY.sourceCount > 1` unexpectedly — harmless, but flags CNBC schema
   drift or a stale `CBOE_SKIP`/`NASDAQ_SKIP` assumption worth re-probing.

---

## Backward compatibility summary

- `quotes[sym].price` / `.changePct` / `.verified` — same keys, same types,
  narrower/corrected meaning (regular-session close only). `index.html`
  needs zero changes.
- `quotes[sym].perSource` — same flat shape, same key names (`nasdaq`,
  `cboe`, `kapture`), `stooq`/`yahoo` keys simply stop appearing (their
  absence was already tolerated — the code only ever read whatever keys
  were present via `Object.keys(perSource).length`).
- Top-level `tolerance` — unchanged scalar, still the equity default; its
  only reader (`verify-quotes.mjs`) is updated in this same design.
- `sources` array — shrinks from 5 to 3 entries; nothing indexes into it by
  position, only iterates/displays it (not read by `index.html` at all).
- New fields (`session`, `toleranceByClass`, `regularSessionDate`,
  `assetClass`, `extended`) are all additive/optional — a consumer written
  against the pre-2026-08-18 schema keeps working unmodified.
- `reports/raw/*.json` — additive per §2; existing flat fields keep their
  names (now holding corrected values).
- `reports/validation/*.json` (`compare[]`) — additive `assetClass` and
  `scope` fields; nothing parses this file back in.

## Test plan

1. `node -e "JSON.parse(require('fs').readFileSync('data/price-quotes.json'))"`
   — and the same loop over `reports/raw/*.json` — must stay green (existing
   CI step, unchanged).
2. Syntax-check the inline scripts per the CLAUDE.md one-liner (N/A here —
   change is confined to `scripts/*.mjs`, not `index.html`).
3. `node scripts/scrape-quotes.mjs` via `workflow_dispatch` (sandbox cannot
   reach finance hosts — this MUST run in CI) at least once during each of:
   pre-market, after-hours, and (separately) RTH — confirms all four
   `marketStatus` rows in §1b, not just the two cron-scheduled ones.
4. `node scripts/verify-quotes.mjs` after each dispatch — confirm
   `verifiedCount` matches the §7 expectations and `reports/validation/YYYY-MM-DD-compare.json`
   shows `assetClass` per row and `scope:"extended"` rows where applicable.
5. Manually inspect one equity row and one index row in the resulting
   `data/price-quotes.json` for: `regularSessionDate` correctness per slot
   (§7), `assetClass` correctness, `extended` presence/absence matching
   whether a live print existed, and that `price`/`changePct` never equal a
   known live pre-market print during the 11:00 UTC slot.
6. Open the dashboard (`python3 -m http.server 8765`) and confirm the
   watchlist panel renders unchanged — price/change/verified badge — with no
   console errors, proving the additive schema didn't disturb `index.html`.
7. Two consecutive green `workflow_dispatch` runs (one pre-market-shaped,
   one after-hours-shaped) with no falsification triggers from §7 → mark
   ready.

## File-by-file change list (for the builder)

- `scripts/scrape-quotes.mjs` — replace header comment (§4); delete all
  Yahoo/Stooq code and constants; rewrite `fetchCboeQuoteOnce`/`fetchCboeOne`
  per §1a (incl. `normalizeCboeYield`, §5); rewrite `fetchNasdaqOne`'s
  post-fetch extraction per §1b (3-assetclass fallback loop itself
  untouched); expand `CNBC_SYMBOL_MAP`/`fetchCnbcIndicesOnce` to full
  27-symbol coverage per §1c/§4; add `classifySymbol`/`TOLERANCE_BY_CLASS`
  (§3); rewrite the `main()` merge loop per §2 (regular/extended split,
  `session` derivation, `regularSessionDate`, `assetClass`); update
  `sources` array and `note` string.
- `scripts/verify-quotes.mjs` — add class-resolved tolerance lookup and
  `extended.verified` re-stamping per §3.
- `data/README.md` — replace `### price-quotes.json` section per §2; append
  the one-line note to the boot-order "Required" list.
- `.github/workflows/data-refresh.yml` — cosmetic step-name rename only
  (§4); no other change.
- No changes to `index.html`, `data/tickers-universe.json`,
  `data/sector-map.json`, or the Kapture import path.
