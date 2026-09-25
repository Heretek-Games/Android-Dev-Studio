#!/usr/bin/env node
/**
 * Quadtree CLI — emits the engine's QuadtreeTerrain leaves as JSON so the
 * harness can verify parity with the Python scene exporter's quadtree_leaves()
 * (cross-tier consistency: web engine ↔ native export).
 *
 * Usage:
 *   node harness/agents/quadtree_cli.mjs --focus 0 0 --depth 3 [--bounds -512 -512 512 512]
 *
 * Output: {"leaves":[{"id","depth","minX","minZ","maxX","maxZ","lod","blend"}...]}
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIST = path.resolve(__dirname, '../../engine/dist/index.js');

function parseArgs(argv) {
  const args = { focus: [0, 0], depth: 3, bounds: [-512, -512, 512, 512] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--focus') args.focus = [parseFloat(argv[++i]), parseFloat(argv[++i])];
    else if (a === '--depth') args.depth = parseInt(argv[++i], 10);
    else if (a === '--bounds') args.bounds = [parseFloat(argv[++i]), parseFloat(argv[++i]), parseFloat(argv[++i]), parseFloat(argv[++i])];
  }
  return args;
}

const args = parseArgs(process.argv);
const engine = await import(pathToFileURL(ENGINE_DIST).href);

const terrain = new engine.QuadtreeTerrain({
  minX: args.bounds[0],
  minZ: args.bounds[1],
  maxX: args.bounds[2],
  maxZ: args.bounds[3],
  maxDepth: args.depth,
  frameBudget: 100000
});
terrain.setLoader(() => {}); // sync loader: leaves become ready immediately
terrain.setFocus(args.focus[0], args.focus[1]);
terrain.update();

const leaves = terrain
  .getVisibleNodes()
  .map(node => ({
    id: node.id,
    depth: node.depth,
    minX: node.minX,
    minZ: node.minZ,
    maxX: node.maxX,
    maxZ: node.maxZ,
    lod: node.lod,
    blend: Number(node.blend.toFixed(4))
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(JSON.stringify({ leaves, stats: terrain.getStats() }, null, 2));
