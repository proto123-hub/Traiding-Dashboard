# Design — Monthly Asset Trend Chart + Manual Entry (2026-04-24)

**Author:** architect · **For:** builder · **Status:** approved for implementation

## TL;DR
- Add a line chart of monthly total-MV and cost basis to the Portfolio tab, fed by `data/assets-history.json`.
- Add a Manual-Entry modal so the user can append or edit monthly snapshots without touching files.
- Dual-persist: JSON is authoritative seed; user edits write to `localStorage` until an explicit "Save to repo" button is clicked (which prints the JSON to the screen for copy-paste-commit — no server).

## Schema change
No breaking changes. `data/assets-history.json` shape already matches. Null `totalMV` / `pnl` rows get computed live from `v3.seedQuotes × byTicker.shares`.

New localStorage keys:
- `td.assetsHistory.v1` — user-edited snapshots array (same shape as JSON)
- `td.portfolioCurrent.v1` — user-edited current positions

Load order (implemented in builder step):
```js
localStorage['td.assetsHistory.v1']  ||  fetch('data/assets-history.json')  ||  fallback to v3.portfolio computed
```

## UI surface

### Location
Insert a new section inside `#tab-portfolio`, between the existing position-table `</div>` and the `</section>` closing tag — so the flow is:
```
Position Snapshot tier
Positions table
Concentration alert
→ [NEW] Monthly Asset Trend panel
→ [NEW] Manual Entry button row
```

### Markup (pseudocode)
```html
<div class="asset-trend-panel">
  <div class="chart-panel-header">
    <div class="chart-panel-title">월별 자산 추이 · Monthly Asset Trend</div>
    <div class="chart-panel-sub" id="assetTrendMeta">—</div>
  </div>
  <div style="height: 300px; position: relative;">
    <canvas id="assetTrendChart"></canvas>
  </div>
  <div class="asset-trend-actions">
    <button id="btnAddSnapshot">+ 이번 달 스냅샷 추가</button>
    <button id="btnEditHistory">✎ 히스토리 편집</button>
    <button id="btnExportJson">⬇ JSON 내보내기</button>
    <button id="btnResetLocal">↺ 로컬 초기화</button>
  </div>
</div>
```

### Chart config
- Type: `line`
- X axis: months from `assets-history.json.snapshots[].month`
- Datasets:
  - `총자산 (MV)` — `snapshots[].totalMV` · color `--accent-cyan`
  - `원가 (Cost)` — `snapshots[].totalCost` · dashed, color `--text-muted`
  - `손익 (PnL)` — `snapshots[].pnl` · color computed per-point (green ≥ 0, red < 0) via segment plugin
- Y axis: USD, formatted as `$Nk` / `$Nm`
- Tooltip: show MV, Cost, PnL, PnL%, and byTicker top-3 contributors for the hovered month
- Responsive: `maintainAspectRatio: false` (so the 300px height wrapper controls size)
- Mobile: at < 480px, hide the Cost dashed line to reduce clutter — legend click can re-enable

### Manual-Entry modal
Triggered by `#btnAddSnapshot` or `#btnEditHistory`:
- Month selector (YYYY-MM, default = this month)
- `totalMV` (number, required)
- `cash` (number, default 0)
- `note` (textarea, optional)
- Per-ticker: shares editable (defaults from current portfolio), avg-cost read-only
- On save: patch `td.assetsHistory.v1` in localStorage, re-render chart + positions
- Close: Escape key or backdrop click

### Styling
Reuse existing `.chart-panel` rules. New additions:
```css
.asset-trend-panel { /* same as .chart-panel but full-width grid-column: 1/-1 */ }
.asset-trend-actions { display: flex; gap: 8px; margin-top: 10px; }
.asset-trend-actions button { /* reuse .refresh-btn look */ }
.modal-backdrop { position: fixed; inset:0; background: rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index: 2000; }
.modal-body { background: var(--bg-panel); padding: 20px; border-radius: 8px; max-width: 560px; width: 90%; max-height: 90vh; overflow: auto; }
```

## Data flow
```
Boot:
  localStorage['td.assetsHistory.v1']  ──▶  v3.assetsHistory
     ↑ missing                                ↓
  fetch('data/assets-history.json')  ─────▶  v3.assetsHistory
                                              ↓
                                     renderAssetTrendChart()
                                     renderPositions()  (unchanged)

Write:
  Manual-Entry save  ──▶  v3.assetsHistory  ──▶  localStorage['td.assetsHistory.v1']
                                              ──▶  re-render
  Export JSON button ──▶  download .json or show in <textarea> for copy
```

## Refresh behavior (related scope)
- Add `setInterval(renderAll, 60000)` — every 60s re-renders from current state (no fetch)
- Existing `#lastRefreshTime` updates on each tick
- Manual Refresh button: re-reads localStorage + re-renders

## Backward compatibility
- Existing `v3.portfolio` array kept as the hard-coded fallback if JSON fetch and localStorage both miss.
- If `data/assets-history.json` has a snapshot with `totalMV: null`, renderer computes it from `byTicker.shares × seedQuotes[ticker].price` so the chart still plots.
- No existing IDs touched. No existing charts re-keyed.

## Test plan
1. Open `file:///.../index.html` or serve with `python3 -m http.server` — dashboard loads, no console errors.
2. Confirm new `canvas#assetTrendChart` renders with ≥1 data point (this month, computed).
3. Click `+ 이번 달 스냅샷 추가` — modal opens, save flow persists to localStorage, chart re-renders.
4. Refresh browser (F5) — edited snapshot persists.
5. `localStorage.clear(); location.reload()` — falls back to JSON seed cleanly.
6. Resize viewport to 480px — Cost line hides; no overflow.
7. Click ticker row external-link icons (next scope) — TradingView + saveticker tabs open with correct symbols.

## Out of scope for this design
- TradingView / saveticker per-ticker link icons in the positions table — separate design doc (same day)
- Auto-fetch live quotes — explicitly deferred (brokers have no API; user said "수동")
