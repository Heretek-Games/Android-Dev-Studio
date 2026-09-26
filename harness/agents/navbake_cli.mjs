#!/usr/bin/env node
/**
 * Nav-bake CLI — emits the engine's bakeWalkability blocked grid as JSON so
 * the harness can verify parity with the native C++ strangler module
 * (harness/validation/test_native_nav_parity.py).
 *
 * Usage:
 *   node harness/agents/navbake_cli.mjs --grid <w h ox oz cell agent> \
 *     --footprints '[{"x":..,"z":..,"hx":..,"hz":..}]'
 *
 * Output: {"width","height","blocked":[0/1...]}
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIST = path.resolve(__dirname, '../../engine/dist/index.js');

function parseArgs(argv) {
  const args = { grid: null, footprints: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grid') {
      args.grid = {
        width: parseInt(argv[++i], 10),
        height: parseInt(argv[++i], 10),
        originX: parseFloat(argv[++i]),
        originZ: parseFloat(argv[++i]),
        cell: parseFloat(argv[++i]),
        agent: parseFloat(argv[++i])
      };
    } else if (a === '--footprints') {
      args.footprints = JSON.parse(argv[++i]);
    }
  }
  if (!args.grid) {
    console.error('usage: navbake_cli.mjs --grid <w h ox oz cell agent> --footprints <json>');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv);
const engine = await import(pathToFileURL(ENGINE_DIST).href);
const g = args.grid;

const baked = engine.bakeWalkability(g.width, g.height, args.footprints, {
  cellSize: g.cell, originX: g.originX, originZ: g.originZ, agentRadius: g.agent
});

console.log(JSON.stringify({
  width: g.width,
  height: g.height,
  blocked: Array.from(baked.grid.blocked)
}));
