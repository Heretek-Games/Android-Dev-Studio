#!/usr/bin/env node
/**
 * Physics behavior contract runner (Track C.4, ADR-1790393800001).
 *
 * Builds a fixed-fixture Rapier scenario with LITERAL-ONLY init (no
 * Math.sin/cos — transcendental init breaks cross-platform determinism per
 * the Rapier determinism docs), steps fixed dt, and emits the world snapshot
 * MD5 plus final body states. Any native physics candidate must reproduce
 * these trajectories to satisfy the parity checklist in CONTRACT.md.
 *
 * Fixtures: (1) free-fall box onto a slab, (2) sphere with initial velocity
 * rolling into a wall, (3) stacked boxes struck by a fixed-step impulse.
 *
 * Usage:
 *   node harness/physics/contract.mjs [--steps 600] [--dt 0.0166667]
 * Output: {"steps","dt","snapshotMd5","bodies":[{...}],"rapierVersion"}.
 */

import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';

const DT = 1 / 60;
const STEPS = 600;

function parseArgs(argv) {
  const args = { steps: STEPS, dt: DT };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--steps') args.steps = parseInt(argv[++i], 10);
    else if (argv[i] === '--dt') args.dt = parseFloat(argv[++i]);
  }
  return args;
}

function box(world, x, y, z, hx, hy, hz, dynamic, velocity) {
  const desc = dynamic
    ? RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
    : RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  if (velocity) desc.setLinvel(velocity[0], velocity[1], velocity[2]);
  const body = world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
  return body;
}

function ball(world, x, y, z, radius, velocity) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(...velocity)
  );
  world.createCollider(RAPIER.ColliderDesc.ball(radius), body);
  return body;
}

async function main() {
  const args = parseArgs(process.argv);
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
  world.timestep = args.dt;

  // Ground slab + back wall (fixed).
  box(world, 0, -0.5, 0, 20, 0.5, 20, false);
  box(world, 0, 5, -10, 20, 6, 0.5, false);

  // (1) Free-fall box.
  const drop = box(world, -4, 8, 2, 0.5, 0.5, 0.5, true);
  // (2) Rolling sphere with literal initial velocity.
  const roller = ball(world, 2, 0.5, 4, 0.5, [6.0, 0.0, -1.0]);
  // (3) Stacked boxes; impulse applied at exactly step 120.
  const lower = box(world, 6, 0.5, -2, 0.5, 0.5, 0.5, true);
  const upper = box(world, 6, 1.5, -2, 0.5, 0.5, 0.5, true);

  const tracked = [
    ['drop', drop], ['roller', roller], ['lower', lower], ['upper', upper]
  ];
  for (let step = 0; step < args.steps; step++) {
    if (step === 120) {
      lower.applyImpulse({ x: 3.0, y: 1.0, z: 0.5 }, true);
    }
    world.step();
  }

  const snapshot = world.takeSnapshot();
  const md5 = createHash('md5').update(Buffer.from(snapshot)).digest('hex');
  const bodies = tracked.map(([name, body]) => {
    const t = body.translation();
    const v = body.linvel();
    const r = body.rotation();
    return {
      name,
      pos: [t.x, t.y, t.z].map(Number),
      vel: [v.x, v.y, v.z].map(Number),
      rot: [r.x, r.y, r.z, r.w].map(Number)
    };
  });
  console.log(JSON.stringify({
    steps: args.steps,
    dt: args.dt,
    gravity: [0, -9.81, 0],
    rapierVersion: RAPIER.version ? RAPIER.version() : 'compat-0.14',
    snapshotMd5: md5,
    bodies
  }, null, 1));
  world.free();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
