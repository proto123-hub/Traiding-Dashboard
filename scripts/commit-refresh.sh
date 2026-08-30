#!/usr/bin/env bash
# Commit and push the refresh output. Invoked by .github/workflows/data-refresh.yml.
#
# Why this is a file rather than an inline `run:` block: the workflow's writer
# was the one part of this repo tested by pattern-matching YAML, and every round
# of that lost. A regex over a script cannot tell `git commit -m "..."` from
# `git -c commit.gpgSign=false commit -am "..."`, cannot see a line
# continuation, and cannot say whether the guard it matched is the one that
# runs. As a checked-in script with fail-fast semantics it is executed
# end-to-end by scripts/test/commit-refresh.test.mjs against a scratch
# repository, which is the only way to assert what it actually does.
#
# set -u and pipefail matter here specifically: GitHub Actions runs `run:`
# blocks with `bash -e`, and the old test harness ran plain `bash -c`, so a
# fatal `git add missing-path/` still fell through to the commit in test while
# failing the job in CI. The two now agree.
set -euo pipefail

STAGE_PATHS=(data/ reports/raw/ reports/validation/)
MESSAGE="data: scheduled refresh $(date -u +%FT%TZ)"

# `git diff --quiet` does not see untracked files, so a run whose only output
# was a NEW file exited here reporting "no changes" and the file was never
# committed — the later `git add` never ran. That is the shape of a news run
# that appends nothing but still drops reports/raw/<date>-google-news.json with
# its failures, and of the first run of a new year, whose
# data/history/yields-<year>.json does not exist yet. --porcelain lists
# untracked paths too.
if [ -z "$(git status --porcelain -- "${STAGE_PATHS[@]}")" ]; then
    echo "no changes — skipping commit"
    exit 0
fi

git config user.name 'data-refresh-bot'
git config user.email 'bot@users.noreply.github.com'

# Stage the whole data/ tree, not an enumerated list: every file added since
# this line was written (fundamentals.json, and now data/history/*) had to be
# remembered here or it silently never got committed.
git add "${STAGE_PATHS[@]}"
git commit -m "$MESSAGE"

# A push landing mid-run otherwise loses the whole refresh to a rejected
# non-fast-forward (seen 2026-08-18). Rebasing was the first fix, but it fails
# too: two refresh runs regenerate the SAME files, so the replay hits content
# conflicts in all ten of them and exits 1 (seen 2026-08-19). Instead of merging
# generated data, replay it — take origin's tree wholesale, drop this run's
# regenerated files on top, and commit that. Nothing can conflict because
# nothing is merged.
for i in 1 2 3; do
    if git push; then exit 0; fi
    echo "push rejected (attempt $i) — replaying this run's output onto origin"
    tmp=$(mktemp -d)
    git archive HEAD data reports | tar -x -C "$tmp"
    git fetch origin "$GITHUB_REF_NAME"
    git reset --hard "origin/$GITHUB_REF_NAME"
    # news-feed.json is the one append-only file here; overwriting it would drop
    # whatever the other run appended, so both sides are concatenated and then
    # collapsed by scripts/dedupe-news-feed.mjs.
    #
    # This used to be an inline origin-first Map merge, which kept whichever
    # copy it saw first rather than the earliest-collected one — the same "first
    # occurrence" mistake the helper exists to end. The helper is the single
    # definition of the rule; do not reintroduce a second one here.
    if [ -f data/news-feed.json ] && [ -f "$tmp/data/news-feed.json" ]; then
        node -e "
          const fs=require('fs');
          const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
          const b=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
          fs.writeFileSync(process.argv[2],JSON.stringify({...b,items:[...(a.items||[]),...(b.items||[])]},null,2)+'\n');
        " data/news-feed.json "$tmp/data/news-feed.json"
    fi
    cp -r "$tmp"/data "$tmp"/reports .
    rm -rf "$tmp"
    # Collapse by the shared rule (earliest collectedAt wins), then re-validate:
    # the replayed tree is a DIFFERENT tree from the one the integrity step in
    # the workflow checked, and it was previously committed without any check.
    node scripts/dedupe-news-feed.mjs
    node scripts/validate-data.mjs
    git add "${STAGE_PATHS[@]}"
    if git diff --cached --quiet; then echo "origin already has this data"; exit 0; fi
    git commit -m "data: scheduled refresh $(date -u +%FT%TZ)"
    sleep $((i * 3))
done
git push
