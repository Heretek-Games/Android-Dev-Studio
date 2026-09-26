#!/usr/bin/env node
/**
 * SpatialGrid baseline benchmark (Track C.0, ADR-1790393400001).
 *
 * Zero-dependency measurement over engine/dist: insert / update / queryRadius /
 * queryAABB / nearest at 10k and 50k entries, warmup + median-of-5 + heap
 * deltas. Numbers are machine-local (platform recorded in output) — never
 * compare across machines. No assertions: benchmarks are evidence, not gates.
 *
 * Usage:
 *   npm --workspace=engine run build && node engine/bench/spatial_grid.bench.mjs \
 *     [--out harness/runs/bench_spatial_grid.json]
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIST = path.resolve(__dirname, '../dist/index.js');
const REPO_ROOT = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0
  ? path.resolve(REPO_ROOT, args[outIdx + 1])
  : path.resolve(REPO_ROOT, 'harness/runs/bench_spatial_grid.json');

const RUNS = 5;
const SIZES = [10000, 50000];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function buildPositions(count, seed, spread) {
  const rand = rng(seed);
  const pts = new Array(count);
  for (let i = 0; i < count; i++) {
    pts[i] = [(rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread];
  }
  return pts;
}

async function main() {
  const engine = await import(pathToFileURL(ENGINE_DIST).href);
  const results = {
    tool: 'engine/bench/spatial_grid.bench.mjs',
    platform: { platform: process.platform, arch: process.arch, node: process.version },
    runs: RUNS,
    cases: []
  };

  for (const count of SIZES) {
    const insertPts = buildPositions(count, 1234, 2000);
    const movePts = buildPositions(count, 5678, 2000);
    const row = { entries: count, ops: {} };

    // Insert (fresh grid per run).
    const insertTimes = [];
    let grid = null;
    for (let r = 0; r < RUNS + 1; r++) {
      const g = new engine.SpatialGrid(10);
      const t0 = performance.now();
      for (let i = 0; i < count; i++) g.insert(`e${i}`, ...insertPts[i]);
      const dt = performance.now() - t0;
      if (r > 0) insertTimes.push(dt);
      if (r === RUNS) grid = g;
    }
    row.ops.insert = { medianMs: +median(insertTimes).toFixed(2), perEntryNs: Math.round(median(insertTimes) * 1e6 / count) };

    // Update (all entries move once).
    const updateTimes = [];
    for (let r = 0; r < RUNS + 1; r++) {
      const t0 = performance.now();
      for (let i = 0; i < count; i++) grid.update(`e${i}`, ...movePts[i]);
      const dt = performance.now() - t0;
      if (r > 0) updateTimes.push(dt);
    }
    row.ops.update = { medianMs: +median(updateTimes).toFixed(2), perEntryNs: Math.round(median(updateTimes) * 1e6 / count) };

    // Queries (deterministic sweep over the populated grid).
    const querySpecs = [
      ['queryRadius', g => g.queryRadius(0, 0, 0, 30)],
      ['queryAABB', g => g.queryAABB(-50, -50, -50, 50, 50, 50)],
      ['nearest', g => g.nearest(0, 0, 0, 100)]
    ];
    const heapBefore = process.memoryUsage().heapUsed;
    for (const [name, fn] of querySpecs) {
      fn(grid); // warmup
      const times = [];
      let found = 0;
      for (let r = 0; r < RUNS; r++) {
        const t0 = performance.now();
        const out = fn(grid);
        times.push(performance.now() - t0);
        found = Array.isArray(out) ? out.length : (out ? 1 : 0);
      }
      row.ops[name] = { medianMs: +median(times).toFixed(3), lastResultSize: found };
    }
    row.heapDeltaMb = +((process.memoryUsage().heapUsed - heapBefore) / 1048576).toFixed(2);
    row.gridStats = grid.stats();
    results.cases.push(row);
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');
  console.log(JSON.stringify(results, null, 1));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
