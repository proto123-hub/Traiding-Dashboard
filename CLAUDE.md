# Trading Dashboard — Project Conventions (for Claude Code)

Single-file HTML dashboard (`index.html`) + typed JSON data layer (`data/*.json`) +
7 Claude Code subagents under `.claude/agents/`. No build step, no framework, no
server. Chart.js is loaded via CDN. That's it.

## Repo map

```
.
├── index.html                    # the dashboard — single file
├── data/
│   ├── README.md                 # schema reference — update when adding fields
│   ├── portfolio-current.json    # current holdings (human-authored)
│   ├── assets-history.json       # monthly snapshots (human-authored via UI)
│   ├── tickers-universe.json     # analysis universe / watchlist
│   ├── valuations.json           # owned by evaluator agent
│   ├── risk-scores.json          # owned by evaluator agent
│   ├── news-feed.json            # owned by collector + validator
│   └── sector-map.json           # ticker → sector → theme
├── .claude/agents/
│   ├── planner.md                # 기획/검토 — routes work
│   ├── architect.md              # 설계 — design docs
│   ├── builder.md                # 구축 — code from design docs
│   ├── collector.md              # 수집 — raw news/price
│   ├── validator.md              # 검증 — ≥2-source confirm
│   ├── evaluator.md              # 평가 — FV bands + risk scores
│   └── interpreter.md            # 해석 — human-facing analyst reports
└── reports/
    ├── templates/                # ticker-evaluation / sector-review / monthly-brief
    ├── designs/                  # architect output
    ├── raw/                      # collector output
    ├── validation/               # validator output
    └── YYYY-MM/                  # interpreter output (the actual briefs)
```

## Agent orchestration (Main-Serve pattern)

The main Claude Code session is the **orchestrator**. It does not analyze — it
delegates. Typical flow:

```
User request
  ↓
main (orchestrator)
  ↓ Agent tool
  planner → work plan (TodoWrite)
  ↓
  architect* → design doc               (* only when schema/UI changes)
  ↓
  builder*   → code
  ↓
  collector  → reports/raw/
  ↓
  validator  → data/news-feed.json (verified=true)
  ↓
  evaluator  → data/valuations.json + data/risk-scores.json
  ↓
  interpreter → reports/YYYY-MM/*.md
  ↓
main summarizes + returns
```

**Rules for the orchestrator:**
- Always start with `planner` for any multi-step request. Let it size the job.
- Never skip `validator` before `evaluator`. Raw data must be stamped.
- Never skip `architect` for schema changes. Even if "it's just a field".
- One agent at a time unless they're genuinely independent (e.g. collector for
  2 unrelated tickers can run in parallel).
- Relay only the summary from each agent back to main — don't dump full outputs.

## Data conventions

- All prices USD. Percents as fractions in JSON (`0.4355`), as `%` in UI.
- Dates ISO: `YYYY-MM-DD` for day, `YYYY-MM` for month.
- Timestamps UTC ISO 8601 with `Z`: `2026-04-22T18:00:00Z`.
- Every agent write must include `updated` and `agent` fields.
- `decisionLog[]` is append-only. Never rewrite history.

## Dashboard conventions

- Single HTML file. Do not introduce a build step.
- CSS vars live in `:root`. No new hex colors — use the palette.
- IDs are kebab-case, JS functions camelCase, `v3.*` namespace for globals.
- New charts: use Chart.js v4.4 (already loaded). Set `maintainAspectRatio: false` and wrap the `<canvas>` in a sized div.
- Mobile breakpoints: 1024 / 768 / 480 / 380. Test every new UI element at 480.
- localStorage keys: `td.<scope>.v<n>` (e.g., `td.assetsHistory.v1`).

## Local dev

```bash
# Serve the site
python3 -m http.server 8765

# Validate JSON
for f in data/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" && echo OK $f; done

# Syntax-check inline scripts
node -e "const html=require('fs').readFileSync('index.html','utf8');[...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].forEach((m,i)=>{try{new Function('async function __(){'+m[1]+'}');console.log('script',i,'OK')}catch(e){console.log('script',i,e.message)}})"
```

## Git workflow

- Feature branch: `claude/<slug>`
- Commit style: follow history (`<scope>: <imperative> — <1-line why>`)
- Draft PR on push; user marks "ready for review" when green.
- Never commit localStorage exports — they live in the user's browser. To
  persist, the user clicks "JSON 내보내기" and commits the contents of
  `data/assets-history.json` manually.

## Known non-goals

- **No broker API integration.** Kiwoom / Samsung Securities have no public API.
  All portfolio data is manual entry via the dashboard UI.
- **No real-time quotes.** Seed prices are captured daily from TradingView
  (Kapture) and committed to `index.html` as `v3.seedQuotes`. Auto-refresh
  only re-renders the UI; it does not fetch.
- **No backend.** `localStorage` is the only persistence between sessions;
  git is the only persistence across devices.
