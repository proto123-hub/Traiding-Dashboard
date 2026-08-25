#!/usr/bin/env node
// Copy declared report sections into the Obsidian vault. LOCAL ONLY.
//
// Why this is not in scripts/ with the others: every sibling there is a
// scraper the GitHub Actions cron runs. This one must never run there — the
// runner has no vault, and a "sync" that silently finds nothing to sync is
// worse than one that refuses to start. Hence scripts/local/ and the hard
// exit below.
//
// DIRECTION IS ONE-WAY, repo -> vault, and that is a design rule rather than
// an implementation detail. The vault is canon: it is hand-authored, it is
// where judgments live, and it must never be overwritten by anything a cron
// produced. This script only ever appends, only ever to files the report
// itself names, and never reads vault content back into the repo.
//
// A report opts in by carrying one marker line near the top:
//
//   <!-- VAULT-WRITE target="01_Daily_Market/2026-08-19.md" from="## §7." -->
//
//   target — path inside the vault root, created if absent
//   from   — heading text that begins the block to copy
//   to     — optional heading that ends it; defaults to the next heading at
//            the same level, or end of file
//
// Safety rails, each added because a read-only audit found it missing:
//   - the vault root must carry one of VAULT_FINGERPRINT, so canon is never
//     written into whatever directory happens to sit at the configured path
//   - targets are contained: no absolute paths, no ../ escape
//   - provenance records source path, HEAD commit and a block sha256, so a
//     reader a month later can tell which revision landed and whether the
//     bytes still match — and so a CORRECTED re-issue is distinguishable from
//     the original rather than skipped forever
//   - a target that already carries a section starting with the marker's
//     `from` is BLOCKED, not appended: canon with two §7 headings in different
//     places is a structural error, and resolving it is a human's call
//   - appendFile, not read-then-write, because the vault is open in Obsidian
//     and a full rewrite would discard concurrent edits
//
// NOT AUTOMATED, DELIBERATELY: this writes into a store whose value is that it
// is hand-authored. Run --dry-run first, read what it intends to do, and only
// then run it for real. Nothing here should ever be put on a schedule.
//
// Usage:
//   node scripts/local/sync-vault.mjs --dry-run  # ALWAYS run this first
//   node scripts/local/sync-vault.mjs            # write, after reading the above
//   TRADING_OS_VAULT=/path/to/vault node scripts/local/sync-vault.mjs

import { readFile, writeFile, appendFile, readdir, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DEFAULT_VAULT = 'D:\\Obsidian\\Trading_OS\\Trading_OS';
const VAULT = process.env.TRADING_OS_VAULT || DEFAULT_VAULT;
const DRY_RUN = process.argv.includes('--dry-run');

// Files that identify a real Trading_OS vault. Writing canon into whatever
// happens to sit at the configured path is not acceptable for a store whose
// whole value is that it is hand-authored and trusted.
const VAULT_FINGERPRINT = ['.obsidian', '00_Vault_Index.md', 'Context_Primer.md'];

const MARKER = /<!--\s*VAULT-WRITE\s+([^>]*?)-->/;
const ATTR = /(\w+)="([^"]*)"/g;

function parseMarker(line) {
    const m = MARKER.exec(line);
    if (!m) return null;
    const out = {};
    for (const a of m[1].matchAll(ATTR)) out[a[1]] = a[2];
    return out.target && out.from ? out : null;
}

/** Lines from the `from` heading up to `to` (or the next same-level heading). */
export function extractBlock(text, from, to) {
    const lines = text.split('\n');
    const start = lines.findIndex(l => l.startsWith(from));
    if (start < 0) return null;
    const level = (/^#+/.exec(lines[start]) || [''])[0].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (to ? lines[i].startsWith(to) : (/^#+/.exec(lines[i]) || [''])[0].length === level && level > 0) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

/** Reject any target that escapes the vault root, via ../ or an absolute path. */
export function resolveInVault(vaultRoot, target) {
    if (isAbsolute(target)) return { error: `target "${target}" is absolute` };
    const root = resolve(vaultRoot);
    const full = resolve(root, target);
    const rel = relative(root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
        return { error: `target "${target}" escapes the vault root` };
    }
    return { path: full };
}

/**
 * Provenance a reader can act on a month later: which commit, which block, and
 * whether the bytes still match. A source path alone proves nothing — it does
 * not say which revision, and it makes a corrected re-issue indistinguishable
 * from the original, which the old idempotency key then skipped forever.
 */
function provenanceFor(sourcePath, block, commit) {
    const sha = createHash('sha256').update(block, 'utf8').digest('hex').slice(0, 16);
    return {
        line: `<!-- synced from ${sourcePath} @ ${commit} block-sha256:${sha} -->`,
        sha,
    };
}

function headCommit() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

async function reportsWithMarkers() {
    const out = [];
    for (const dir of (await readdir('reports', { withFileTypes: true }))) {
        if (!dir.isDirectory() || !/^\d{4}-\d{2}$/.test(dir.name)) continue;
        for (const f of await readdir(`reports/${dir.name}`)) {
            if (!f.endsWith('.md')) continue;
            const path = `reports/${dir.name}/${f}`;
            const text = await readFile(path, 'utf8');
            // Only scan the head — a marker quoted deep in prose is not a directive.
            for (const line of text.split('\n', 40)) {
                const spec = parseMarker(line);
                if (spec) { out.push({ path, text, spec }); break; }
            }
        }
    }
    return out;
}

async function main() {
    try {
        await access(VAULT);
    } catch {
        console.error(
            `vault not reachable: ${VAULT}\n` +
            `\n` +
            `This script is local-only by design — it writes into the Obsidian vault,\n` +
            `which exists on Daniel's machine and nowhere else. If you are seeing this\n` +
            `in CI or a remote container, that is the guard working, not a failure.\n` +
            `\n` +
            `Set TRADING_OS_VAULT if the vault lives somewhere other than the default.`
        );
        process.exit(1);
    }

    // Is this actually the Trading_OS vault, or just a directory at that path?
    const fingerprint = [];
    for (const f of VAULT_FINGERPRINT) {
        try { await access(join(VAULT, f)); fingerprint.push(f); } catch { /* absent */ }
    }
    if (!fingerprint.length) {
        console.error(
            `${VAULT} exists but does not look like the Trading_OS vault.\n` +
            `Expected at least one of: ${VAULT_FINGERPRINT.join(', ')}\n` +
            `Refusing to write canon into an unidentified directory.`
        );
        process.exit(1);
    }

    const found = await reportsWithMarkers();
    if (!found.length) {
        console.log('no reports carry a VAULT-WRITE marker — nothing to sync');
        return;
    }

    const commit = headCommit();
    let written = 0, skipped = 0, failed = 0, blocked = 0;
    for (const { path, text, spec } of found) {
        const block = extractBlock(text, spec.from, spec.to);
        if (block == null) {
            console.log(`  FAIL ${path}: no heading starting "${spec.from}"`);
            failed++;
            continue;
        }

        const resolved = resolveInVault(VAULT, spec.target);
        if (resolved.error) {
            console.log(`  FAIL ${path}: ${resolved.error}`);
            failed++;
            continue;
        }
        const target = resolved.path;
        const { line: provenance, sha } = provenanceFor(path, block, commit);

        let existing = '';
        try { existing = await readFile(target, 'utf8'); } catch { /* new file */ }

        // Same block, already written — nothing to do.
        if (existing.includes(`block-sha256:${sha}`)) {
            console.log(`  skip ${spec.target} — already carries this exact block`);
            skipped++;
            continue;
        }

        // The heading already exists but the bytes differ: either a corrected
        // re-issue or a hand edit in the vault. Appending would give the file
        // two of the same heading in different places, which is a structural
        // error in canon, not a merge. Keyed on source path alone this used to
        // be skipped forever; now it is surfaced and left for a human.
        // Match on the section IDENTITY the marker declares (`from`, e.g.
        // "## §7."), not the full heading text. The real 2026-08-19 vault file
        // already carries a §7 whose wording differs, and a full-text compare
        // waved that straight through — which would have produced a second §7
        // several hundred lines below the first.
        const collides = existing.split('\n').some(l => l.startsWith(spec.from));
        if (collides) {
            console.log(
                `  BLOCKED ${spec.target} — a section starting "${spec.from}" is already present with different\n` +
                `           content. Appending would duplicate the heading. Resolve in the vault:\n` +
                `           replace the existing section, or give this block a distinct heading.`
            );
            blocked++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  would append ${block.split('\n').length} lines to ${spec.target}  (from ${path} @ ${commit})`);
        } else {
            await mkdir(dirname(target), { recursive: true });
            // appendFile, not read-then-write: the vault is open in Obsidian and
            // a full rewrite would silently discard anything edited between the
            // read and the write.
            await appendFile(target, `${existing ? '\n\n' : ''}${provenance}\n${block}\n`, 'utf8');
            console.log(`  wrote ${block.split('\n').length} lines to ${spec.target}  (from ${path} @ ${commit})`);
        }
        written++;
    }

    console.log(
        `\nsync-vault: ${written} written, ${skipped} already present, ${blocked} blocked, ` +
        `${failed} failed${DRY_RUN ? '  (dry run — nothing changed)' : ''}`
    );
    if (failed || blocked) process.exit(1);
}

// Direct-invocation guard, same reason as validate-data.mjs: importing this to
// test extractBlock must not touch the vault.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
