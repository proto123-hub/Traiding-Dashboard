# Design: Valuation Panel in index.html — 22-Ticker FV Band Table

**Date:** 2026-06-06  
**Author:** architect agent  
**Scope:** Add a "밸류에이션" section to `index.html` that reads `data/valuations.json`,
`data/risk-scores.json`, and `data/portfolio-current.json` at boot via `fetch()`,
then renders a filterable/sortable table below the existing watchlist. No new files.
No changes to `data.js` or the existing `MarketData` object.

---

## 1. Data Wiring Decision

### The problem

`index.html` currently reads all data from `data.js` (`window.MarketData`), which
contains stale demo prices (e.g. GOOGL $218.75, NVDA $178.50). The live JSON layer
(`data/valuations.json`, `data/price-quotes.json`) is maintained by agents but is
never consumed by the dashboard. This contradicts `data/README.md`, which states:

> "The dashboard boots with these [data/*.json] as the authoritative seed."

### Options considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. fetch() at boot** | `index.html` fetches 3 JSON files on `DOMContentLoaded`; renders valuation panel from them. MarketData.TICKERS untouched. | Minimal diff, no breakage, README-compatible, immediately live | Requires a local server (already the case: `python3 -m http.server 8765`) |
| B. Regenerate data.js from JSON | A script/agent rewrites `data.js` from `price-quotes.json` | Single data path | Build step; conflicts with "no build step" rule |
| C. Hybrid | fetch() for valuation panel; keep MarketData.TICKERS for watchlist | Gradual migration | Two data paths for price — confusing long-term |

**Recommendation: Option A (fetch at boot).**

Rationale:
- Zero impact on existing rendering. `MarketData.TICKERS`, `renderWatchlist()`, and
  all existing JS are untouched (Karpathy: surgical changes).
- The valuation panel is a new card appended to `<main>` — it never touches
  `#watchlist-body` or the existing table.
- `data/valuations.json` already holds `currentPrice` (agent-stamped from
  `price-quotes.json`), so the panel gets live EOD prices without touching
  `price-quotes.json` separately.
- `data/portfolio-current.json` is already fetched nowhere — adding one `fetch()`
  for it is additive.
- `localStorage` relationship: the valuation panel has no user-editable state, so
  no `td.*` key is needed. If in future the user wants to override an FV band
  manually, a separate design will cover that. For now: JSON → render, no
  localStorage layer for this feature.

### Fetch sequence (pseudocode)

```
async function bootValuations() {
  const [valData, riskData, portData] = await Promise.all([
    fetch('data/valuations.json').then(r => r.json()),
    fetch('data/risk-scores.json').then(r => r.json()),
    fetch('data/portfolio-current.json').then(r => r.json()),
  ]);

  const heldSymbols = new Set(portData.positions.map(p => p.symbol));

  // Build merged row array
  v3.valuationRows = Object.entries(valData.valuations).map(([sym, v]) => {
    const risk = riskData.scores[sym] || null;
    return {
      sym,
      held: heldSymbols.has(sym),
      fvLow:   v.fvLow,
      fvMid:   v.fvMid,
      fvHigh:  v.fvHigh,
      price:   v.currentPrice,
      upside:  v.upsideMidPct,         // already percent (e.g. 9.71 = 9.71%)
      method:  v.method,
      verdict: risk ? risk.verdict : null,
      score:   risk ? risk.score : null,
      nextReview: v.nextReview,
    };
  });

  renderValuations();
}
```

`bootValuations()` is called once after `DOMContentLoaded`. If the fetch fails
(e.g., opened directly via `file://`), the valuation card shows a single-row
error notice and does not throw.

---

## 2. UI Placement

### Where

A new `.card` is inserted into `<main>` **between the watchlist card and the
whale/Trump row**, directly after the closing `</div>` of the watchlist card
(currently at line 504 of `index.html`).

The sidebar "밸류에이션" link (currently `data-scroll="watchlist-body"`) is updated
to `data-scroll="valuation-panel"` so it scrolls to the new card.

### Card anatomy

```
┌────────────────────────────────────────────────────────────────────────┐
│ [card-head]  밸류에이션 — 22 종목          [필터 controls]  [SYNCED pill] │
├────────────────────────────────────────────────────────────────────────┤
│ [filter bar]                                                            │
│  [보유 | 워치 | 전체]  [섹터 ▼]  [upside ▼]                              │
├────────────────────────────────────────────────────────────────────────┤
│ [table: see column spec below]                                          │
└────────────────────────────────────────────────────────────────────────┘
```

**Element IDs:** `id="valuation-panel"` on the `.card`, `id="valuation-body"` on
the `<tbody>`.

---

## 3. Column Specification

The table reuses the existing `.watchlist` CSS class so all spacing, sticky header,
hover, and mono-font rules apply without new CSS.

| # | `<th>` label | Data field | Align | Format |
|---|-------------|-----------|-------|--------|
| 1 | Ticker | `sym` + `held` badge | left | `<div class="sym">AVGO</div>` + if held: `<span class="pill live">보유</span>` |
| 2 | Sector | from `sector-map.json` lookup (preloaded into `v3.sectorMap`) OR derived inline from `valuations.json` method tags | left | `.sector-tag` |
| 3 | Price | `price` | right | mono, 2 dp |
| 4 | FV Band | `fvLow / fvMid / fvHigh` | center | `$330 — $367 — $430` in muted/ink/muted |
| 5 | Upside to Mid | `upside` | right | color-coded: green if >5%, amber if 0–5%, red if negative |
| 6 | FV Bar | pure CSS inline bar (no Chart.js) | center | 60px inline element |
| 7 | Verdict | `verdict` (held only) or `—` | center | verdict pill |
| 8 | Next Review | `nextReview` | right | YYYY-MM-DD mono muted |

**Column 4 — FV Band text format:**
```
<span class="fv-low">$330</span>
<span class="fv-sep"> — </span>
<span class="fv-mid">$367</span>
<span class="fv-sep"> — </span>
<span class="fv-high">$430</span>
```
CSS: `.fv-low, .fv-high { color: var(--muted); font-family: var(--mono); font-size: 11px; }`  
`.fv-mid { color: var(--ink); font-family: var(--mono); font-weight: 700; }`

**Column 5 — Upside color logic:**
```
upside > 5   → color: var(--green)
0 < upside ≤ 5  → color: var(--amber)
upside ≤ 0   → color: var(--red)
```
Format: `+9.71%` or `−3.02%` with sign prepended, 2 dp.

**Column 6 — FV Bar (pure CSS, no Chart.js):**
A 60 × 10 px inline bar showing current price position within the FV band.

```
pct = clamp((price - fvLow) / (fvHigh - fvLow), 0, 1)
markerLeft = pct * 60  // pixels
```

```html
<div class="fv-bar-wrap">
  <div class="fv-bar">
    <div class="fv-bar-fill" style="width: [pct*100]%"></div>
    <div class="fv-bar-marker" style="left: [markerLeft]px"></div>
  </div>
</div>
```

CSS (new rules, all using existing vars):
```css
.fv-bar-wrap { display: flex; align-items: center; justify-content: center; }
.fv-bar {
  position: relative; width: 60px; height: 8px;
  background: linear-gradient(90deg, var(--red-soft), var(--amber-soft), var(--green-soft));
  border-radius: 4px; overflow: visible;
}
.fv-bar-fill { display: none; }  /* fill not needed — marker only */
.fv-bar-marker {
  position: absolute; top: -3px;
  width: 2px; height: 14px;
  background: var(--ink); border-radius: 1px;
}
```

The bar spans fvLow (left) → fvHigh (right). The mid-point ($fvMid) is always
at the approximate center. The vertical marker shows current price. If price is
below fvLow or above fvHigh, the marker is clamped to 0% / 100%.

**Column 7 — Verdict pill mapping:**
```
STRONG_BUY → .pill.live (green)
BUY        → background: var(--green-soft), color: var(--green)
HOLD       → background: var(--line-2), color: var(--muted)
TRIM       → background: var(--amber-soft), color: var(--amber)
SELL       → background: var(--red-soft), color: var(--red)
null (watchlist-only) → "—" plain text
```

---

## 4. Filter / Sort Controls

Three minimal controls in the card-head area (right-aligned, before the SYNCED pill):

### 4a. Held/Watch/All toggle

Three-button toggle group reusing `.lang-toggle` CSS pattern:

```html
<div class="lang-toggle" id="val-filter-held">
  <button data-val-filter="all" class="active">전체</button>
  <button data-val-filter="held">보유</button>
  <button data-val-filter="watch">워치</button>
</div>
```

Filters `v3.valuationRows` by `row.held === true / false` or passes all.

### 4b. Sort: Upside descending toggle

A single button that cycles through three states:

```
기본 (insertion order from JSON)
upside ↑ (ascending — worst first, good for reviewing expensive tickers)
upside ↓ (descending — best discount first — default active on load)
```

```html
<button id="val-sort-upside" class="val-sort-btn" data-sort="desc">
  Upside ↓
</button>
```

CSS for `.val-sort-btn`:
```css
.val-sort-btn {
  padding: 4px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--panel-2); color: var(--ink-2); font-size: 11px;
  font-weight: 600; cursor: pointer; font-family: var(--mono);
}
.val-sort-btn:hover { background: var(--cyan-soft); color: var(--cyan-2); }
.val-sort-btn.active { background: var(--cyan-soft); color: var(--cyan-2); border-color: var(--cyan); }
```

On click, cycle: `"desc"` → `"asc"` → `"none"` → `"desc"`. Update button label.
Default state on load: `"desc"` (best upside first).

### 4c. No sector filter (omitted)

Sector filter was considered but ruled out: with only 22 rows, a sector dropdown
adds UI complexity without meaningful value. The user can visually scan the table.
If needed in a future design, it can be added as a `<select>` in the filter bar.

---

## 5. Render Function Signature

```javascript
// Namespace: v3.*  (consistent with CLAUDE.md)
let v3 = window.v3 || {};
v3.valuationRows = [];       // populated by bootValuations()
v3.valFilter = 'all';        // 'all' | 'held' | 'watch'
v3.valSort = 'desc';         // 'desc' | 'asc' | 'none'

function renderValuations() {
  // 1. Filter
  let rows = v3.valuationRows;
  if (v3.valFilter === 'held')  rows = rows.filter(r => r.held);
  if (v3.valFilter === 'watch') rows = rows.filter(r => !r.held);

  // 2. Sort
  if (v3.valSort !== 'none') {
    rows = [...rows].sort((a, b) =>
      v3.valSort === 'desc' ? b.upside - a.upside : a.upside - b.upside
    );
  }

  // 3. Render rows → #valuation-body
  document.getElementById('valuation-body').innerHTML = rows.map(buildValRow).join('');
}

function buildValRow(r) { /* returns <tr> HTML string */ }
```

Filter buttons and sort button each update `v3.valFilter` / `v3.valSort` then call
`renderValuations()`.

---

## 6. DOM Structure (static HTML shell)

This block is inserted immediately after the closing `</div>` of the watchlist card
(after line 504):

```html
<!-- Valuations -->
<div class="card" id="valuation-panel" style="margin-bottom: 16px;">
  <div class="card-head">
    <h3><span class="ko">밸류에이션 — FV 밴드</span><span class="en">Valuations — FV Bands</span></h3>
    <span class="sub" id="val-updated">data/valuations.json · 2026-06-05</span>
    <span class="spacer"></span>
    <div class="lang-toggle" id="val-filter-held">
      <button data-val-filter="all" class="active">전체</button>
      <button data-val-filter="held">보유</button>
      <button data-val-filter="watch">워치</button>
    </div>
    <button id="val-sort-upside" class="val-sort-btn active" data-sort="desc">Upside ↓</button>
    <span class="pill live"><span class="blob"></span>SYNCED</span>
  </div>
  <div class="card-body flush">
    <table class="watchlist" id="valuation-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Sector</th>
          <th style="text-align:right">Price</th>
          <th style="text-align:center">FV Band (Low — Mid — High)</th>
          <th style="text-align:right">Upside</th>
          <th style="text-align:center">Band Pos</th>
          <th style="text-align:center">Verdict</th>
          <th style="text-align:right">Next Review</th>
        </tr>
      </thead>
      <tbody id="valuation-body">
        <tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">로딩 중…</td></tr>
      </tbody>
    </table>
  </div>
</div>
```

---

## 7. Mobile Behavior (480px breakpoint)

At ≤480px, columns 4 (FV Band text) and 8 (Next Review) are hidden via:

```css
@media (max-width: 480px) {
  #valuation-table th:nth-child(4),
  #valuation-table td:nth-child(4),
  #valuation-table th:nth-child(8),
  #valuation-table td:nth-child(8) { display: none; }
}
```

At ≤768px, column 6 (Band Pos bar) is also hidden:

```css
@media (max-width: 768px) {
  #valuation-table th:nth-child(6),
  #valuation-table td:nth-child(6) { display: none; }
}
```

This leaves Ticker / Sector / Price / Upside / Verdict on mobile — the minimum
useful set.

The filter controls in the card-head wrap naturally because `.card-head` is
`display: flex; flex-wrap: wrap` — no additional CSS needed.

---

## 8. Sidebar Link Update

Change line 337 from:
```html
<div class="side-link" data-scroll="watchlist-body">
  <span class="dot"></span><span class="ko">밸류에이션</span><span class="en">Valuation</span>
</div>
```
To:
```html
<div class="side-link" data-scroll="valuation-panel">
  <span class="dot"></span><span class="ko">밸류에이션 FV</span><span class="en">Valuations FV</span>
</div>
```

---

## 9. Sector Lookup

`sector-map.json` maps sector names → ticker arrays. For display, the builder
should invert this map at boot: `{ "AVGO": "Semis-Custom", "MRVL": "Semis-Custom", ... }`.

```javascript
// Invert sector-map once at boot
v3.tickerSector = {};
Object.entries(sectorMapData.sectors).forEach(([sec, obj]) => {
  obj.tickers.forEach(t => { v3.tickerSector[t] = sec; });
});
```

Then in `buildValRow`, sector display:
```javascript
const sector = v3.tickerSector[r.sym] || '—';
```

`sector-map.json` must be fetched alongside the other three files (4 fetches total
in `Promise.all`). This is a read-only fetch — no schema change needed.

The existing `.sector-tag` CSS classes (`Semi`, `Equip`, `Growth`, `Bench`) do not
match the new sector keys (`Semis-Custom`, `Electronics-Mfg`, etc.). Rather than
adding 16 new CSS color classes, the builder should render sector as plain mono
text inside a neutral tag:

```html
<span class="sector-tag" style="background:var(--line-2);color:var(--ink-2)">Semis-Custom</span>
```

This avoids adding new hex colors and new CSS classes.

---

## 10. Backward Compatibility

- No existing keys in `data/*.json` are modified. All fetches are read-only.
- `MarketData.TICKERS` in `data.js` is untouched. The watchlist table still renders
  from demo data as before.
- No `localStorage` key is introduced. Nothing is persisted between sessions.
- `v3` namespace: `window.v3` may or may not exist when the script runs. The builder
  must use `let v3 = window.v3 || {}; window.v3 = v3;` to avoid conflicts.
- If `data/valuations.json` does not exist or fetch fails, the valuation card shows:
  `<tr><td colspan="8">밸류에이션 데이터 로드 실패 — data/valuations.json을 확인하세요.</td></tr>`
  No exception is thrown; other dashboard sections are unaffected.

---

## 11. New CSS Rules Summary

All rules use only existing `:root` variables. Builder adds these in the `<style>`
block immediately before the closing `</style>` tag (surgical append, no existing
rule changes):

```css
/* ===== Valuation FV Panel ===== */
.fv-band { white-space: nowrap; text-align: center; font-family: var(--mono); font-size: 11px; }
.fv-low, .fv-high { color: var(--muted); }
.fv-mid  { color: var(--ink); font-weight: 700; }
.fv-sep  { color: var(--faint); }

.fv-bar-wrap { display: flex; align-items: center; justify-content: center; }
.fv-bar {
  position: relative; width: 60px; height: 8px;
  background: linear-gradient(90deg, var(--red-soft), var(--amber-soft), var(--green-soft));
  border-radius: 4px;
}
.fv-bar-marker {
  position: absolute; top: -3px; width: 2px; height: 14px;
  background: var(--ink); border-radius: 1px;
}

.val-sort-btn {
  padding: 4px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--panel-2); color: var(--ink-2); font-size: 11px;
  font-weight: 600; cursor: pointer; font-family: var(--mono);
}
.val-sort-btn:hover  { background: var(--cyan-soft); color: var(--cyan-2); }
.val-sort-btn.active { background: var(--cyan-soft); color: var(--cyan-2); border-color: var(--cyan); }

.verdict-pill {
  display: inline-block; padding: 2px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 700; font-family: var(--mono); letter-spacing: 0.04em;
}
.verdict-STRONG_BUY { background: var(--green-soft);  color: var(--green); }
.verdict-BUY        { background: var(--green-soft);  color: var(--green); }
.verdict-HOLD       { background: var(--line-2);      color: var(--muted); }
.verdict-TRIM       { background: var(--amber-soft);  color: var(--amber); }
.verdict-SELL       { background: var(--red-soft);    color: var(--red);   }

@media (max-width: 768px) {
  #valuation-table th:nth-child(6),
  #valuation-table td:nth-child(6) { display: none; }
}
@media (max-width: 480px) {
  #valuation-table th:nth-child(4),
  #valuation-table td:nth-child(4),
  #valuation-table th:nth-child(8),
  #valuation-table td:nth-child(8) { display: none; }
}
```

---

## 12. data/README.md Delta

Add to the `## Files` table one row (already exists; no change needed):
`price-quotes.json` is already documented. No new file is introduced.

Add the following note under the `## Resolution order at boot` section:

```
The valuation panel (index.html #valuation-panel) fetches these four files
directly at boot via fetch():
  data/valuations.json      — FV bands + currentPrice
  data/risk-scores.json     — verdict + score (held tickers only)
  data/portfolio-current.json — held symbol set
  data/sector-map.json      — sector label lookup

These reads are non-blocking: the rest of the dashboard renders from data.js
as before; the valuation card populates when the fetches resolve (~50ms local).
No localStorage key is written by the valuation panel.
```

---

## 13. Test Plan

**Functional:**
1. Serve with `python3 -m http.server 8765`. Open `http://localhost:8765`.
2. Scroll to or click "밸류에이션 FV" in sidebar — card appears; no JS error in console.
3. Table shows 22 rows (all from `valuations.json`). Verify GOOGL row shows price
   $365.51, fvMid $367, upside +0.41%.
4. GOOGL, CLS, AVGO, MRVL, MU, SOXL rows show "보유" pill and a verdict (HOLD,
   BUY, etc.). Non-held tickers show "—" in verdict column.
5. Click "보유" filter: 6 rows only. Click "워치": 16 rows. Click "전체": 22 rows.
6. "Upside ↓" button sorts: SOXL (+32.27%) should be first, AMD (−18.52%) last.
   Click again for ascending. Click again for insertion order.
7. At browser width 480px: FV Band column and Next Review column hidden; table
   still readable.
8. Network tab: 4 fetch() calls to `data/*.json`, all 200. No 404.

**Regression:**
9. Watchlist `#watchlist-body` still renders 24 demo rows from `data.js` unchanged.
10. Market Regime gauge, Sector Heatmap, Whale strip, Trump triggers all render
    normally — no JS error.

**Error path:**
11. Rename `data/valuations.json` temporarily. Reload. Valuation card shows error
    notice. No other section breaks.

---

## 14. Builder Work Items (ordered)

1. **CSS:** Append the 12 new rules (section 11) inside the existing `<style>` block,
   before `</style>`. No rule modifications.

2. **HTML — card shell:** Insert the valuation card DOM (section 6) after line 504
   (closing `</div>` of watchlist card), before the whale+Trump row.

3. **HTML — sidebar link:** Change `data-scroll="watchlist-body"` → `data-scroll="valuation-panel"`
   for the "밸류에이션" link (line 337). Update label text to "밸류에이션 FV".

4. **JS — namespace init:** Before `bootValuations`, declare:
   ```javascript
   let v3 = window.v3 || {}; window.v3 = v3;
   ```

5. **JS — `bootValuations()`:** 4-way `Promise.all` fetch. Build `v3.valuationRows`
   array (22 entries). Call `renderValuations()`. Attach to
   `document.addEventListener('DOMContentLoaded', bootValuations)`.

6. **JS — `renderValuations()`:** Filter + sort + call `buildValRow()` per row.
   Write to `#valuation-body`.

7. **JS — `buildValRow(r)`:** Returns `<tr>` HTML string. Implement all 8 columns
   per spec in section 3. Clamp FV bar marker to [0, 60px].

8. **JS — filter buttons:** `#val-filter-held` buttons update `v3.valFilter`,
   toggle `.active`, call `renderValuations()`.

9. **JS — sort button:** `#val-sort-upside` cycles `v3.valSort` through
   `desc → asc → none → desc`, updates label and `.active`, calls `renderValuations()`.

10. **data/README.md:** Append the note from section 12.

All JS goes in the second `<script>` block (after `</script>` for `data.js`),
appended before the final `</script>` closing tag.
