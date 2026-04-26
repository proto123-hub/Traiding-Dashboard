# Reports — Output Tree

Each subfolder is owned by a specific agent. Human-readable narrative lives in
`reports/YYYY-MM/`. Everything else is machine-readable scaffolding.

```
reports/
├── README.md                     # you are here
├── templates/                    # skeleton files copied for each new report type
│   ├── ticker-evaluation.md
│   ├── sector-review.md
│   └── monthly-brief.md
├── designs/                      # owner: architect
│   └── YYYY-MM-DD-<slug>.md      # design docs consumed by the builder
├── raw/                          # owner: collector
│   └── YYYY-MM-DD-<slug>.json    # raw feeds before validation
├── validation/                   # owner: validator
│   └── YYYY-MM-DD-<slug>.md      # per-cycle verification summaries
└── YYYY-MM/                      # owner: interpreter (final analyst output)
    └── YYYY-MM-DD-<slug>.md
```

## Naming rules

- Always prefix with the ISO date of the event the report covers (not the date
  you wrote it, unless they're the same).
- `<slug>` uses lowercase, hyphenated, ASCII only (e.g., `googl-gemini3-preview`).
- Per-ticker reports start with the ticker: `2026-04-22-googl-revalue.md`.
- Monthly / weekly briefs use: `2026-04-weekly-17.md`, `2026-04-monthly-close.md`.

## Lifecycle

```
collector  →  reports/raw/
              ↓
validator  →  reports/validation/  (stamps data/news-feed.json)
              ↓
evaluator  →  data/valuations.json + data/risk-scores.json
              ↓
interpreter → reports/YYYY-MM/*.md  (cites sources from the validator)
```

The interpreter's report is the only artifact meant to be read as prose. All
upstream artifacts are audit trail.
