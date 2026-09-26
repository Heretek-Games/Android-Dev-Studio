#!/usr/bin/env node
/**
 * dumpAdapterGraph — build a spec through the REAL studio adapter
 * (HarnessSceneAdapter.buildEngineScene) and print the canonical static
 * scene graph as JSON (same form as dumpRunnerGraph.mjs).
 *
 * Run with Node type-stripping (Node >= 22.18) from the app workspace so
 * the `@heretek/engine` import resolves via app/node_modules:
 *   node app/src/services/dumpAdapterGraph.ts --scenario <spec.json>
 */

import { readFileSync } from 'node:fs';
import { buildEngineScene } from './HarnessSceneAdapter.ts';
import { canonicalSceneGraph } from './sceneGraphCanonical.ts';
import type { HarnessScene } from './SceneStore.ts';

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const scenarioPath = argValue('--scenario');
if (!scenarioPath) throw new Error('usage: dumpAdapterGraph.ts --scenario <spec.json>');

const spec = JSON.parse(readFileSync(scenarioPath, 'utf8')) as HarnessScene;
const scene = buildEngineScene(spec);
console.log(JSON.stringify(canonicalSceneGraph(scene)));
