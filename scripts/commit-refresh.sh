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

# `git add <path>` is fatal when the pathspec matches nothing, and under
# `set -e` that aborts the run. A scope directory really can be absent — origin
# deleting the last file in reports/raw/ removes it, and the replay's reset then
# lands on a tree without it. An existing empty directory stages nothing and is
# not an error, so make sure each scope exists before staging.
ensure_scopes() { mkdir -p "${STAGE_PATHS[@]}"; }
MESSAGE="data: scheduled refresh $(date -u +%FT%TZ)"

# `git diff --quiet` does not see untracked files, so a run whose only output
# was a NEW file exited here reporting "no changes" and the file was never
# committed — the later `git add` never ran. That is the shape of a news run
# that appends nothing but still drops reports/raw/<date>-google-news.json with
# its failures, and of the first run of a new year, whose
# data/history/yields-<year>.json does not exist yet. --porcelain lists
# untracked paths too.
ensure_scopes
if [ -z "$(git status --porcelain -- "${STAGE_PATHS[@]}")" ]; then
    echo "no changes — skipping commit"
    exit 0
fi

git config user.name 'data-refresh-bot'
git config user.email 'bot@users.noreply.github.com'

# Stage the whole data/ tree, not an enumerated list: every file added since
# this line was written (fundamentals.json, and now data/history/*) had to be
# remembered here or it silently never got committed.
# The commit this run starts from. The replay below needs it to know which
# changes are ITS OWN rather than replaying whatever the tree happens to hold.
BASE=$(git rev-parse HEAD)

ensure_scopes
git add "${STAGE_PATHS[@]}"
git commit -m "$MESSAGE"

# This run's output, frozen. The replay below must re-derive its delta from a
# commit that cannot move: recomputing it from HEAD worked for one rejection and
# broke on the second, because by then HEAD is the replay commit and carries the
# FIRST competing push's changes too. `BASE..HEAD` then claimed those as this
# run's output and replayed them over a third push, silently reverting it —
# reproduced against a real bare origin. BASE..RUN_COMMIT is the same delta on
# every attempt.
RUN_COMMIT=$(git rev-parse HEAD)

# A push landing mid-run otherwise loses the whole refresh to a rejected
# non-fast-forward (seen 2026-08-18). Rebasing was the first fix, but it fails
# too: two refresh runs regenerate the SAME files, so the replay hits content
# conflicts in all ten of them and exits 1 (seen 2026-08-19).
#
# Replaying by overlaying an archive of the whole data/ and reports/ tree was
# the second fix, and it silently lost data three ways — verified against a real
# bare origin: a file this run DELETED came back, a file origin modified that
# this run never touched was overwritten with stale bytes, and a file origin
# deleted came back. `cp -r` cannot express a deletion, and a whole-tree
# snapshot is not this run's delta.
#
# So compute the delta — what this run changed, scoped to the staged paths —
# and apply only that on top of origin's tree. Anything origin did to a file
# this run did not touch survives untouched.
for i in 1 2 3; do
    if git push; then exit 0; fi
    echo "push rejected (attempt $i) — replaying this run's delta onto origin"
    tmp=$(mktemp -d)
    # --no-renames: a rename would emit two paths and desync the read loop below.
    git diff --name-status --no-renames -z "$BASE" "$RUN_COMMIT" -- "${STAGE_PATHS[@]}" > "$tmp/delta"
    git fetch origin "$GITHUB_REF_NAME"
    git reset --hard "origin/$GITHUB_REF_NAME"

    while IFS= read -r -d '' status && IFS= read -r -d '' path; do
        case "$status" in
            D)
                git rm -q -f --ignore-unmatch -- "$path"
                ;;
            *)
                # news-feed.json is append-only, and origin may hold items this
                # run never saw. Taking our copy wholesale drops them, so both
                # sides are concatenated and collapsed by the shared helper
                # below (earliest collectedAt wins). This used to be an inline
                # origin-first Map merge, which kept whichever copy it saw first
                # — the "first occurrence" mistake the helper exists to end. Do
                # not reintroduce a second definition of the rule here.
                if [ "$path" = data/news-feed.json ] && [ -f "$path" ]; then
                    cp "$path" "$tmp/origin-news-feed.json"
                    git checkout "$RUN_COMMIT" -- "$path"
                    node -e "
                      const fs=require('fs');
                      const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
                      const b=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
                      fs.writeFileSync(process.argv[2],JSON.stringify({...b,items:[...(a.items||[]),...(b.items||[])]},null,2)+'\n');
                    " "$tmp/origin-news-feed.json" "$path"
                else
                    # `git checkout <commit> -- <path>`, not `git show > file`:
                    # a redirect writes bytes and loses the object's type and
                    # mode, so a committed symlink came back as a regular file
                    # and an executable bit would be dropped. Restoring through
                    # git reproduces the entry faithfully.
                    mkdir -p "$(dirname "$path")"
                    git checkout "$RUN_COMMIT" -- "$path"
                fi
                ;;
        esac
    done < "$tmp/delta"
    rm -rf "$tmp"

    # Collapse by the shared rule, then re-validate: the replayed tree is a
    # DIFFERENT tree from the one the workflow's integrity step checked, and it
    # was once committed with no check at all.
    node scripts/dedupe-news-feed.mjs
    node scripts/validate-data.mjs
    ensure_scopes
    git add "${STAGE_PATHS[@]}"
    if git diff --cached --quiet; then echo "origin already has this data"; exit 0; fi
    git commit -m "data: scheduled refresh $(date -u +%FT%TZ)"
    sleep $((i * 3))
done
git push
