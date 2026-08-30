#!/usr/bin/env node
// End-to-end tests for scripts/commit-refresh.sh — the workflow's writer.
//
// This replaces four rounds of pattern-matching .github/workflows/data-refresh.yml,
// every one of which was bypassable. A regex over YAML could not tell
// `git commit -m "..."` from `git -c commit.gpgSign=false commit -am "..."`,
// could not follow a line continuation, could not say whether the `if` it
// matched was the guard that runs, and broke outright on a CRLF checkout.
//
// So nothing here reads the script's text. Each case builds a scratch
// repository with a real `origin`, runs the actual script, and asserts on what
// git ended up holding: whether HEAD moved, what the commit contains, and what
// was left staged. The invariants are
//
//   - a clean tree produces NO commit
//   - a change in any of data/ (root and nested), reports/raw/ and
//     reports/validation/ — modified, deleted, or newly added — produces
//     exactly ONE commit
//   - that commit contains only paths under those three roots
//   - a rejected push replays onto origin and still commits exactly once more
//
// Run: node scripts/test/commit-refresh.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const REPO = process.cwd();
const SCRIPT = join(REPO, 'scripts/commit-refresh.sh');
const SCOPES = [
    'data/news-feed.json',
    'data/history/yields-2026.json',
    'reports/raw/2026-08-01-quotes.json',
    'reports/validation/2026-08-01-compare.json',
];

let bad = 0, ran = 0;
const fail = (l, m) => { ran++; console.log(`  FAIL ${l}: ${m}`); bad++; };
const ok = (l, w) => { ran++; console.log(`  ok   ${l} — ${w}`); };

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** A work repo with a real origin, seeded with one file per scope plus CLAUDE.md. */
function scratch() {
    const root = mkdtempSync(join(tmpdir(), 'commit-refresh-'));
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'pipe' });
    execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
    git(work, 'config', 'user.email', 't@t');
    git(work, 'config', 'user.name', 't');
    for (const rel of SCOPES) {
        mkdirSync(join(work, dirname(rel)), { recursive: true });
        writeFileSync(join(work, rel), '{"seed":1}\n');
    }
    writeFileSync(join(work, 'CLAUDE.md'), 'unrelated\n');
    // reports/ holds more than the two scopes the bot may write: the
    // interpreter's reports/YYYY-MM/ briefs and reports/designs/ are
    // hand-authored and must never ride along on a scheduled refresh. Seeded
    // here so broadening STAGE_PATHS to `reports/` is visible.
    mkdirSync(join(work, 'reports/2026-08'), { recursive: true });
    writeFileSync(join(work, 'reports/2026-08/brief.md'), '# analyst brief\n');
    // The replay path runs these two.
    mkdirSync(join(work, 'scripts'), { recursive: true });
    // Stubs that RECORD they ran, so the replay case can assert both were
    // invoked and in which order. dedupe-news-feed.mjs collapsing the feed
    // after validate-data.mjs checked it would commit a tree nothing verified —
    // the defect the ordering exists to prevent.
    for (const f of ['dedupe-news-feed.mjs', 'validate-data.mjs']) {
        writeFileSync(join(work, 'scripts', f),
            `import { appendFileSync } from 'node:fs';\n` +
            `appendFileSync(process.env.REPLAY_TRACE, ${JSON.stringify(f)} + '\\n');\n`);
    }
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'seed');
    git(work, 'push', '-q', 'origin', 'main');
    return { root, origin, work };
}

/** Run the real script. Returns {status, out, commits, staged, head}. */
function run(work, trace = join(work, '.trace')) {
    const before = git(work, 'rev-list', '--count', 'HEAD');
    let status = 0, out = '';
    try {
        out = execFileSync('bash', [SCRIPT], {
            cwd: work, encoding: 'utf8', stdio: 'pipe',
            env: { ...process.env, GITHUB_REF_NAME: 'main', REPLAY_TRACE: trace },
        });
    } catch (e) { status = e.status ?? -1; out = `${e.stdout || ''}${e.stderr || ''}`; }
    const after = git(work, 'rev-list', '--count', 'HEAD');
    return {
        status, out,
        commits: Number(after) - Number(before),
        staged: git(work, 'diff', '--cached', '--name-only').split('\n').filter(Boolean),
        files: Number(after) > Number(before)
            ? git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
            : [],
        trace: existsSync(trace) ? readFileSync(trace, 'utf8').split('\n').filter(Boolean) : [],
    };
}

// ------------------------------------------------------------ clean tree
{
    const label = 'a clean tree produces no commit';
    const { root, work } = scratch();
    const r = run(work);
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(0, 200)}`);
    else if (r.commits !== 0) fail(label, `made ${r.commits} commit(s) with nothing to commit`);
    else if (!r.out.includes('no changes')) fail(label, `exited 0 but did not report "no changes": ${JSON.stringify(r.out.trim())}`);
    else ok(label, 'the guard stops the run before it commits');
    rmSync(root, { recursive: true, force: true });
}

// -------------------------------------------- every scope, every change kind
for (const rel of SCOPES) {
    for (const [how, apply] of [
        ['modified', (w) => writeFileSync(join(w, rel), '{"seed":2}\n')],
        ['deleted', (w) => rmSync(join(w, rel))],
        ['joined by a new file', (w) => writeFileSync(join(w, dirname(rel), 'brand-new.json'), '{}\n')],
    ]) {
        const label = `${rel} ${how}`;
        const { root, work } = scratch();
        apply(work);
        const r = run(work);
        if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(0, 200)}`);
        else if (r.commits !== 1) fail(label, `made ${r.commits} commit(s), expected exactly 1 — that output would not be committed`);
        else if (r.staged.length) fail(label, `left ${JSON.stringify(r.staged)} staged after committing`);
        else ok(label, `committed exactly once (${r.files.join(', ')})`);
        rmSync(root, { recursive: true, force: true });
    }
}

// ----------------------------------------------- nothing outside the scopes
{
    const label = 'an unrelated file is never committed';
    const { root, work } = scratch();
    writeFileSync(join(work, 'data/news-feed.json'), '{"seed":2}\n');
    writeFileSync(join(work, 'CLAUDE.md'), 'touched by another step\n');
    writeFileSync(join(work, 'index.html'), '<p>touched</p>\n');
    writeFileSync(join(work, 'reports/2026-08/brief.md'), '# edited by a human\n');
    const r = run(work);
    const leaked = r.files.filter(f => !/^(data|reports\/raw|reports\/validation)\//.test(f));
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(0, 200)}`);
    else if (r.commits !== 1) fail(label, `made ${r.commits} commit(s), expected 1`);
    else if (leaked.length) fail(label, `committed out-of-scope ${JSON.stringify(leaked)} — only data/, reports/raw/ and reports/validation/ may be staged`);
    else ok(label, 'CLAUDE.md, index.html and the interpreter brief stay out of the commit');
    rmSync(root, { recursive: true, force: true });
}

// ------------------------------------------------------------ replay path
{
    const label = 'a rejected push replays onto origin and commits once more';
    const { root, origin, work } = scratch();
    // Another clone pushes first, so this run's push is rejected.
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    writeFileSync(join(other, 'data/news-feed.json'), '{"items":[{"id":"from-origin"}]}\n');
    git(other, 'commit', '-qam', 'origin moved');
    git(other, 'push', '-q', 'origin', 'main');

    writeFileSync(join(work, 'reports/raw/2026-08-02-quotes.json'), '{"mine":1}\n');
    writeFileSync(join(work, 'data/news-feed.json'), '{"items":[{"id":"from-mine"}]}\n');
    const r = run(work);
    const head = git(work, 'log', '-1', '--format=%s');
    const onOrigin = git(work, 'ls-tree', '-r', '--name-only', 'origin/main');
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(-300)}`);
    else if (!r.out.includes('push rejected')) fail(label, 'the push was not rejected — the replay path never ran');
    else if (!/^data: scheduled refresh /.test(head)) fail(label, `HEAD is ${JSON.stringify(head)}, not a refresh commit`);
    else if (!onOrigin.includes('reports/raw/2026-08-02-quotes.json')) fail(label, "this run's output did not reach origin");
    else if (r.trace.join(' ') !== 'dedupe-news-feed.mjs validate-data.mjs') {
        fail(label, `the replay ran ${JSON.stringify(r.trace)} — it must dedupe then re-validate, or it commits a tree nothing checked`);
    }
    else ok(label, "origin's tree is taken wholesale, this run's output replayed on top, deduped then re-validated");
    rmSync(root, { recursive: true, force: true });
}

// ------------------------------------- replay must apply a DELTA, not a tree
//
// Overlaying an archive of the whole data/ and reports/ tree lost data three
// ways, each reproduced against a real bare origin before this was written: a
// file this run deleted came back, a file origin modified that this run never
// touched was overwritten with stale bytes, and a file origin deleted came
// back. `cp -r` cannot express a deletion, and a snapshot is not a delta.

{
    const label = 'replay preserves this run\'s deletion and origin\'s concurrent edits';
    const { root, origin, work } = scratch();
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    // Origin edits a file this run never touches, deletes another, and adds one.
    writeFileSync(join(other, 'reports/validation/2026-08-01-compare.json'), '{"origin":"edited"}\n');
    git(other, 'rm', '-q', 'reports/raw/2026-08-01-quotes.json');
    writeFileSync(join(other, 'data/history/yields-2027.json'), '{"origin":"added"}\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-qm', 'origin moved');
    git(other, 'push', '-q', 'origin', 'main');

    // This run deletes one file and modifies another.
    rmSync(join(work, 'data/history/yields-2026.json'));
    writeFileSync(join(work, 'data/news-feed.json'), '{"items":[{"id":"mine"}]}\n');
    const r = run(work);

    const tree = git(work, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    const read = (rel) => tree.includes(rel) ? git(work, 'show', `HEAD:${rel}`) : null;
    const problems = [];
    if (tree.includes('data/history/yields-2026.json')) problems.push('this run deleted data/history/yields-2026.json and the replay resurrected it');
    if (tree.includes('reports/raw/2026-08-01-quotes.json')) problems.push("origin deleted reports/raw/2026-08-01-quotes.json and the replay resurrected it");
    if (!/"origin":\s*"edited"/.test(read('reports/validation/2026-08-01-compare.json') || '')) {
        problems.push("origin's edit to reports/validation/2026-08-01-compare.json was overwritten with this run's stale copy");
    }
    if (!/"origin":\s*"added"/.test(read('data/history/yields-2027.json') || '')) problems.push("origin's new data/history/yields-2027.json did not survive");
    if (r.status !== 0) problems.push(`exited ${r.status}: ${r.out.trim().slice(-200)}`);
    if (problems.length) fail(label, problems.join(' | '));
    else ok(label, "only this run's delta is replayed; everything else origin did survives");
    rmSync(root, { recursive: true, force: true });
}

{
    const label = 'replay unions the append-only feed instead of overwriting it';
    const { root, origin, work } = scratch();
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    writeFileSync(join(other, 'data/news-feed.json'), '{"items":[{"id":"from-origin","collectedAt":"2026-08-01T00:00:00Z"}]}\n');
    git(other, 'commit', '-qam', 'origin appended');
    git(other, 'push', '-q', 'origin', 'main');

    writeFileSync(join(work, 'data/news-feed.json'), '{"items":[{"id":"from-mine","collectedAt":"2026-08-02T00:00:00Z"}]}\n');
    const r = run(work);
    const feed = git(work, 'show', 'HEAD:data/news-feed.json');
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(-200)}`);
    else if (!feed.includes('from-origin')) fail(label, "origin's appended item was dropped — the feed is append-only");
    else if (!feed.includes('from-mine')) fail(label, "this run's appended item was dropped");
    else ok(label, "both sides' items survive the replay");
    rmSync(root, { recursive: true, force: true });
}

{
    const label = 'replay stages only the allowed scopes and fails closed on the validator';
    const { root, origin, work } = scratch();
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    writeFileSync(join(other, 'CLAUDE.md'), 'origin edit\n');
    git(other, 'commit', '-qam', 'origin moved');
    git(other, 'push', '-q', 'origin', 'main');

    writeFileSync(join(work, 'data/news-feed.json'), '{"items":[]}\n');
    writeFileSync(join(work, 'out-of-scope.txt'), 'must never be pushed\n');
    // Under reports/ but outside the two scopes, and UNTRACKED — `git reset
    // --hard` in the replay discards a tracked modification, so a modified
    // brief.md is clean again by the time the replay stages and broadening the
    // replay's staging alone stayed invisible. An untracked file survives the
    // reset and is exactly what a swept `git add reports/` would pick up.
    writeFileSync(join(work, 'reports/2026-08/draft-brief.md'), '# a human is drafting this\n');
    const r = run(work);
    const pushed = git(work, 'ls-tree', '-r', '--name-only', 'origin/main').split('\n');
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(-200)}`);
    else {
        const head = git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
        const leaked = head.filter(f => !/^(data|reports\/raw|reports\/validation)\//.test(f));
        if (leaked.length) fail(label, `the replay committed out-of-scope ${JSON.stringify(leaked)}`);
        else if (pushed.includes('out-of-scope.txt') || pushed.includes('.trace')) fail(label, 'an out-of-scope file reached origin');
        else ok(label, 'nothing outside data/, reports/raw/ and reports/validation/ reaches origin');
    }
    rmSync(root, { recursive: true, force: true });
}

{
    const label = 'a failing validator aborts the replay before it commits';
    const { root, origin, work } = scratch();
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    writeFileSync(join(other, 'data/history/yields-2026.json'), '{"origin":1}\n');
    // A validator that refuses, committed to origin so the reset restores it.
    writeFileSync(join(other, 'scripts/validate-data.mjs'), 'process.exit(1);\n');
    git(other, 'commit', '-qam', 'origin moved, validator refuses');
    git(other, 'push', '-q', 'origin', 'main');

    writeFileSync(join(work, 'data/news-feed.json'), '{"items":[]}\n');
    // Fetch FIRST: the remote-tracking ref is stale until then, so comparing
    // against it would score origin's own push as "the replay pushed".
    git(work, 'fetch', '-q', 'origin', 'main');
    const before = git(work, 'rev-parse', 'origin/main');
    const r = run(work);
    git(work, 'fetch', '-q', 'origin', 'main');
    const after = git(work, 'rev-parse', 'origin/main');
    if (r.status === 0) fail(label, 'the replay exited 0 with a validator that refuses the tree');
    else if (before !== after) fail(label, 'the replay pushed a tree the validator rejected');
    else ok(label, 'a rejected tree is never committed or pushed');
    rmSync(root, { recursive: true, force: true });
}

// -------------------------------------------------- TWO rejections in a row
//
// One rejection was not enough. With the delta recomputed from HEAD, the first
// replay succeeds and the second claims the FIRST competitor's changes as this
// run's own, replaying them over a later push and silently reverting it.
//
// The competing pushes come from a pre-receive hook on the bare origin that
// rejects the first two pushes and advances main itself. That is deterministic:
// an earlier version raced a detached process against the script's own backoff
// and hung, and before that a setTimeout that could never fire — run() is
// execFileSync, which blocks the event loop.

{
    const label = 'a second rejection does not revert the competitor it never saw';
    const { root, origin, work } = scratch();
    const target = 'reports/validation/2026-08-01-compare.json';
    writeFileSync(join(origin, 'hooks', 'pre-receive'), `#!/bin/bash
set -e
n=$(cat "$GIT_DIR/rejects" 2>/dev/null || echo 0)
if [ "$n" -ge 2 ]; then exit 0; fi
n=$((n + 1)); echo "$n" > "$GIT_DIR/rejects"
# Advance main with a competing change to a file the pushing run never touched.
# Objects written during pre-receive land in the push QUARANTINE and are
# discarded when the hook rejects, so the ref update would point at nothing.
# Write to the real object store instead.
unset GIT_QUARANTINE_PATH GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_OBJECT_DIRECTORY="$GIT_DIR/objects"
blob=$(printf '{"v":%d}\\n' "$((n + 1))" | git hash-object -w --stdin)
export GIT_INDEX_FILE="$GIT_DIR/tmpidx"
git read-tree refs/heads/main
git update-index --add --cacheinfo "100644,$blob,${target}"
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p refs/heads/main -m "rival $n")
git update-ref refs/heads/main "$commit"
rm -f "$GIT_INDEX_FILE"
echo "rejected by test hook (attempt $n)" >&2
exit 1
`);
    execFileSync('chmod', ['+x', join(origin, 'hooks', 'pre-receive')]);

    // This run changes something else entirely.
    writeFileSync(join(work, 'data/history/yields-2026.json'), '{"mine":1}\n');
    const r = run(work);

    git(work, 'fetch', '-q', 'origin', 'main');
    const finalCompare = git(work, 'show', `origin/main:${target}`);
    const mine = git(work, 'show', 'origin/main:data/history/yields-2026.json');
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(-250)}`);
    else if (!/attempt 2/.test(r.out)) fail(label, 'the hook did not reject twice — the second replay was never exercised');
    else if (/"v":\s*2/.test(finalCompare)) {
        fail(label, "the second replay reverted the later competitor to v2 — its delta was recomputed from a moved HEAD and claimed another run's change as this run's own");
    } else if (!/"v":\s*3/.test(finalCompare)) {
        fail(label, `expected the newest competitor's v3 to survive, got ${finalCompare.trim()}`);
    } else if (!/"mine":\s*1/.test(mine)) {
        fail(label, "this run's own output did not reach origin");
    } else ok(label, "the frozen run commit keeps every retry's delta to this run's own output");
    rmSync(root, { recursive: true, force: true });
}

// --------------------------------------------- mode and type survive a replay
{
    const label = 'a replay preserves file mode';
    const { root, origin, work } = scratch();
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'o@o'); git(other, 'config', 'user.name', 'o');
    writeFileSync(join(other, 'data/news-feed.json'), '{"items":[]}\n');
    git(other, 'commit', '-qam', 'origin moved'); git(other, 'push', '-q', 'origin', 'main');

    // The file must be ADDED by this run. If it already exists on origin, the
    // reset restores it with the right mode and a redirect that overwrites the
    // bytes inherits it — the defect stays invisible.
    writeFileSync(join(work, 'data/hook.sh'), '#!/bin/sh\necho hi\n');
    execFileSync('chmod', ['+x', join(work, 'data/hook.sh')]);
    const r = run(work);
    const mode = git(work, 'ls-tree', 'HEAD', 'data/hook.sh').split(/\s+/)[0];
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(-200)}`);
    else if (mode !== '100755') fail(label, `data/hook.sh came back as mode ${mode}, expected 100755 — a redirect writes bytes and loses the entry's mode`);
    else ok(label, 'the executable bit survives the replay');
    rmSync(root, { recursive: true, force: true });
}

console.log('');
if (bad) { console.log(`commit-refresh.test: ${bad}/${ran} FAILURES`); process.exit(1); }
console.log(`commit-refresh.test: ${ran}/${ran} passed`);
