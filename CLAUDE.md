# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Trading Dashboard / LLM Wiki Trading OS — Project Conventions

Single-file HTML dashboard (`index.html`) + typed JSON data layer (`data/*.json`) +
zero-dependency Node scrapers (`scripts/*.mjs`) + 9 Claude Code subagents under
`.claude/agents/`. No build step, no framework, no backend, no npm install.
Chart.js is loaded via CDN. Served as a plain static site on GitHub Pages —
`.nojekyll` is required (inline `${...}` template literals break Jekyll/Liquid).

## Project direction — LLM Wiki Trading OS

This repo is the working dashboard behind Daniel's **LLM Wiki Trading OS**
(published at https://trading-os-llm-wiki.slyvie.chatgpt.site). Context:

- The knowledge base itself is authored in a local Obsidian vault
  (`D:\Obsidian\Trading_OS\Trading_OS` on Daniel's machine) — it is **not** in
  this repo. This repo holds the data pipeline, dashboard UI, and analyst reports.
- UI/UX benchmark: https://prayzero.github.io/nikke-overload-archive/ (a friend's
  static archive site). Reference for layout/polish only — content is unrelated.
- Standing quality bar: clean UI, and every conclusion / prediction / evaluation
  must be **fact-verification based** — this is exactly what the
  collector → validator (≥2-source) → evaluator → interpreter pipeline enforces.
  Never let narrative get ahead of stamped data.
- The repo is co-maintained by Claude (Cowork / Claude Code) **and** ChatGPT
  (Codex) sessions, plus a GitHub Actions bot. Follow the conventions in this
  file strictly and append to `SESSION_LOG.md` so cross-tool sessions can
  reconstruct state.
- **Work-start declaration (착수 선언)**: before beginning any multi-step
  session, append a one-line start entry to `SESSION_LOG.md` (mark it `⏳`)
  naming the scope and branch, and push it early. Append the completion
  summary as a separate line when done — never edit the start line (the log
  is append-only). A tool seeing another tool's open `⏳` entry must not
  start overlapping work. (Added 2026-08-18 after a Claude/Codex duplicate
  implementation of the watchlist view.)

## Coding Behavior — Karpathy Guidelines

> Behavioral rules to reduce common LLM coding mistakes. Bias toward caution over speed; for trivial tasks use judgment.
> Source: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) · [@karpathy](https://x.com/karpathy/status/2015883857489522876)

### 1. Think Before Coding — 코딩 전에 생각하라
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain, ask.
- Multiple interpretations? Present them — don't pick silently.
- Simpler approach exists? Say so. Push back when warranted.
- Unclear? Stop. Name what's confusing. Ask.

### 2. Simplicity First — 단순함이 우선
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- 200 lines could be 50? Rewrite.
- Self-check: "Would a senior engineer call this overcomplicated?"

### 3. Surgical Changes — 외과적 변경
**Touch only what you must. Clean up only your own mess.**
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Notice unrelated dead code? Mention it — don't delete it.
- Remove only orphans (imports/vars/funcs) YOUR changes created.
- Test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution — 목표 주도 실행
**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan with verify steps:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let me loop independently. Weak criteria ("make it work") force constant clarification.

> **Working when:** fewer unnecessary diff lines · fewer rewrites due to overcomplication · clarifying questions come *before* implementation, not after mistakes.

---

## Repo map

```
.
├── index.html                    # the dashboard — single file (~1.1k lines, inline CSS/JS)
├── data.js                       # v3.6 seed/mock layer loaded before the JSON fetches
├── valuation-dashboard-v3.6.html # LEGACY predecessor — reference only, do not extend
├── SESSION_LOG.md                # append-only session log (newest first, KST, 한국어)
├── .nojekyll                     # required for GitHub Pages
├── data/
│   ├── README.md                 # schema reference — THE authority; update when adding fields
│   ├── portfolio-current.json    # current holdings (human-authored via UI)
│   ├── assets-history.json       # monthly snapshots (human-authored via UI)
│   ├── tickers-universe.json     # watchlist + macro indices
│   ├── price-quotes.json         # cron-scraped quotes w/ cross-source verified flags
│   ├── valuations.json           # owned by evaluator agent
│   ├── risk-scores.json          # owned by evaluator agent
│   ├── news-feed.json            # collector/cron appends, validator stamps (LARGE — see Gotchas)
│   └── sector-map.json           # ticker → sector → theme
├── scripts/                      # Node 20, stdlib-fetch only, zero npm deps
│   ├── scrape-quotes.mjs         # quotes → data/price-quotes.json + reports/raw/ drop
│   ├── scrape-news.mjs           # headlines → data/news-feed.json (verified=false)
│   ├── verify-quotes.mjs         # cross-source verify pass → reports/validation/ drop
│   └── lib/io.mjs                # readJson / writeJsonAtomic / timeouts / semaphore
├── .github/workflows/data-refresh.yml  # cron 11:00 & 21:00 UTC weekdays → commits to main
├── .claude/agents/               # 9 subagents (see orchestration below)
└── reports/                      # see reports/README.md for naming + lifecycle
    ├── templates/  designs/  raw/  validation/
    └── YYYY-MM/                  # interpreter output (the actual briefs)
```

## Two lanes, one data layer

### Lane 1 — Interactive analysis (Claude Code session)

The main session is the **orchestrator**. It does not analyze — it delegates:

```
planner → (architect* → builder*) → collector → validator → evaluator → interpreter
                                     * only when schema/UI changes
```

**Rules for the orchestrator:**
- Always start with `planner` for any multi-step request. Let it size the job.
- Never skip `validator` before `evaluator`. Raw data must be stamped.
- Never skip `architect` for schema changes. Even if "it's just a field".
- One agent at a time unless genuinely independent (e.g. collector for 2
  unrelated tickers can run in parallel).
- Relay only the summary from each agent back to main — don't dump full outputs.

### Lane 2 — Automated refresh (GitHub Actions + refresher/comparator agents)

`data-refresh.yml` runs five scripts twice each weekday (pre-market +
post-close) and commits changed data as `data-refresh-bot` **directly to main**.
Quotes, news, verify and yields run on both slots; fundamentals only on the
post-close slot.
The `refresher` agent runs the same scripts interactively ("quotes look stale");
the `comparator` agent diffs any two quote feeds (e.g. Kapture import vs scrape).
Refresh updates `currentPrice`-type fields only — **FV bands never move on a
price refresh**; that requires the evaluator.

## Data conventions

- Schemas live in `data/README.md` — read it before touching any `data/*.json`,
  update it when adding fields.
- All prices USD. Percents as fractions in JSON (`0.4355`), as `%` in UI.
- Dates ISO: `YYYY-MM-DD` for day, `YYYY-MM` for month. Timestamps UTC ISO 8601
  with `Z`.
- Every agent write must include `updated` and `agent` fields.
- `decisionLog[]` and `SESSION_LOG.md` are append-only. Never rewrite history.
- Quote `verified=true` means ≥2 independent sources agreed within tolerance
  (default 0.2%); single-source quotes stay `verified=false` and block the
  evaluator for held positions.

## Dashboard conventions

- Single HTML file. Do not introduce a build step.
- Boot order: `data.js` seed renders immediately → non-blocking `fetch()` of
  `data/*.json` populates valuation panel + watchlist → `localStorage` overlays
  user edits (`localStorage[key] → data/*.json → hard-coded fallback`).
- CSS vars live in `:root`. No new hex colors — use the palette.
- IDs are kebab-case, JS functions camelCase, `v3.*` namespace for globals.
- New charts: Chart.js v4.4 (already loaded). Set `maintainAspectRatio: false`
  and wrap the `<canvas>` in a sized div.
- Mobile breakpoints: 1024 / 768 / 480 / 380. Test every new UI element at 480.
- localStorage keys: `td.<scope>.v<n>` (e.g., `td.assetsHistory.v1`).

## Local dev

```bash
# Serve the site (fetch() needs http://, not file://)
python3 -m http.server 8765

# Run the refresh pipeline manually (same as CI)
node scripts/scrape-quotes.mjs && node scripts/scrape-news.mjs && node scripts/verify-quotes.mjs \
  && node scripts/scrape-yields.mjs && node scripts/scrape-fundamentals.mjs

# Validator: fixtures first, then the committed data layer (what CI runs)
node scripts/test/validate-data.test.mjs && node scripts/validate-data.mjs

# Validate JSON
find data -name '*.json' -print0 | while IFS= read -r -d '' f; do node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$f" && echo OK "$f"; done

# Syntax-check inline scripts
node -e "const html=require('fs').readFileSync('index.html','utf8');[...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].forEach((m,i)=>{try{new Function('async function __(){'+m[1]+'}');console.log('script',i,'OK')}catch(e){console.log('script',i,e.message)}})"
```

There is no linter. The verification gate is `scripts/validate-data.mjs` —
read-only integrity checks over the committed data layer — plus its fixture
suite in `scripts/test/`, and `.github/workflows/validate.yml` runs both on
every PR and on every push except to `main`. The fixtures run **first**: a green pass over live data
proves nothing if the checks themselves have been weakened, so each of the 25
fixtures is either a recorded shape this repo shipped (14) or a minimal
construction of a defect path the code actually permitted (11, each verified by
reproducing `fail: []` against the pre-fix check), and each must-fail case pins
the expected failure *reason*. Add a fixture with every new invariant. The
JSON-validate and script-syntax checks above still apply, plus loading the page
and watching the console.

## Git workflow

- Feature branch: `claude/<slug>`
- Commit style: follow history (`<scope>: <imperative> — <1-line why>`)
- Draft PR on push; user marks "ready for review" when green.
- The refresh bot pushes to `main` twice each weekday. Before pushing a
  long-lived branch, fetch and rebase; conflicts in `data/price-quotes.json`,
  `data/news-feed.json`, `reports/raw/`, `reports/validation/` should be
  resolved by taking the newer bot data or re-running the scripts — never
  hand-merged. **"Newer" means newer output of the same scraper.** If the
  branch changes a scraper, `main`'s bot data is newer by clock but is the
  old code's output — take the branch's, and let the bot regenerate after
  merge. (2026-08-20: main's `price-quotes.json` was 43 min newer and
  0/27 verified against the branch's 27/29.)
- Never commit localStorage exports — they live in the user's browser. To
  persist, the user clicks "JSON 내보내기" and commits the contents of
  `data/assets-history.json` manually.

## Known non-goals

- **No broker API integration.** Kiwoom / Samsung Securities have no public API.
  All portfolio data is manual entry via the dashboard UI.
- **No real-time/streaming quotes.** Quotes come from the twice-daily cron
  scrape (plus optional manual Kapture import). The dashboard's auto-refresh
  only re-renders; the browser fetches same-origin `data/*.json` only, never
  external APIs.
- **No backend.** `localStorage` is the only persistence between sessions;
  git is the only persistence across devices.
- **No npm dependencies.** Scripts use Node 20 stdlib `fetch` + `scripts/lib/io.mjs`.

## Gotchas

- **The refresher/comparator agent files still name dead sources.**
  `.claude/agents/refresher.md` and `.claude/agents/comparator.md` describe
  "Yahoo + Saveticker". All three of those are gone: Saveticker 403s
  non-browser UAs, and **Yahoo and Stooq were removed 2026-08-18** after a
  runner-IP probe found Yahoo 429ing the first request of every run from a
  freshly warmed cookie, and Stooq's endpoint returning a branded 404 on both
  stooq.com and the .pl mirror (`reports/validation/2026-08-18-source-probe.md`).
  The live roster is **NASDAQ + Cboe + CNBC** for quotes, **CNBC + SEC XBRL +
  stockanalysis + NASDAQ** for fundamentals, and **Google News RSS** for
  headlines. `data/README.md` was corrected in that pass; the two agent files
  were not. The header comments in `scripts/*.mjs` are authoritative on source
  selection and rate limits.
- **`data/news-feed.json` is multi-MB** (cron-appended). Never read it whole
  into context — slice with `node -e` / `grep` by ticker or date.
- **`valuation-dashboard-v3.6.html` is legacy.** It predates `index.html` and
  is kept for reference; new work goes in `index.html` only.
- **Never edit `data/price-quotes.json` by hand** — always go through the
  scripts so the audit trail lands in `reports/raw/`.
- **Report naming/lifecycle** is specified in `reports/README.md` (ISO-date
  prefix, per-folder ownership). The interpreter's `reports/YYYY-MM/*.md` is
  the only prose artifact; everything upstream is audit trail.
