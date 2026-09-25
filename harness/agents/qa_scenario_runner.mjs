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
  const args = { frames: 600, dt: 1 / 60, scenario: null, out: null, traverse: false, traverseGrid: 9, traverseMinCoverage: 0.8 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--frames') args.frames = parseInt(argv[++i], 10);
    else if (a === '--dt') args.dt = parseFloat(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--traverse') args.traverse = true;
    else if (a === '--traverse-grid') args.traverseGrid = Math.max(2, parseInt(argv[++i], 10) || 9);
    else if (a === '--traverse-min-coverage') args.traverseMinCoverage = parseFloat(argv[++i]);
  }
  if (!(args.traverseMinCoverage >= 0 && args.traverseMinCoverage <= 1)) args.traverseMinCoverage = 0.8;
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

/**
 * Streaming audit (Phase 2 world-generation ladder): drives a WorldStreamer
 * focus along a transect and verifies seamless chunk streaming — every chunk
 * within render distance present after settling (no gaps), no chunk loaded,
 * unloaded, then loaded again (no thrash), and bounded active-chunk counts.
 * Uses the real WorldStreamer + TerrainChunk code paths stepped through the
 * real EngineContext; only the focus teleport is simulated.
 */
function findStreamer(scene) {
  for (const go of scene.gameObjects) {
    for (const comp of go.components || []) {
      if (comp.constructor.name === 'WorldStreamer') {
        return { streamer: comp, host: go };
      }
    }
  }
  return null;
}

function expectedChunkKeys(cx, cz, renderDistance) {
  const keys = [];
  for (let dx = -renderDistance; dx <= renderDistance; dx++) {
    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      keys.push(`${cx + dx},${cz + dz}`);
    }
  }
  return keys.sort();
}

function runStreamingAudit(scene, ctx, opts = {}) {
  const found = findStreamer(scene);
  if (!found) return null;
  const { streamer } = found;
  const target = streamer.target;
  if (!target || !target.transform) return null;

  const chunkSize = streamer.chunkSize || 48;
  const renderDistance = streamer.renderDistance ?? 1;
  const dt = opts.dt || 1 / 60;
  const samples = Math.max(2, opts.samples || 5);
  const settleFrames = opts.settleFrames ?? ((2 * renderDistance + 1) ** 2 + 2);
  const bounds = sceneBounds(scene);
  const path = opts.path || {
    from: { x: bounds.minX, z: (bounds.minZ + bounds.maxZ) / 2 },
    to: { x: bounds.maxX, z: (bounds.minZ + bounds.maxZ) / 2 },
  };

  const seenEver = new Set();
  let reloads = 0;
  let maxActive = 0;
  const sampleLog = [];
  for (let s = 0; s < samples; s++) {
    const t = samples === 1 ? 1 : s / (samples - 1);
    const x = path.from.x + t * (path.to.x - path.from.x);
    const z = path.from.z + t * (path.to.z - path.from.z);
    const y = target.transform.position.y;
    target.transform.setPosition(x, y, z);
    for (let f = 0; f < settleFrames; f++) ctx.step(dt);
    const active = [...streamer.activeChunks.keys()].sort();
    maxActive = Math.max(maxActive, active.length);
    const gone = [...seenEver].filter((k) => !active.includes(k));
    const unloaded = new Set(gone);
    for (const key of active) {
      if (unloaded.has(key)) reloads++;
      seenEver.add(key);
    }
    sampleLog.push({ x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), active: active.length });
  }

  const centerCX = Math.floor(path.to.x / chunkSize);
  const centerCZ = Math.floor(path.to.z / chunkSize);
  const expected = expectedChunkKeys(centerCX, centerCZ, renderDistance);
  const finalActive = new Set([...streamer.activeChunks.keys()]);
  const gaps = expected.filter((k) => !finalActive.has(k));
  const coverage = expected.length ? Number(((expected.length - gaps.length) / expected.length).toFixed(4)) : 1;
  return {
    samples,
    settleFrames,
    coverage,
    gaps,
    thrashReloads: reloads,
    maxActiveChunks: maxActive,
    uniqueChunks: seenEver.size,
    chunkSize,
    renderDistance,
  };
}

/**
 * Traversal audit (Phase 2 world-generation ladder): grid raycast sweep over
 * the scene's walkable bounds. Reports ground coverage plus geometric stuck
 * hazards — void cells (no ground), steep cells (slope unwalkable), and step
 * hazards (cliffs between adjacent cells). Pure geometry on the real Rapier
 * collision hulls; no simulated walking, no fabricated movement.
 */
function sceneBounds(scene) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let found = false;
  for (const go of scene.gameObjects) {
    const p = go.transform?.position;
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) continue;
    let hx = 0.5, hz = 0.5, hy = 0.5;
    for (const comp of go.components || []) {
      const size = comp.size;
      if (Array.isArray(size) && size.length >= 3 && size.every(Number.isFinite)) {
        hx = Math.max(hx, Math.abs(size[0]) / 2);
        hy = Math.max(hy, Math.abs(size[1]) / 2);
        hz = Math.max(hz, Math.abs(size[2]) / 2);
      }
    }
    minX = Math.min(minX, p.x - hx); maxX = Math.max(maxX, p.x + hx);
    minZ = Math.min(minZ, p.z - hz); maxZ = Math.max(maxZ, p.z + hz);
    minY = Math.min(minY, p.y - hy); maxY = Math.max(maxY, p.y + hy);
    found = true;
  }
  if (!found) {
    minX = minZ = -20; maxX = maxZ = 20; minY = -20; maxY = 20;
  }
  return { minX, minZ, maxX, maxZ, minY, maxY };
}

function runTraversalAudit(scene, physicsWorld, opts = {}) {
  const grid = Math.max(2, opts.grid || 9);
  const steepNormalY = opts.steepNormalY ?? 0.7;
  const maxStep = opts.maxStep ?? 1.2;
  const bounds = sceneBounds(scene);
  const topY = bounds.maxY + 20;
  const bottomY = bounds.minY - 20;
  const maxToi = topY - bottomY;
  const cells = [];
  for (let ix = 0; ix < grid; ix++) {
    for (let iz = 0; iz < grid; iz++) {
      const x = bounds.minX + ((ix + 0.5) / grid) * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + ((iz + 0.5) / grid) * (bounds.maxZ - bounds.minZ);
      const cast = physicsWorld.castRayAndGetNormal(
        { x, y: topY, z }, { x: 0, y: -1, z: 0 }, maxToi
      );
      cells.push({
        ix, iz,
        x: Number(x.toFixed(3)), z: Number(z.toFixed(3)),
        hit: cast.hit,
        groundY: cast.hit ? Number((topY - cast.toi).toFixed(3)) : null,
        normalY: cast.hit ? Number(cast.normal.y.toFixed(3)) : null,
      });
    }
  }
  const at = (ix, iz) => (ix >= 0 && iz >= 0 && ix < grid && iz < grid ? cells[ix * grid + iz] : null);
  const holes = [];
  const steep = [];
  for (const cell of cells) {
    if (!cell.hit) holes.push({ x: cell.x, z: cell.z });
    else if (cell.normalY < steepNormalY) steep.push({ x: cell.x, z: cell.z, normalY: cell.normalY });
  }
  const stepHazards = [];
  for (const cell of cells) {
    if (!cell.hit) continue;
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const neighbor = at(cell.ix + dx, cell.iz + dz);
      if (neighbor && neighbor.hit && Math.abs(neighbor.groundY - cell.groundY) > maxStep) {
        stepHazards.push({
          from: { x: cell.x, z: cell.z },
          to: { x: neighbor.x, z: neighbor.z },
          drop: Number(Math.abs(neighbor.groundY - cell.groundY).toFixed(3)),
        });
      }
    }
  }
  const hits = cells.filter(c => c.hit).length;
  return {
    grid,
    cells: cells.length,
    hits,
    coverage: Number((hits / cells.length).toFixed(4)),
    holes,
    steep,
    stepHazards,
    bounds: {
      minX: Number(bounds.minX.toFixed(2)), maxX: Number(bounds.maxX.toFixed(2)),
      minZ: Number(bounds.minZ.toFixed(2)), maxZ: Number(bounds.maxZ.toFixed(2)),
    },
  };
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
      if (objSpec.weapon) {
        go.addComponent(new engine.WeaponController(objSpec.weapon));
      }
      if (objSpec.health) {
        go.addComponent(new engine.HealthComponent(objSpec.health));
      }
      if (objSpec.ai) {
        go.addComponent(new engine.EnemyAI(objSpec.ai));
      }
      if (objSpec.streamer) {
        go.addComponent(
          new engine.WorldStreamer({ ...objSpec.streamer, target: go })
        );
      }
      addElementalComponent(go, objSpec.elemental, engine);
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

/**
 * Game scenarios: build the engine GameRuntime (waves, kills, win/lose) and a
 * deterministic synthetic hit source. The runner aims hits at the nearest alive
 * enemy every `hitEveryFrames` frames — the real damage router, health, kill and
 * wave-clear code paths execute; only aiming is simulated.
 */
/** Adds an ElementalReactionComponent from a spec ({aura, maxHealth}). */
function addElementalComponent(go, spec, engine) {
  if (!spec) return;
  const elemental = new engine.ElementalReactionComponent();
  if (spec.maxHealth !== undefined) {
    elemental.maxHealth = spec.maxHealth;
    elemental.health = spec.maxHealth;
  }
  // Attach before seeding: receiveElementalAttack touches gameObject (visual tint).
  go.addComponent(elemental);
  if (spec.aura) {
    // Seed the aura without damage so reactions fire on the first hit.
    elemental.receiveElementalAttack(spec.aura, 0, 1);
  }
}

function setupGame(spec, scene, engine) {
  const config = spec.game;
  if (!config) return null;
  const mode = config.mode || 'waves';

  const enemySpec = config.enemy || {};
  const enemyHealth = enemySpec.health || { maxHealth: 50, destroyOnDeath: true };
  const enemyAi = enemySpec.ai || { targetName: config.playerName || 'Player Hero' };

  const listeners = new Set();
  const hitSource = {
    onHit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fireAt(name, damage) {
      for (const listener of listeners) listener({ hitObjectName: name, damage });
    }
  };

  let settlement = null;
  const placementResults = [];
  if (mode === 'build') {
    const settlementSpec = config.settlement || {};
    settlement = new engine.Settlement(
      settlementSpec.gridSize ?? 8,
      settlementSpec.targetPopulation ?? 6,
      settlementSpec.startingGold ?? 500,
      settlementSpec.startingFood ?? 20
    );
    for (const placement of settlementSpec.placements || []) {
      // place() skips invalid plots silently (returns {id: null, reason});
      // record every outcome so settlement rules can quote the first failure
      // instead of reporting a bare population shortfall.
      const outcome = settlement.place(placement.type, placement.x, placement.z);
      placementResults.push({
        type: placement.type,
        x: placement.x,
        z: placement.z,
        id: outcome.id,
        reason: outcome.reason ?? null,
      });
    }
  }

  const runtime = new engine.GameRuntime({
    mode,
    scene,
    settlement,
    playerName: config.playerName || 'Player Hero',
    targetScore: config.targetScore,
    timeLimitSeconds: config.timeLimitSeconds,
    totalWaves: config.totalWaves ?? 2,
    enemiesPerWave: config.enemiesPerWave ? () => config.enemiesPerWave : undefined,
    spawnRadius: config.spawnRadius ?? 8,
    scorePerKill: config.scorePerKill ?? 100,
    interWaveDelaySeconds: config.interWaveDelaySeconds ?? 1,
    weapon: mode === 'waves' ? hitSource : undefined,
    hitElement: config.hitElement,
    hitGauge: config.hitGauge,
    buildEnemy: mode === 'waves' ? ({ name, position }) => {
      const enemy = new engine.GameObject(name);
      enemy.transform.setPosition(position[0], position[1] + (enemySpec.y ?? 0.8), position[2]);
      enemy.addComponent(
        new engine.MeshRenderer({
          shape: enemySpec.shape || 'box',
          size: enemySpec.size || [1, 1.5, 1],
          color: enemySpec.color || '#ef4444',
          roughness: 0.5
        })
      );
      addElementalComponent(enemy, enemySpec.elemental, engine);
      if (!enemySpec.elemental) {
        enemy.addComponent(new engine.HealthComponent(enemyHealth));
      }
      enemy.addComponent(new engine.EnemyAI(enemyAi));
      scene.addGameObject(enemy);
      return enemy;
    } : undefined
  });

  const firstSeen = new Map();
  const maxDisplacement = new Map();
  runtime.start();

  return {
    mode,
    runtime,
    hitEveryFrames: config.hitEveryFrames ?? 20,
    hitDamage: config.hitDamage ?? enemyHealth.maxHealth ?? 50,
    fireCount: 0,
    maybeFire(frame) {
      if (mode !== 'waves') return;
      if (frame % this.hitEveryFrames !== 0) return;
      const alive = runtime.spawner
        .getSpawnedNames()
        .map(name => scene.findByName(name))
        .filter(Boolean);
      if (!alive.length) return;
      this.fireAt(alive[0].name, this.hitDamage);
      this.fireCount += 1;
    },
    fireAt(name, damage) {
      hitSource.fireAt(name, damage);
    },
    trackEnemies() {
      for (const name of runtime.spawner.getSpawnedNames()) {
        const enemy = scene.findByName(name);
        if (!enemy) continue;
        const p = enemy.transform.position;
        if (!firstSeen.has(name)) firstSeen.set(name, { x: p.x, z: p.z });
        const first = firstSeen.get(name);
        const moved = Math.hypot(p.x - first.x, p.z - first.z);
        maxDisplacement.set(name, Math.max(maxDisplacement.get(name) ?? 0, moved));
      }
    },
    maxEnemyDisplacement() {
      let max = 0;
      for (const value of maxDisplacement.values()) max = Math.max(max, value);
      return max;
    },
    placementSummary() {
      const placed = placementResults.filter(r => r.id !== null && r.id !== undefined).length;
      const firstFailure = placementResults.find(r => r.id === null || r.id === undefined);
      return {
        attempted: placementResults.length,
        placed,
        firstFailureReason: firstFailure ? (firstFailure.reason ?? 'rejected') : null,
      };
    }
  };
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

/**
 * Placement footnote for settlement rules: when plots fail, quote placed /
 * attempted plus the first engine reason (e.g. insufficient gold) so repair
 * sees the cause, not just the population shortfall. Empty when every plot
 * placed or no build game is present.
 */
function placementNote(game) {
  if (!game || typeof game.placementSummary !== 'function') return '';
  const summary = game.placementSummary();
  if (!summary || !summary.attempted || summary.placed === summary.attempted) return '';
  const reason = summary.firstFailureReason ? `; first failure: ${summary.firstFailureReason}` : '';
  return `; plots placed ${summary.placed}/${summary.attempted}${reason}`;
}

function evaluateRules(spec, ctxData) {
  const { scene, samples, firstSamples, metrics, dt, game } = ctxData;
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
      case 'traversal_coverage_min': {
        const traversal = metrics.traversal;
        if (!traversal) {
          pass = false;
          detail = 'traversal audit did not run (add spec.traversal or --traverse)';
          break;
        }
        const min = rule.min ?? 0.8;
        pass = traversal.coverage >= min;
        detail = `coverage=${traversal.coverage} (min ${min}), holes=${traversal.holes.length}, steep=${traversal.steep.length}, stepHazards=${traversal.stepHazards.length}`;
        break;
      }
      case 'streaming_coherence_min': {
        const streaming = metrics.streaming;
        if (!streaming) {
          pass = false;
          detail = 'streaming audit did not run (add spec.streaming with a streamer object)';
          break;
        }
        const min = rule.min ?? 1.0;
        pass = streaming.coverage >= min && streaming.gaps.length === 0;
        detail = `coverage=${streaming.coverage} (min ${min}), gaps=${streaming.gaps.length}, thrashReloads=${streaming.thrashReloads}, maxActive=${streaming.maxActiveChunks}`;
        break;
      }
      case 'biome_coverage_min': {
        // Composition audit: tagged objects must exist LIVE in the built scene
        // (not just in the spec) and inside the optional region bounds.
        const want = rule.biome;
        if (typeof want !== 'string' || !want) {
          pass = false;
          detail = 'biome_coverage_min requires a biome name string';
          break;
        }
        const region = rule.region || null;
        const inRegion = (go) => {
          if (!region) return true;
          const p = go.transform?.position;
          if (!p) return false;
          return (
            (region.minX === undefined || p.x >= region.minX) &&
            (region.maxX === undefined || p.x <= region.maxX) &&
            (region.minZ === undefined || p.z >= region.minZ) &&
            (region.maxZ === undefined || p.z <= region.maxZ)
          );
        };
        const tagged = (spec.gameObjects || []).filter(
          (o) => o && o.biome === want
        );
        const live = tagged.filter((o) => scene.findByName(o.name) && inRegion(scene.findByName(o.name)));
        const min = rule.min ?? 1;
        pass = live.length >= min;
        detail = `biome '${want}': ${live.length} live objects in region (min ${min})` +
          (live.length < min ? `; tagged: [${tagged.map((o) => o.name).join(', ')}]` : '');
        break;
      }
      case 'game_phase': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const phase = game.runtime.flow.getPhase();
        pass = phase === rule.phase;
        detail = `phase=${phase} (expected ${rule.phase})`;
        break;
      }
      case 'game_score_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const score = game.runtime.session.getScore();
        pass = score >= (rule.min ?? 1);
        detail = `score=${score} (min ${rule.min ?? 1})`;
        break;
      }
      case 'game_kills_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const kills = game.runtime.session.getKills();
        pass = kills >= (rule.min ?? 1);
        detail = `kills=${kills} (min ${rule.min ?? 1})`;
        break;
      }
      case 'game_wave_reached': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const wave = game.runtime.spawner.getWave();
        pass = wave >= (rule.wave ?? 1);
        detail = `wave=${wave} (min ${rule.wave ?? 1})`;
        break;
      }
      case 'game_reactions_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const reactions = game.runtime.getReactionCount();
        pass = reactions >= (rule.min ?? 1);
        detail = `reactions=${reactions} (min ${rule.min ?? 1})`;
        break;
      }
      case 'game_enemy_chase_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const moved = game.maxEnemyDisplacement();
        pass = moved >= (rule.min ?? 1);
        detail = `max enemy displacement=${moved.toFixed(2)}m (min ${rule.min ?? 1})`;
        break;
      }
      case 'game_settlement_pop_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const settlement = game.runtime.getSettlement();
        if (!settlement) { pass = false; detail = 'no settlement in build-mode game'; break; }
        const population = settlement.snapshot().population;
        pass = population >= (rule.min ?? 1);
        detail = `population=${population} (min ${rule.min ?? 1})${placementNote(game)}`;
        break;
      }
      case 'game_settlement_gold_min': {
        if (!game) { pass = false; detail = 'no game config in scenario'; break; }
        const settlement = game.runtime.getSettlement();
        if (!settlement) { pass = false; detail = 'no settlement in build-mode game'; break; }
        const gold = Math.floor(settlement.snapshot().gold);
        pass = gold >= (rule.min ?? 1);
        detail = `gold=${gold} (min ${rule.min ?? 1})${placementNote(game)}`;
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
    console.error('usage: qa_scenario_runner.mjs --scenario <file.json> [--frames N] [--dt S] [--out file] [--traverse [--traverse-grid N] [--traverse-min-coverage 0..1]]');
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

  const game = setupGame(spec, scene, engine);

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
    if (game) {
      game.runtime.update(args.dt);
      game.maybeFire(frame);
      game.trackEnemies();
    }
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

  const traversalCfg = spec.traversal || (args.traverse ? {} : null);
  if (traversalCfg) {
    const audit = runTraversalAudit(scene, physicsWorld, {
      grid: traversalCfg.grid || args.traverseGrid,
      steepNormalY: traversalCfg.steepNormalY,
      maxStep: traversalCfg.maxStep,
    });
    metrics.traversal = audit;
    if (args.traverse) {
      console.error(
        `[traverse] grid=${audit.grid} coverage=${audit.coverage} ` +
        `holes=${audit.holes.length} steep=${audit.steep.length} ` +
        `stepHazards=${audit.stepHazards.length}`
      );
      for (const hole of audit.holes.slice(0, 10)) {
        console.error(`[traverse] void at (${hole.x}, ${hole.z})`);
      }
    }
  }

  if (spec.streaming || (spec.rules || []).some((r) => r && r.type === 'streaming_coherence_min')) {
    const audit = runStreamingAudit(scene, ctx, {
      dt: args.dt,
      samples: (spec.streaming || {}).samples,
      settleFrames: (spec.streaming || {}).settleFrames,
      path: (spec.streaming || {}).path,
    });
    if (audit) {
      metrics.streaming = audit;
      console.error(
        `[streaming] coverage=${audit.coverage} gaps=${audit.gaps.length} ` +
        `thrashReloads=${audit.thrashReloads} maxActive=${audit.maxActiveChunks}`
      );
    }
  }

  const ruleResults = evaluateRules(spec, { scene, samples, firstSamples, metrics, dt: args.dt, game });
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
    ...(game
      ? {
          game: {
            mode: game.mode,
            phase: game.runtime.flow.getPhase(),
            score: game.runtime.session.getScore(),
            kills: game.runtime.session.getKills(),
            wave: game.runtime.spawner.getWave(),
            traveledDistance: Number(game.runtime.getTraveledDistance().toFixed(2)),
            settlement: game.runtime.getSettlement()?.snapshot() ?? null,
            reactions: game.runtime.getReactionCount(),
            shots: game.fireCount,
            maxEnemyDisplacement: Number(game.maxEnemyDisplacement().toFixed(3))
          }
        }
      : {}),
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
