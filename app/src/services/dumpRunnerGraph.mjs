#!/usr/bin/env node
/**
 * dumpRunnerGraph.mjs — build a spec through the REAL headless QA runner
 * (harness/agents/qa_scenario_runner.mjs :: buildScene) and print the
 * canonical static scene graph as JSON.
 *
 * The runner executes main() on import, so it cannot be imported directly.
 * Instead this script loads the runner source as text, applies two minimal
 * surgeries — stubbing __dirname (meaningless under a data: URL import;
 * buildScene never uses it) and replacing the top-level main() invocation
 * with an export of buildScene — then imports the result via a data: URL.
 * Both surgeries assert they applied, so future runner restructuring fails
 * loudly here instead of silently testing a stale copy.
 *
 * Usage:
 *   node dumpRunnerGraph.mjs --scenario <spec.json>
 *     [--runner <qa_scenario_runner.mjs>] [--engine <engine/dist/index.js>]
 *
 * Output: canonical JSON graph on stdout (see sceneGraphCanonical.ts).
 *
 * DE-DUPLICATION: this script imports the SINGLE shared canonicalizer
 * (sceneGraphCanonical.ts — the same module dumpAdapterGraph.ts uses), so the
 * canonical form cannot drift between dumpers. If the canonical form must
 * change, change it there; both dumpers pick it up together.
 */

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalSceneGraph } from './sceneGraphCanonical.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const scenarioPath =
  argValue(process.argv, '--scenario') ??
  (() => {
    throw new Error('usage: dumpRunnerGraph.mjs --scenario <spec.json>');
  })();
const runnerPath =
  argValue(process.argv, '--runner') ??
  path.join(REPO_ROOT, 'harness/agents/qa_scenario_runner.mjs');
const enginePath =
  argValue(process.argv, '--engine') ??
  path.join(REPO_ROOT, 'engine/dist/index.js');

let src = readFileSync(runnerPath, 'utf8');

const DIRNAME_PATTERN = /const __dirname = .*?;/s;
if (!DIRNAME_PATTERN.test(src)) {
  throw new Error(
    `dumpRunnerGraph: __dirname stub pattern not found in ${runnerPath} — runner structure changed, update this script`
  );
}
src = src.replace(
  DIRNAME_PATTERN,
  'const __dirname = "/tmp/heretek-parity-stub";'
);

const MAIN_PATTERN = /main\(\)\.catch[\s\S]*$/;
if (!MAIN_PATTERN.test(src)) {
  throw new Error(
    `dumpRunnerGraph: main() invocation not found in ${runnerPath} — runner structure changed, update this script`
  );
}
src = src.replace(MAIN_PATTERN, 'export { buildScene };');

const runnerModule = await import(
  'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
);
const engine = await import(pathToFileURL(realpathSync(enginePath)).href);
const spec = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const scene = runnerModule.buildScene(spec, engine);

// Shared canonicalizer (see sceneGraphCanonical.ts) — identical to the
// adapter dumper's form, including normalized params.
const graph = canonicalSceneGraph(scene);

console.log(JSON.stringify(graph));
