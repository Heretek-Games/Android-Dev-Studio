#!/usr/bin/env node
/**
 * Spatial parity CLI — emits the engine's bakeWalkability blocked grid and
 * hasLineOfSight verdicts as JSON so the harness can verify parity with the
 * Python SpatialIndex (cross-tier consistency: web engine ↔ loop audits).
 *
 * Usage:
 *   node harness/agents/spatial_cli.mjs --grid <w> <h> <ox> <oz> <cell> <agent> \
 *     --footprints '[{"x":..,"z":..,"hx":..,"hz":..}]' [--los ax az bx bz]...
 *
 * Output: {"width","height","blocked":[0/1...],"los":[bool...]}
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIST = path.resolve(__dirname, '../../engine/dist/index.js');

function parseArgs(argv) {
  const args = { grid: null, footprints: [], los: [] };
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
    } else if (a === '--los') {
      args.los.push([
        parseInt(argv[++i], 10), parseInt(argv[++i], 10),
        parseInt(argv[++i], 10), parseInt(argv[++i], 10)
      ]);
    }
  }
  if (!args.grid) {
    console.error('usage: spatial_cli.mjs --grid <w h ox oz cell agent> --footprints <json> [--los ...]');
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

const los = args.los.map(([ax, az, bx, bz]) =>
  engine.hasLineOfSight(baked.grid, { x: ax, y: az }, { x: bx, y: bz })
);

console.log(JSON.stringify({
  width: g.width,
  height: g.height,
  blocked: Array.from(baked.grid.blocked),
  los
}));
