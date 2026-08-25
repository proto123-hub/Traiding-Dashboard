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
// Idempotent: each appended block carries a provenance comment naming its
// source file, and a target already containing that comment is skipped. Edit
// the block in the vault freely afterwards — this will not touch it again.
//
// Usage:
//   node scripts/local/sync-vault.mjs            # write
//   node scripts/local/sync-vault.mjs --dry-run  # show what would be written
//   TRADING_OS_VAULT=/path/to/vault node scripts/local/sync-vault.mjs

import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_VAULT = 'D:\\Obsidian\\Trading_OS\\Trading_OS';
const VAULT = process.env.TRADING_OS_VAULT || DEFAULT_VAULT;
const DRY_RUN = process.argv.includes('--dry-run');

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

    const found = await reportsWithMarkers();
    if (!found.length) {
        console.log('no reports carry a VAULT-WRITE marker — nothing to sync');
        return;
    }

    let written = 0, skipped = 0, failed = 0;
    for (const { path, text, spec } of found) {
        const block = extractBlock(text, spec.from, spec.to);
        if (block == null) {
            console.log(`  FAIL ${path}: no heading starting "${spec.from}"`);
            failed++;
            continue;
        }

        const target = join(VAULT, spec.target);
        const provenance = `<!-- synced from ${path} -->`;

        let existing = '';
        try { existing = await readFile(target, 'utf8'); } catch { /* new file */ }
        if (existing.includes(provenance)) {
            console.log(`  skip ${spec.target} — already carries ${path}`);
            skipped++;
            continue;
        }

        const payload = `${existing ? '\n\n' : ''}${provenance}\n${block}\n`;
        if (DRY_RUN) {
            console.log(`  would append ${block.split('\n').length} lines to ${spec.target}  (from ${path})`);
        } else {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, existing + payload, 'utf8');
            console.log(`  wrote ${block.split('\n').length} lines to ${spec.target}  (from ${path})`);
        }
        written++;
    }

    console.log(`\nsync-vault: ${written} written, ${skipped} already present, ${failed} failed${DRY_RUN ? ' (dry run — nothing changed)' : ''}`);
    if (failed) process.exit(1);
}

// Direct-invocation guard, same reason as validate-data.mjs: importing this to
// test extractBlock must not touch the vault.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
