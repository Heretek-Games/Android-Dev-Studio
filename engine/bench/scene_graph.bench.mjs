#!/usr/bin/env node
/**
 * Scene-graph + EventSheet baseline benchmark (Track C.0, ADR-1790393400001).
 *
 * Zero-dependency measurement over engine/dist: Scene.update(1/60) over
 * transform-only scenes (1k/10k GameObjects) and scenes carrying EventSheets
 * (200 sheets x 20 EveryFrame Translate events). Warmup + median-of-5.
 * Machine-local numbers; evidence, not gates.
 *
 * Usage:
 *   npm --workspace=engine run build && node engine/bench/scene_graph.bench.mjs \
 *     [--out harness/runs/bench_scene_graph.json]
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
  : path.resolve(__dirname, '../../harness/runs/bench_scene_graph.json');

const RUNS = 5;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measure(fn, runs = RUNS) {
  fn(); // warmup
  const times = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return +median(times).toFixed(3);
}

async function main() {
  const engine = await import(pathToFileURL(ENGINE_DIST).href);
  const results = {
    tool: 'engine/bench/scene_graph.bench.mjs',
    platform: { platform: process.platform, arch: process.arch, node: process.version },
    runs: RUNS,
    cases: []
  };

  for (const count of [1000, 10000]) {
    const scene = new engine.Scene('BenchScene');
    for (let i = 0; i < count; i++) {
      const go = new engine.GameObject(`Bench${i}`);
      go.transform.setPosition(i % 100, 0, Math.floor(i / 100));
      scene.addGameObject(go);
    }
    const ms = measure(() => scene.update(1 / 60));
    results.cases.push({
      case: 'scene.update transform-only',
      objects: count,
      medianMs: ms,
      perObjectNs: Math.round(ms * 1e6 / count)
    });
  }

  {
    const scene = new engine.Scene('BenchEvents');
    for (let s = 0; s < 200; s++) {
      const go = new engine.GameObject(`Sheet${s}`);
      const sheet = new engine.EventSheet();
      sheet.events = Array.from({ length: 20 }, (_, e) => ({
        id: `e${e}`, name: `Event ${e}`, enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'Translate', params: { x: 0.01, y: 0, z: 0 } }]
      }));
      go.addComponent(sheet);
      scene.addGameObject(go);
    }
    const ms = measure(() => scene.update(1 / 60));
    results.cases.push({
      case: 'scene.update 200 sheets x 20 EveryFrame events',
      objects: 200,
      events: 4000,
      medianMs: ms,
      perEventNs: Math.round(ms * 1e6 / 4000)
    });
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');
  console.log(JSON.stringify(results, null, 1));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
