# Design: Watchlist Live JSON Transition

**Date:** 2026-06-06
**Author:** architect agent
**Scope:** Replace `renderWatchlist()` (currently reading stale `MarketData.TICKERS` from `data.js`) with a live render that reads `data/price-quotes.json` and `data/tickers-universe.json`. No schema changes to existing JSON files. No changes to any other render function. `data.js` and `MarketData` remain intact for glance/regime/sectors/whales/triggers.

---

## 1. Problem Statement

The `#watchlist-body` table is rendered by `renderWatchlist()` at line 792 of `index.html`. It iterates `MarketData.TICKERS` — a 24-entry stale demo array in `data.js` that contains prices from an unknown date, includes tickers not in the live universe (RKLB, SPY, QQQ, QCOM), and excludes tickers that are in the live universe (SOXL, TSMU). Every 30-second `MarketData.tick()` call applies a random walk to those stale prices, making the dashboard actively misleading.

The live layer already exists:
- `data/price-quotes.json` — 22 equity tickers + macro indices, refreshed by GH Actions, current as of 2026-06-05
- `data/tickers-universe.json` — 22 tickers with `symbol`, `sector`, `held`, `theme`
- `data/portfolio-current.json` — held set (6 positions), already fetched by `bootValuations()`

The fix is surgical: rewire `renderWatchlist()` to consume these three files, remove it from `MarketData.subscribe()`, and keep every other render function unchanged.

---

## 2. Data Gap Analysis and Recommendation

### Gap table

| Column (current) | data.js source | Live source available | Gap? |
|------------------|---------------|-----------------------|------|
| Ticker (sym) | `t.sym` | `tickers-universe.json[].symbol` | None |
| Sector | `t.sector` (coarse: AI/Semi/Equip/Growth/Bench) | `tickers-universe.json[].sector` (fine-grained: Semis-Custom, MegaCap-Platform, etc.) | None — actually richer |
| Price | `t.price` (stale demo float) | `price-quotes.json.quotes[sym].price` | None |
| Chg% | `t.chg` (random-walked %) | `price-quotes.json.quotes[sym].changePct` | None |
| Volume | `t.vol` (string: "42M") | **Not in any live JSON** | **HARD GAP** |
| Mkt Cap | `t.mcap` (string: "182B") | **Not in any live JSON** | **HARD GAP** |
| Fwd P/E | `t.pe` (number or null) | **Not in any live JSON** | **HARD GAP** |
| Company name | `t.name` (e.g. "Palantir") | **Not in any live JSON** | **Soft gap** |

### Options

**Option A — Remove Volume/Mkt Cap/Fwd P/E columns.**
Drop the three ungapped columns from the `<thead>` and rows. The table becomes: Ticker / Sector / Price / Chg% (4 columns). Clean. No stale data. No fallback complexity.
- Pro: zero stale data, simple builder task, honest UI.
- Con: loses three data points; the header card subtitle currently says "24 Tickers" which would also need updating.

**Option B — Static metadata map in `index.html`.**
Embed a `const TICKER_META = { GOOGL: { name: "Alphabet", mcap: "2.7T", pe: 27 }, ... }` object directly in the `<script>` block. Price/Chg% come from live JSON; name/mcap/pe come from the embedded constant. This is essentially a manual, human-maintained snapshot.
- Pro: all 7 columns preserved; builder task is bounded.
- Con: the metadata will drift from reality (pe especially changes quarterly). It is stale data under a different name. Introduces a parallel maintenance burden.

**Option C — Degrade `data.js` to metadata-only fallback.**
Keep `MarketData.TICKERS` but read only `sym`, `name`, `mcap`, `pe` from it (ignore `price`/`chg`). Merge with live price/changePct from price-quotes.json.
- Pro: name/mcap/pe columns survive without a new file.
- Con: `data.js` prices remain wrong and create confusion. The `tick()` random walk still runs on the stale TICKERS array. The data.js array still excludes SOXL/TSMU and includes RKLB/SPY/QQQ. Ticker-set mismatch between the two sources must be handled at merge time. This is more complex to build and reason about than it appears.

**Option D — Add `name` field to `tickers-universe.json`, drop vol/mcap/pe columns.**
Add a human-readable `name` string to each entry in `tickers-universe.json` (additive, optional). Render table with 5 columns: Ticker+Name / Sector / Price / Chg% / Theme-badge. Vol/mcap/pe are dropped.
- Pro: name is low-churn metadata that belongs in the universe file. Sector is already richer than data.js. Theme can serve as a descriptive substitute for the dropped columns.
- Con: requires a small `data/tickers-universe.json` schema addition (one field per ticker, done once, low-churn).

### Recommendation: Option D

Drop Volume, Mkt Cap, and Fwd P/E columns. Add a `name` string field to `tickers-universe.json` entries. The table becomes 5 columns: **Ticker + Name / Sector / Price / Chg% / Theme**. Theme (a short tag from `tickers-universe.json`) fills the formerly decorative right side with meaningful live metadata that data.js never had.

Rationale:
1. Volume, Mkt Cap, and Fwd P/E are not available in any live JSON source the dashboard controls. Displaying them from data.js is actively wrong (demo values, random-walked). Removing them is more honest.
2. `name` is a static string (company names do not change) — adding it once to `tickers-universe.json` is a low-cost, permanent fix. It belongs there conceptually.
3. The Theme column (e.g. "custom-silicon · ai-cloud") is live, accurate, and more informative for this dashboard's purpose than a stale Fwd P/E.
4. This approach keeps `data.js` completely untouched — no hybrid merge, no tick() contamination, no ticker-set mismatch logic.

---

## 3. Ticker Set Reconciliation

### Universe vs. price-quotes overlap (2026-06-05)

`tickers-universe.json` has 22 tickers. `price-quotes.json` has quotes for all 22 of those tickers plus 5 macro symbols (SPX, NDX, VIX, US10Y, DXY) and SOXL.

Wait — SOXL appears in `tickers-universe.json` (`held: true`) AND in `price-quotes.json`. That is correct.

Full check:

```
tickers-universe.json symbols (22):
  GOOGL, CLS, AVGO, MRVL, MU, TSM, PLTR, TSMU, NVDA, AMD, ARM,
  AMAT, LRCX, KLAC, MSFT, META, TSLA, ORCL, SNOW, CRWD, INTC, SOXL

price-quotes.json equity quotes (22 + macros):
  GOOGL, CLS, AVGO, MRVL, MU, TSM, PLTR, TSMU, NVDA, AMD, ARM,
  AMAT, LRCX, KLAC, MSFT, META, TSLA, ORCL, SNOW, CRWD, INTC, SOXL
  + SPX, NDX, VIX, US10Y, DXY (macro — excluded from watchlist)
```

All 22 universe tickers have price-quotes entries. No missing coverage.

### RKLB / SPY / QQQ / QCOM (in data.js, NOT in universe)

These four tickers exist only in `data.js`. They are excluded from the live universe. The new `renderWatchlist()` will not render them — they simply disappear. This is the correct behavior: the universe file is authoritative.

### Watchlist header count

The card header currently reads "Watchlist — 24 Tickers". After the change it should read "Watchlist — 22 Tickers" (matching `tickers-universe.json` length). The header is in the HTML `<h3>` at line 530.

### held badge

`tickers-universe.json` has a `held: boolean` field. `portfolio-current.json` is already fetched by `bootValuations()` and its held set is stored in scope as `heldSymbols`. The watchlist boot can reuse that same Set (or the `held` field from universe JSON — they should agree; prefer `portfolio-current.json` as authoritative since it is more granular). Display a "보유" badge matching the valuation panel style for held tickers.

---

## 4. Fetch Wiring

### Current `bootValuations()` fetches (line 929–936)

```
Promise.all([
  fetch('data/valuations.json'),
  fetch('data/risk-scores.json'),
  fetch('data/portfolio-current.json'),
  fetch('data/sector-map.json'),
])
```

### Proposed change: extend `bootValuations()` to add two more fetches

```
Promise.all([
  fetch('data/valuations.json'),
  fetch('data/risk-scores.json'),
  fetch('data/portfolio-current.json'),
  fetch('data/sector-map.json'),
  fetch('data/price-quotes.json'),      // NEW
  fetch('data/tickers-universe.json'),  // NEW
])
```

Destructure as `[valData, riskData, portData, sectorData, quotesData, universeData]`.

After building `heldSymbols` and `v3.tickerSector` (unchanged), also:
- Build `v3.watchlistRows` from universe tickers joined with price-quotes
- Call `renderWatchlist()` (the new live version) once

This keeps all boot fetches in a single `Promise.all`, avoids duplicate requests, and preserves the existing error boundary in the `catch(e)` block.

### localStorage

No localStorage key is introduced. Watchlist data is not user-editable. Price-quotes is a repo-controlled file refreshed by GH Actions.

### Fallback on fetch failure

If the `Promise.all` rejects (network error, file not found), the existing `catch` block currently writes an error message to `#valuation-body`. Extend the catch to also clear `#watchlist-body` with a single error row rather than leaving the old `renderWatchlist()` output. The old `renderWatchlist()` will have already run from `renderAll()` at line 848, so the stale data.js rendering appears briefly until `bootValuations()` resolves (~50ms local, potentially longer if served remotely). This is acceptable — the live render simply overwrites it. On failure, the stale data.js rendering remains visible (it was the initial state). This is the correct fallback: stale is better than blank.

Specifically: on catch, do NOT touch `#watchlist-body`. Let the initial `renderWatchlist()` (data.js) remain visible. Only `#valuation-body` gets the error message (current behavior, unchanged).

---

## 5. Surgical Boundary

### What changes

| Location | Change |
|----------|--------|
| `index.html` line 530 `<h3>` | "24 Tickers" → "22 Tickers" |
| `index.html` line 792 `renderWatchlist()` | Replace body with live render from `v3.watchlistRows` |
| `index.html` line 844 `renderWatchlist()` call in `renderAll()` | Keep — renders stale data.js initially as loading state |
| `index.html` line 850 `MarketData.subscribe()` callback | Remove `renderWatchlist()` from the subscribe callback — live watchlist does not tick |
| `index.html` line 929 `bootValuations()` | Add `price-quotes.json` and `tickers-universe.json` to `Promise.all` |
| `index.html` line 922 `v3` init block | Add `v3.watchlistRows = []` |
| `index.html` `<thead>` watchlist (line 538–545) | Replace 7-column head with 5-column head |
| `data/tickers-universe.json` | Add `name` string field to each ticker entry |
| `data/README.md` | Document the new `name` field under tickers-universe schema |

### What does NOT change

- `data.js` — untouched
- `MarketData.TICKERS`, `MarketData.SECTORS`, `MarketData.WHALES`, `MarketData.TRUMP_TRIGGERS` — untouched
- `renderGlance()`, `renderGauge()`, `renderSectors()`, `renderWhales()`, `renderTriggers()` — untouched
- `MarketData.tick()` random walk — still runs every 30s, still calls the subscribe callbacks for glance/gauge/sectors — watchlist is simply removed from that callback
- `bootValuations()` valuation panel logic — unchanged; only the `Promise.all` gains two more fetches

---

## 6. New Column Schema (5-column table)

### thead (replaces lines 538–545)

```html
<tr>
  <th>Ticker</th>
  <th>Sector</th>
  <th style="text-align:right">Price</th>
  <th style="text-align:right">Chg %</th>
  <th>Theme</th>
</tr>
```

### Row shape (v3.watchlistRows entries)

Each entry in `v3.watchlistRows`:

```
{
  sym:       string,          // from tickers-universe symbol
  name:      string,          // from tickers-universe name (new field)
  sector:    string,          // from tickers-universe sector (fine-grained)
  themes:    string[],        // from tickers-universe theme[]
  held:      boolean,         // from portfolio-current.json heldSymbols Set
  price:     number | null,   // from price-quotes.json .quotes[sym].price
  changePct: number | null,   // from price-quotes.json .quotes[sym].changePct
  verified:  boolean,         // from price-quotes.json .quotes[sym].verified
}
```

If a ticker appears in the universe but has no price-quotes entry (edge case, should not occur given current data but defensive), `price` and `changePct` are null and render as "—".

### Row render pseudocode (for builder reference — not production code)

```js
function buildWatchRow(r) {
  const cls = r.changePct > 0 ? 'up' : r.changePct < 0 ? 'down' : 'flat';
  const sign = r.changePct > 0 ? '+' : '';
  const priceFmt = r.price != null ? '$' + r.price.toFixed(2) : '—';
  const chgFmt = r.changePct != null ? sign + r.changePct.toFixed(2) + '%' : '—';
  const themeFmt = r.themes.slice(0, 2).join(' · ');   // max 2 tags
  const heldBadge = r.held
    ? '<span class="pill live" style="font-size:9px;padding:1px 5px">보유</span>'
    : '';
  const verifiedDot = r.verified
    ? '<span class="blob" style="background:var(--green)"></span>'
    : '';
  // sector-tag uses existing .sector-tag class but with the fine-grained sector key
  return `<tr>
    <td>
      <div class="sym">${r.sym}</div>
      <div class="name">${r.name}</div>
      ${heldBadge}
    </td>
    <td><span class="sector-tag">${r.sector}</span></td>
    <td class="price">${verifiedDot}${priceFmt}</td>
    <td class="chg-cell ${cls}">${chgFmt}</td>
    <td style="color:var(--muted);font-size:11px">${themeFmt}</td>
  </tr>`;
}
```

Note: the `.sector-tag` class currently uses `${t.sector}` as a CSS class name for per-sector color. The existing sectors in data.js are coarse keys (AI, Semi, Equip, Growth, Bench). The new sector values from tickers-universe are fine-grained strings with hyphens (Semis-Custom, MegaCap-Platform, etc.). The existing CSS likely has no matching rules for these fine-grained keys, so the tag will render with the default `.sector-tag` style (background `var(--line-2)`, color `var(--ink-2)`) — which is visually acceptable and is how the valuation panel already renders its sector tags (see `buildValRow()` line 1012). No new CSS is needed. The builder should use the same inline style as `buildValRow()` does: `style="background:var(--line-2);color:var(--ink-2)"` directly on the `<span>` to ensure consistency regardless of the key.

---

## 7. `data/tickers-universe.json` Schema Addition

### New `name` field

Add a `name: string` field to each entry in `tickers-universe.json`. This field is optional in the schema (existing readers that ignore unknown fields are unaffected). It holds the human-readable company name. Example delta:

```jsonc
// Before
{ "symbol": "GOOGL", "sector": "MegaCap-Platform", "held": true, "theme": ["custom-silicon", "ai-cloud", "regulatory-risk"] }

// After
{ "symbol": "GOOGL", "name": "Alphabet", "sector": "MegaCap-Platform", "held": true, "theme": ["custom-silicon", "ai-cloud", "regulatory-risk"] }
```

Full name mapping for the builder to apply (all 22 tickers):

| symbol | name |
|--------|------|
| GOOGL | Alphabet |
| CLS | Celestica |
| AVGO | Broadcom |
| MRVL | Marvell |
| MU | Micron |
| TSM | TSMC |
| PLTR | Palantir |
| TSMU | T-Rex 2X Long TSMC |
| NVDA | NVIDIA |
| AMD | AMD |
| ARM | Arm Holdings |
| AMAT | Applied Materials |
| LRCX | Lam Research |
| KLAC | KLA Corporation |
| MSFT | Microsoft |
| META | Meta |
| TSLA | Tesla |
| ORCL | Oracle |
| SNOW | Snowflake |
| CRWD | CrowdStrike |
| INTC | Intel |
| SOXL | Direxion Daily Semi 3x |

### `data/README.md` delta

Under the `### tickers-universe.json` section (currently not fully documented — the README describes it only in the Files table), add:

```
### tickers-universe.json
Array of tickers under the `tickers` key. Each entry:
  "symbol"  string   — ticker symbol (authoritative key)
  "name"    string   — human-readable company / fund name  [NEW 2026-06-06]
  "sector"  string   — fine-grained sector bucket (matches sector-map.json keys)
  "held"    boolean  — true if currently in portfolio-current.json positions
  "theme"   string[] — 2-4 thesis tags (matched to sector-map.json theme strings)

Also contains an "indices" array for macro reference symbols (SPX, NDX, VIX, DXY, US10Y).
These are NOT rendered in the watchlist table.
```

---

## 8. escapeHtml Recommendation

**Recommendation: defer to a separate PR.**

Rationale: all strings rendered into innerHTML in this change come from repo-controlled JSON files (`tickers-universe.json`, `price-quotes.json`, `portfolio-current.json`). These are committed assets, not user input, not network-fetched from third-party APIs. There is no injection vector in the current scope.

The existing `buildValRow()` (line 981–1031) also does not use `escapeHtml()`. Introducing it only in the new `buildWatchRow()` would create an asymmetry in the codebase. Introducing it everywhere (all innerHTML builders) is a broader refactor that should be a dedicated commit touching glance, sectors, whales, triggers, and valuations — not bundled with this watchlist live-data change.

If the team decides to add escapeHtml, the correct form is:

```js
// Pseudocode — belongs in a dedicated escapeHtml PR
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Apply to: `r.sym`, `r.name`, `r.sector`, `r.themes` in `buildWatchRow()`, and in the same pass to `buildValRow()` and all other innerHTML builders in the file.

---

## 9. Backward Compatibility

| Concern | Impact | Mitigation |
|---------|--------|------------|
| `MarketData.TICKERS` still exists | No impact — it is still returned from `data.js` and available as `MarketData.TICKERS`. No code is deleted from data.js. | None needed |
| `renderWatchlist()` initial call in `renderAll()` | Runs before `bootValuations()` resolves. Renders stale data.js table briefly. | After `bootValuations()` resolves, live render overwrites it. Acceptable flash (~50ms local). |
| `tick()` no longer updates watchlist | Watchlist will not tick every 30s. It shows EOD prices from price-quotes.json. | This is correct — data.js prices were random-walked fantasy numbers. EOD prices are more honest. |
| `tickers-universe.json` `name` field | Additive. Any agent reading the file and ignoring `name` is unaffected. | Field is optional in the schema. |
| 22 vs 24 count in header | "24 Tickers" becomes "22 Tickers". | Update `<h3>` text directly. |
| RKLB / SPY / QQQ / QCOM disappear | These four demo tickers leave the watchlist. They were not in the live universe. | No mitigation needed — this is the desired outcome. |

---

## 10. Ordered Builder Task List

The builder should implement in this exact order to minimize risk:

1. **Add `name` field to `data/tickers-universe.json`** — 22 entries, name strings from the table in section 7. Validate JSON after edit.

2. **Update `data/README.md`** — Add the `tickers-universe.json` schema block from section 7.

3. **Update `<thead>` in `index.html`** (line 538–545) — Replace 7-column head with the 5-column head from section 6.

4. **Update card header `<h3>`** (line 530) — "24 Tickers" → "22 Tickers".

5. **Add `v3.watchlistRows = []`** to the `v3` init block (line 922–927).

6. **Extend `bootValuations()` `Promise.all`** (line 929–936) — Add `fetch('data/price-quotes.json')` and `fetch('data/tickers-universe.json')` as the 5th and 6th entries. Destructure `[valData, riskData, portData, sectorData, quotesData, universeData]`.

7. **Build `v3.watchlistRows`** inside `bootValuations()`, after `heldSymbols` is built — iterate `universeData.tickers`, join with `quotesData.quotes[sym]`, produce the row shape from section 6.

8. **Call `renderWatchlist()`** at the end of that block (after `renderValuations()`).

9. **Rewrite `renderWatchlist()`** (line 792–806) — Replace the `MarketData.TICKERS.map(...)` body with `v3.watchlistRows.map(buildWatchRow).join('')`. Add `buildWatchRow(r)` function immediately below.

10. **Remove `renderWatchlist()` from `MarketData.subscribe()` callback** (line 850–856) — Remove only that one line. Leave `renderGlance`, `renderGauge`, `renderSectors`, `last-sync` update unchanged.

11. **Smoke test** (see section 11).

---

## 11. Smoke Test / Verification Criteria

After implementation, open `http://localhost:8765` with browser devtools console open.

| Check | Expected result |
|-------|-----------------|
| Console errors on boot | None. No `Failed to fetch` errors. |
| `#watchlist-body` row count | 22 rows (one per tickers-universe entry) |
| GOOGL price displayed | Matches `data/price-quotes.json` quotes.GOOGL.price (365.51 as of 2026-06-05) — NOT 218.75 (the stale data.js value) |
| RKLB / SPY / QQQ / QCOM | Not present in the rendered table |
| SOXL / TSMU | Present in the rendered table |
| SOXL "보유" badge | Visible (held: true in universe, confirmed in portfolio-current.json) |
| GOOGL "보유" badge | Visible |
| CLS / AVGO / MRVL / MU "보유" badge | Visible (4 of 6 held positions) |
| PLTR / TSM | No held badge (held: false) |
| 30s tick | Watchlist prices do NOT change on tick. Glance / Gauge / Sectors still update. |
| Resize to 480px | Table is horizontally scrollable or columns collapse without overflow-x breaking layout. Verify using existing `.watchlist` CSS (the valuation table uses the same class and is already tested). |
| `data/tickers-universe.json` JSON valid | `node -e "JSON.parse(require('fs').readFileSync('data/tickers-universe.json'))" && echo OK` prints OK |

---

## 12. Data Flow Diagram

```
boot
 |
 +-- renderAll() [sync, from data.js]
 |    └── renderWatchlist()  ← stale data.js, 24 rows, placeholder
 |
 +-- bootValuations() [async, Promise.all]
      |
      ├── fetch data/valuations.json
      ├── fetch data/risk-scores.json
      ├── fetch data/portfolio-current.json  → heldSymbols Set
      ├── fetch data/sector-map.json         → v3.tickerSector map
      ├── fetch data/price-quotes.json       → quotesData   [NEW]
      └── fetch data/tickers-universe.json   → universeData [NEW]
           |
           ├── build v3.valuationRows  → renderValuations()  [unchanged]
           └── build v3.watchlistRows  → renderWatchlist()   [NEW: 22 live rows]

tick() every 30s [unchanged]
  └── MarketData.subscribe callback
       ├── renderGlance()    [data.js]
       ├── renderGauge()     [data.js]
       ├── renderSectors()   [data.js]
       └── (renderWatchlist removed from this callback)
```

No localStorage is read or written for the watchlist. No new CSS variables.
