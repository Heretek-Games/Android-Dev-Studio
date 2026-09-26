#!/usr/bin/env node
/**
 * Design-token audit (Track D.1 gate): counts hardcoded Tailwind color
 * utilities per studio component. `studio.*` tokens and UiKit.tsx (the
 * sanctioned palette mapping) are exempt — everything else is migration
 * backlog. New chrome must add zero new hardcoded hits.
 *
 * Usage: node app/scripts/token-audit.mjs [--json]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const EXEMPT = new Set(['UiKit.tsx']);

// Hardcoded Tailwind color families (zinc/blue/emerald/... outside studio.*).
const COLOR_RE = /\b(?:zinc|blue|emerald|amber|rose|red|sky|indigo|teal|violet|orange|yellow|lime|green|cyan|fuchsia|pink|stone|neutral|slate|gray|black|white)-(?:\d{2,3}|white|black)(?:\/\d+)?\b/g;

function* tsxFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* tsxFiles(full);
    else if (full.endsWith('.tsx')) yield full;
  }
}

const rows = [];
for (const file of tsxFiles(SRC)) {
  const name = path.basename(file);
  if (EXEMPT.has(name)) continue;
  const text = readFileSync(file, 'utf8');
  const hits = text.match(COLOR_RE) || [];
  // bg-studio-*/border-studio-*/text-studio tokens are not color hits
  // (the regex above never matches "studio" anyway — belt and braces).
  rows.push({ file: path.relative(SRC, file), hardcoded: hits.length });
}
rows.sort((a, b) => b.hardcoded - a.hardcoded);
const total = rows.reduce((sum, r) => sum + r.hardcoded, 0);
const report = { total, files: rows.length, rows };

const asJson = process.argv.includes('--json');
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`hardcoded color utilities: ${total} across ${rows.length} files (UiKit.tsx exempt)`);
  for (const row of rows.slice(0, 15)) console.log(`  ${row.hardcoded}\t${row.file}`);
}
