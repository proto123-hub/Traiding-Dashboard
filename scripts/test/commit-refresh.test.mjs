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
import { execFileSync } from 'node:child_process';

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
    const r = run(work);
    const leaked = r.files.filter(f => !/^(data|reports\/raw|reports\/validation)\//.test(f));
    if (r.status !== 0) fail(label, `exited ${r.status}: ${r.out.trim().slice(0, 200)}`);
    else if (r.commits !== 1) fail(label, `made ${r.commits} commit(s), expected 1`);
    else if (leaked.length) fail(label, `committed out-of-scope ${JSON.stringify(leaked)} — only data/, reports/raw/ and reports/validation/ may be staged`);
    else ok(label, 'CLAUDE.md and index.html stay out of the commit');
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

console.log('');
if (bad) { console.log(`commit-refresh.test: ${bad}/${ran} FAILURES`); process.exit(1); }
console.log(`commit-refresh.test: ${ran}/${ran} passed`);
