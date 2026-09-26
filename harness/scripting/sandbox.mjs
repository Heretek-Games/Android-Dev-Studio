#!/usr/bin/env node
/**
 * Bare-import WASM sandbox for agent logic (Track C.5, ADR-1790393900001).
 *
 * Capability security by construction: modules instantiate with ONLY the
 * `heretek` import object (query/emit). No WASI, no fs, no network, no clock
 * is ever granted — there is nothing to escape through. Import allowlisting
 * is validated BEFORE instantiation, so hostile modules fail fast with a
 * named error instead of a trap.
 *
 * Guest API:
 *   heretek.query(id: i32) -> f32   // host-provided world reads
 *   heretek.emit(action: i32, x: f32, z: f32)  // constrained action channel
 *
 * Usage (library): `import { runSandboxed } from './sandbox.mjs'`.
 */

import { readFileSync } from 'node:fs';

export const ALLOWED_MODULES = new Set(['heretek']);

export class SandboxError extends Error {}

/** Statically reject any import outside the allowlist (pre-instantiation). */
export function checkImports(bytes, allowed = ALLOWED_MODULES) {
  const module = new WebAssembly.Module(bytes);
  const offenders = WebAssembly.Module.imports(module)
    .map(imp => imp.module)
    .filter(mod => !allowed.has(mod));
  if (offenders.length) {
    throw new SandboxError(
      `rejected imports from ungranted modules: ${[...new Set(offenders)].join(', ')}`
    );
  }
  return module;
}

/**
 * Run a module's exported `run()` with host query/emit handlers.
 * Returns { returned, emitted: [{action, x, z}], queries }.
 */
export async function runSandboxed(bytes, { queries = {}, onEmit = null } = {}) {
  const module = checkImports(bytes);
  const emitted = [];
  const asked = [];
  const imports = {
    heretek: {
      query: (id) => {
        asked.push(id);
        const value = queries[id];
        return typeof value === 'number' ? value : 0;
      },
      emit: (action, x, z) => {
        emitted.push({ action, x, z });
        if (onEmit) onEmit(action, x, z);
      }
    }
  };
  const instance = await WebAssembly.instantiate(module, imports);
  const run = instance.exports.run;
  if (typeof run !== 'function') {
    throw new SandboxError('module exports no run() function');
  }
  const returned = run();
  return { returned, emitted, queries: asked };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [wasmPath, queryJson] = process.argv.slice(2);
  const queries = queryJson ? JSON.parse(queryJson) : {};
  runSandboxed(readFileSync(wasmPath), { queries })
    .then(result => console.log(JSON.stringify(result, null, 1)))
    .catch(err => {
      console.error(`sandbox: ${err.message}`);
      process.exit(1);
    });
}
