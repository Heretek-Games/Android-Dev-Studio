#!/usr/bin/env node
/**
 * Headless QA Scenario Runner (Node)
 *
 * Boots a game scenario on the real @heretek/engine runtime without a GPU:
 *   - builds Scene + GameObjects + components from a scenario spec
 *   - initializes Rapier3D WASM physics and attaches rigid/collider bodies
 *   - steps the EngineContext for N frames, measuring real wall-clock frame cost
 *   - estimates GPU draw calls (Mobile Budget enforcement: <= 100 per scene)
 *   - records memory heap usage
 *   - evaluates game-rule assertions and reports pass/fail per rule
 *
 * Output: one JSON report on stdout (and optionally --out <file>).
 *
 * Usage:
 *   node harness/agents/qa_scenario_runner.mjs --scenario harness/config/scenarios/mini_arena.json \
 *       [--frames 600] [--dt 0.016667] [--out harness/artemis_report.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIST = path.resolve(__dirname, '../../engine/dist/index.js');

function parseArgs(argv) {
  const args = { frames: 600, dt: 1 / 60, scenario: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--frames') args.frames = parseInt(argv[++i], 10);
    else if (a === '--dt') args.dt = parseFloat(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Deterministic draw-call estimator for the engine's rendering path. */
function estimateDrawCalls(scene, engine) {
  let draws = 0;
  let instancedBatches = 0;
  for (const go of scene.gameObjects) {
    for (const comp of go.components) {
      const name = comp.constructor.name;
      if (name === 'MeshRenderer' || name === 'ModelRenderer') draws += 1;
      else if (name === 'InstancedMeshBatcher' || name === 'FoliageInstancer') instancedBatches += 1;
    }
  }
  // Each instanced batch collapses N instances into a single draw call.
  draws += instancedBatches;
  return { drawCalls: draws, instancedBatches };
}

function buildScene(spec, engine) {
  const scene = new engine.Scene(spec.name || 'QAScene');
  for (const objSpec of spec.gameObjects || []) {
    const go = new engine.GameObject(objSpec.name || 'Object');
    const pos = objSpec.position || [0, 0, 0];
    go.transform.setPosition(pos[0], pos[1], pos[2]);
    if (objSpec.rotation) {
      go.transform.setRotation(objSpec.rotation[0], objSpec.rotation[1], objSpec.rotation[2]);
    }

    if (objSpec.kind === 'light') {
      go.addComponent(new engine.LightComponent({
        type: objSpec.lightType || 'directional',
        color: objSpec.color || '#ffffff',
        intensity: objSpec.intensity ?? 2.0
      }));
      if (pos) go.transform.setPosition(pos[0], pos[1], pos[2]);
    } else if (objSpec.kind === 'camera') {
      go.addComponent(new engine.CameraComponent(objSpec.cameraOptions || {}));
    } else {
      const size = objSpec.size || [1, 1, 1];
      go.addComponent(new engine.MeshRenderer({
        shape: objSpec.shape || 'box',
        size,
        color: objSpec.color || '#3b82f6',
        roughness: objSpec.roughness ?? 0.4
      }));
      if (objSpec.physics && objSpec.physics !== 'none') {
        go.addComponent(new engine.RigidBody3D({
          bodyType: objSpec.physics,
          mass: objSpec.mass ?? 1.0
        }));
        go.addComponent(new engine.Collider3D({
          shape: objSpec.shape || 'box',
          size
        }));
      }
      if (objSpec.controller) {
        go.addComponent(new engine.MobileController(objSpec.controllerOptions || {}));
      }
      if (objSpec.vehicle) {
        const vehicle = new engine.VehicleController(objSpec.vehicle);
        if (objSpec.vehicle.throttle !== undefined) vehicle.throttle = objSpec.vehicle.throttle;
        if (objSpec.vehicle.steering !== undefined) vehicle.steering = objSpec.vehicle.steering;
        if (objSpec.vehicle.brake !== undefined) vehicle.brake = objSpec.vehicle.brake;
        go.addComponent(vehicle);
      }
      if (objSpec.events && objSpec.events.length) {
        go.addComponent(new engine.EventSheet(objSpec.events.map((ev, i) => ({
          id: ev.id || `qa_ev_${i}`,
          name: ev.name || `QA Event ${i}`,
          enabled: ev.enabled !== false,
          conditions: ev.conditions || [{ type: 'EveryFrame' }],
          actions: ev.actions || []
        }))));
      }
    }
    scene.addGameObject(go);
  }
  return scene;
}

function transformField(go, field) {
  const t = go.transform;
  switch (field) {
    case 'positionX': return t.position.x;
    case 'positionY': return t.position.y;
    case 'positionZ': return t.position.z;
    case 'rotationX': return t.rotation.x;
    case 'rotationY': return t.rotation.y;
    case 'rotationZ': return t.rotation.z;
    case 'scaleX': return t.scale.x;
    case 'scaleY': return t.scale.y;
    case 'scaleZ': return t.scale.z;
    default: return null;
  }
}

function evaluateRules(spec, ctxData) {
  const { scene, samples, firstSamples, metrics, dt } = ctxData;
  const results = [];

  for (const rule of spec.rules || []) {
    let pass = false;
    let detail = '';

    switch (rule.type) {
      case 'entity_exists': {
        const go = scene.findByName(rule.target);
        pass = !!go;
        detail = pass ? `found "${rule.target}"` : `missing "${rule.target}"`;
        break;
      }
      case 'entity_component': {
        const go = scene.findByName(rule.target);
        if (!go) { pass = false; detail = `missing "${rule.target}"`; break; }
        const has = go.components.some(c => c.constructor.name === rule.component);
        pass = has;
        detail = `${rule.target} components: [${go.components.map(c => c.constructor.name).join(', ')}]`;
        break;
      }
      case 'event_attached': {
        const go = scene.findByName(rule.target);
        const es = go ? go.components.find(c => c.constructor.name === 'EventSheet') : null;
        if (!es || !es.events.length) { pass = false; detail = `no EventSheet events on "${rule.target}"`; break; }
        if (rule.action) {
          pass = es.events.some(ev => ev.actions.some(a => a.type === rule.action));
          detail = `actions: [${es.events.flatMap(ev => ev.actions.map(a => a.type)).join(', ')}]`;
        } else {
          pass = true;
          detail = `${es.events.length} event(s) attached`;
        }
        break;
      }
      case 'object_count': {
        const n = scene.gameObjects.length;
        pass = (rule.min === undefined || n >= rule.min) && (rule.max === undefined || n <= rule.max);
        detail = `objectCount=${n} (min=${rule.min ?? '-'} max=${rule.max ?? '-'})`;
        break;
      }
      case 'transform_changes': {
        const go = scene.findByName(rule.target);
        if (!go) { pass = false; detail = `missing "${rule.target}"`; break; }
        const a = firstSamples[rule.target]?.[rule.field];
        const b = transformField(go, rule.field);
        const delta = Math.abs((b ?? 0) - (a ?? 0));
        pass = delta >= (rule.minDelta ?? 1e-3);
        detail = `${rule.target}.${rule.field} delta=${delta.toFixed(5)} (minDelta=${rule.minDelta ?? 1e-3})`;
        break;
      }
      case 'distance_traveled': {
        const go = scene.findByName(rule.target);
        if (!go) { pass = false; detail = `missing "${rule.target}"`; break; }
        const first = firstSamples[rule.target];
        const dx = go.transform.position.x - (first?.positionX ?? 0);
        const dz = go.transform.position.z - (first?.positionZ ?? 0);
        const distance = Math.hypot(dx, dz);
        pass = distance >= (rule.min ?? 1);
        detail = `${rule.target} traveled ${distance.toFixed(2)}m (min=${rule.min ?? 1})`;
        break;
      }
      case 'speed_min': {
        // Average speed along the sampled path: Σ segment distances / elapsed sampled time
        let pathLength = 0;
        let prev = null;
        let firstFrame = null;
        let lastFrame = null;
        for (const s of samples) {
          const f = s.fields[rule.target];
          if (!f) continue;
          if (firstFrame === null) firstFrame = s.frame;
          lastFrame = s.frame;
          if (prev) {
            pathLength += Math.hypot(f.positionX - prev.positionX, f.positionZ - prev.positionZ);
          }
          prev = f;
        }
        const elapsed = ((lastFrame ?? 0) - (firstFrame ?? 0)) * (rule.dt ?? dt ?? 1 / 60);
        const avgSpeed = elapsed > 0 ? pathLength / elapsed : 0;
        pass = avgSpeed >= (rule.min ?? 1);
        detail = `${rule.target} avg speed ${avgSpeed.toFixed(2)} m/s (min=${rule.min ?? 1})`;
        break;
      }
      case 'transform_bounds': {
        let violation = null;
        for (const s of samples) {
          const v = s.fields[rule.target]?.[rule.axis === 'x' ? 'positionX' : rule.axis === 'z' ? 'positionZ' : 'positionY'];
          if (v === undefined) continue;
          if (rule.min !== undefined && v < rule.min) { violation = `${s.frame}: ${v.toFixed(3)} < ${rule.min}`; break; }
          if (rule.max !== undefined && v > rule.max) { violation = `${s.frame}: ${v.toFixed(3)} > ${rule.max}`; break; }
        }
        pass = violation === null;
        detail = pass ? `"${rule.target}" stayed within bounds over ${samples.length} samples` : violation;
        break;
      }
      case 'no_nan_transforms': {
        const bad = [];
        for (const go of scene.gameObjects) {
          const t = go.transform;
          const vals = [t.position.x, t.position.y, t.position.z, t.rotation.x, t.rotation.y, t.rotation.z, t.scale.x, t.scale.y, t.scale.z];
          if (vals.some(v => !Number.isFinite(v))) bad.push(go.name);
        }
        pass = bad.length === 0;
        detail = pass ? `all ${scene.gameObjects.length} transforms finite` : `non-finite transforms: ${bad.join(', ')}`;
        break;
      }
      case 'draw_call_budget': {
        pass = metrics.drawCallEstimate <= rule.max;
        detail = `drawCallEstimate=${metrics.drawCallEstimate} (budget ${rule.max})`;
        break;
      }
      case 'fps_min': {
        pass = metrics.simFpsEstimate >= rule.min;
        detail = `simFpsEstimate=${metrics.simFpsEstimate.toFixed(1)} (min ${rule.min})`;
        break;
      }
      default: {
        pass = false;
        detail = `unknown rule type "${rule.type}"`;
      }
    }
    results.push({ id: rule.id || rule.type, type: rule.type, pass, detail });
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.scenario) {
    console.error('usage: qa_scenario_runner.mjs --scenario <file.json> [--frames N] [--dt S] [--out file]');
    process.exit(2);
  }

  const spec = JSON.parse(readFileSync(args.scenario, 'utf-8'));
  const engine = await import(pathToFileURL(ENGINE_DIST).href);

  // --- Boot scene + physics (mirrors StudioState.startPlayMode) ---
  const scene = buildScene(spec, engine);
  const physicsWorld = new engine.PhysicsWorld();
  await physicsWorld.initialize();
  scene.physicsWorld = physicsWorld;

  let physicsBodyCount = 0;
  for (const go of scene.gameObjects) {
    for (const comp of go.components) {
      const n = comp.constructor.name;
      if (n === 'RigidBody3D') { comp.initPhysics(physicsWorld); physicsBodyCount++; }
      else if (n === 'Collider3D') comp.initPhysics(physicsWorld);
    }
  }

  const ctx = new engine.EngineContext();
  ctx.setScene(scene);

  const eventCount = scene.gameObjects.reduce(
    (n, go) => n + go.components.filter(c => c.constructor.name === 'EventSheet').reduce((m, es) => m + es.events.length, 0), 0
  );

  // --- Sample transforms before the run (for transform_changes rules) ---
  const fields = ['positionX', 'positionY', 'positionZ', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'];
  const firstSamples = {};
  for (const go of scene.gameObjects) {
    const f = {};
    for (const fld of fields) f[fld] = transformField(go, fld);
    firstSamples[go.name] = f;
  }

  // --- Frame loop with wall-clock measurement ---
  const sampleEvery = Math.max(1, Math.floor(args.frames / 12));
  const samples = [];
  const times = [];
  for (let frame = 0; frame < args.frames; frame++) {
    const t0 = performance.now();
    ctx.step(args.dt);
    times.push(performance.now() - t0);
    if (frame % sampleEvery === 0 || frame === args.frames - 1) {
      const fieldsNow = {};
      for (const go of scene.gameObjects) {
        const f = {};
        for (const fld of fields) f[fld] = transformField(go, fld);
        fieldsNow[go.name] = f;
      }
      samples.push({ frame, fields: fieldsNow });
    }
  }

  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const { drawCalls, instancedBatches } = estimateDrawCalls(scene, engine);
  const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);

  const metrics = {
    avgFrameTimeMs: Number(avg.toFixed(4)),
    p95FrameTimeMs: Number(pct(sorted, 95).toFixed(4)),
    maxFrameTimeMs: Number((sorted[sorted.length - 1] || 0).toFixed(4)),
    simFpsEstimate: Number((1000 / Math.max(avg, 1e-6)).toFixed(2)),
    drawCallEstimate: drawCalls,
    instancedBatches,
    memoryHeapMb: Number(heapMb.toFixed(2)),
    objectCount: scene.gameObjects.length,
    physicsBodyCount,
    eventCount
  };

  const ruleResults = evaluateRules(spec, { scene, samples, firstSamples, metrics, dt: args.dt });
  const passed = ruleResults.filter(r => r.pass).length;
  const total = ruleResults.length;
  const allPass = total > 0 && passed === total;

  const report = {
    schemaVersion: 1,
    runner: 'qa_scenario_runner.mjs',
    scenario: path.basename(args.scenario),
    goal: spec.goal || `QA scenario ${path.basename(args.scenario)}`,
    timestamp: Date.now() / 1000,
    frames: args.frames,
    fixedDeltaSeconds: args.dt,
    metrics,
    rules: ruleResults,
    passed,
    total,
    verdict: allPass ? 'SUCCEEDED' : 'FAILED',
    confidence: total > 0 ? Number((passed / total).toFixed(3)) : 0.0
  };

  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    writeFileSync(args.out, json);
  }
  console.log(json);
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error(JSON.stringify({ error: String(err?.stack || err) }));
  process.exit(3);
});
