import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { EngineContext } from '../core/EngineContext.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';
import { VehicleController } from './VehicleController.js';

async function buildVehicleScene() {
  const scene = new Scene('VehicleTest');
  const physics = new PhysicsWorld();
  await physics.initialize();
  scene.physicsWorld = physics;

  const ground = new GameObject('Ground');
  ground.transform.setPosition(0, -0.5, 0);
  ground.addComponent(new MeshRenderer({ shape: 'box', size: [400, 1, 400] }));
  ground.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
  ground.addComponent(new Collider3D({ shape: 'box', size: [400, 1, 400] }));
  scene.addGameObject(ground);

  const chassis = new GameObject('Chassis');
  chassis.transform.setPosition(0, 1.0, 0);
  chassis.addComponent(new MeshRenderer({ shape: 'box', size: [2, 0.6, 4] }));
  chassis.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 800 }));
  chassis.addComponent(new Collider3D({ shape: 'box', size: [2, 0.6, 4] }));

  const vehicle = new VehicleController({
    wheels: [
      { name: 'FL', offset: [-0.9, -0.3, -1.3], radius: 0.35, steered: true },
      { name: 'FR', offset: [0.9, -0.3, -1.3], radius: 0.35, steered: true },
      { name: 'RL', offset: [-0.9, -0.3, 1.3], radius: 0.35, driven: true },
      { name: 'RR', offset: [0.9, -0.3, 1.3], radius: 0.35, driven: true }
    ]
  });
  chassis.addComponent(vehicle);
  scene.addGameObject(chassis);

  for (const go of scene.gameObjects) {
    const rb = go.getComponent(RigidBody3D);
    const col = go.getComponent(Collider3D);
    if (rb) rb.initPhysics(physics);
    if (col) col.initPhysics(physics);
  }

  const ctx = new EngineContext();
  ctx.setScene(scene);
  return { scene, physics, chassis, vehicle, ctx };
}

const DT = 1 / 60;

describe('VehicleController — Rapier raycast vehicle wrapper', () => {
  test('dynamic bodies honor the configured mass (collider mass distribution)', async () => {
    const { chassis, ctx } = await buildVehicleScene();
    ctx.step(DT); // Rapier recomputes body mass properties from colliders on step
    const rb = chassis.getComponent(RigidBody3D);
    const rapierMass = rb?.rapierBody?.mass() ?? 0;
    assert.ok(
      Math.abs(rapierMass - 800) < 1,
      `chassis rapier mass should be ~800kg, got ${rapierMass.toFixed(2)}`
    );
  });

  test('suspension holds the chassis up with all wheels grounded', async () => {
    const { chassis, vehicle, ctx } = await buildVehicleScene();
    for (let i = 0; i < 90; i++) ctx.step(DT);

    const y = chassis.transform.position.y;
    assert.ok(y > 0.4 && y < 1.2, `chassis should settle above ground, got y=${y}`);
    const grounded = vehicle.wheelStates.filter(w => w.grounded).length;
    assert.strictEqual(grounded, 4, 'all four wheels should be grounded');
    for (const wheel of vehicle.wheelStates) {
      assert.ok(wheel.suspensionForce >= 0, 'wheels report suspension force');
      assert.ok(wheel.contactNormal !== null, 'wheels report contact normals');
      assert.ok(wheel.contactNormal!.y > 0.9, 'contact normal points up on flat ground');
    }
  });

  test('throttle drives the vehicle forward (-Z)', async () => {
    const { chassis, vehicle, ctx } = await buildVehicleScene();
    vehicle.throttle = 1;
    for (let i = 0; i < 150; i++) ctx.step(DT);

    const dz = chassis.transform.position.z;
    assert.ok(dz < -2, `should travel forward (-Z), got z=${dz.toFixed(2)}`);
    assert.ok(vehicle.speed > 2, `solver should report forward speed, got ${vehicle.speed.toFixed(2)}`);
  });

  test('steering turns the vehicle while driving', async () => {
    const { chassis, vehicle, ctx } = await buildVehicleScene();
    vehicle.throttle = 0.7;
    vehicle.steering = 1;
    for (let i = 0; i < 150; i++) ctx.step(DT);

    assert.ok(
      Math.abs(chassis.transform.rotation.y) > 0.08,
      `steering should yaw the chassis, got ${chassis.transform.rotation.y.toFixed(3)} rad`
    );
  });

  test('braking stops a moving vehicle faster than coasting', async () => {
    const brakeRun = await buildVehicleScene();
    brakeRun.vehicle.throttle = 1;
    for (let i = 0; i < 90; i++) brakeRun.ctx.step(DT);
    brakeRun.vehicle.throttle = 0;
    brakeRun.vehicle.brake = 1;
    for (let i = 0; i < 90; i++) brakeRun.ctx.step(DT);
    const brakeDistance = Math.abs(brakeRun.chassis.transform.position.z);

    const coastRun = await buildVehicleScene();
    coastRun.vehicle.throttle = 1;
    for (let i = 0; i < 90; i++) coastRun.ctx.step(DT);
    coastRun.vehicle.throttle = 0;
    for (let i = 0; i < 90; i++) coastRun.ctx.step(DT);
    const coastDistance = Math.abs(coastRun.chassis.transform.position.z);

    assert.ok(
      brakeDistance < coastDistance,
      `braking (${brakeDistance.toFixed(1)}m) should travel less than coasting (${coastDistance.toFixed(1)}m)`
    );
  });

  test('wheel telemetry reports impulses and rotation under throttle', async () => {
    const { vehicle, ctx } = await buildVehicleScene();
    vehicle.throttle = 1;
    for (let i = 0; i < 90; i++) ctx.step(DT);

    const driven = vehicle.wheelStates.filter(w => Math.abs(w.forwardImpulse) > 0);
    assert.ok(driven.length >= 2, 'driven wheels should report forward impulses');
    assert.ok(
      vehicle.wheelStates.some(w => Math.abs(w.rotation) > 1e-3),
      'wheel rotation should be observable'
    );
  });
});
