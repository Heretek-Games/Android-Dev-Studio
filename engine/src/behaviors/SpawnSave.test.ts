import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { Spawner } from './Spawner.js';
import { SaveSlot } from './SaveSlot.js';

const DT = 1 / 60;

function spawnerScene(options?: Record<string, unknown>): { scene: Scene; spawner: Spawner } {
  const scene = new Scene('Test');
  const go = new GameObject('Nest');
  go.transform.setPosition(0, 2, 0);
  const spawner = go.addComponent(new Spawner(options as never));
  scene.addGameObject(go);
  return { scene, spawner };
}

describe('Spawner + SaveSlot behaviors', () => {
  test('spawner emits template copies on interval', () => {
    const { scene, spawner } = spawnerScene({
      interval: 1,
      template: { shape: 'sphere', size: [0.5, 0.5, 0.5], color: '#ff0000' }
    });
    for (let i = 0; i < 180; i++) spawner.update(DT);
    assert.strictEqual(spawner.spawnedCount, 3);
    const children = scene.gameObjects.filter(g => g.name.startsWith('Nest_spawn_'));
    assert.strictEqual(children.length, 3);
    const mesh = children[0].getComponent(MeshRenderer);
    assert.ok(mesh, 'spawned object carries a MeshRenderer');
    assert.strictEqual(mesh.shape, 'sphere');
  });

  test('spawner respects maxSpawns and stop/start', () => {
    const { spawner } = spawnerScene({ interval: 0.5, maxSpawns: 2 });
    for (let i = 0; i < 300; i++) spawner.update(DT);
    assert.strictEqual(spawner.spawnedCount, 2);

    const { spawner: s2 } = spawnerScene({ interval: 0.5, autostart: false });
    for (let i = 0; i < 120; i++) s2.update(DT);
    assert.strictEqual(s2.spawnedCount, 0);
    s2.play();
    for (let i = 0; i < 60; i++) s2.update(DT);
    assert.strictEqual(s2.spawnedCount, 2);
    s2.pause();
    for (let i = 0; i < 120; i++) s2.update(DT);
    assert.strictEqual(s2.spawnedCount, 2);
  });

  test('spawner ring placement is deterministic', () => {
    const run = () => {
      const { scene, spawner } = spawnerScene({ interval: 0.5, spawnRadius: 3 });
      for (let i = 0; i < 240; i++) spawner.update(DT);
      return scene.gameObjects
        .filter(g => g.name.startsWith('Nest_spawn_'))
        .map(g => [g.transform.position.x, g.transform.position.z]);
    };
    const a = run();
    const b = run();
    assert.deepStrictEqual(a, b);
    // Ring spreads spawns (not all stacked on one point).
    const spread = Math.max(...a.map(p => Math.hypot(p[0], p[1])));
    assert.ok(spread > 1, `expected ring spread, max radius=${spread}`);
  });

  test('saveslot captures and restores the owner transform', () => {
    const go = new GameObject('Hero');
    const slot = go.addComponent(new SaveSlot({ slotName: 'checkpoint1' }));
    assert.strictEqual(slot.hasSave, false);
    assert.strictEqual(slot.load(), false);

    go.transform.setPosition(10, 0, 5);
    slot.save();
    assert.strictEqual(slot.hasSave, true);
    assert.strictEqual(slot.saveCount, 1);

    go.transform.setPosition(-7, 3, 9);
    assert.strictEqual(slot.load(), true);
    assert.deepStrictEqual(
      [go.transform.position.x, go.transform.position.y, go.transform.position.z],
      [10, 0, 5]
    );
    assert.strictEqual(slot.loadCount, 1);

    slot.clear();
    assert.strictEqual(slot.hasSave, false);
  });

  test('saveslot autosaves on interval', () => {
    const go = new GameObject('Hero');
    const slot = go.addComponent(new SaveSlot({ autosaveInterval: 1 }));
    go.transform.setPosition(1, 0, 0);
    for (let i = 0; i < 150; i++) slot.update(DT);
    assert.strictEqual(slot.saveCount, 2);
    assert.deepStrictEqual(slot.snapshot!.position, [1, 0, 0]);
  });

  test('both serialize round-trip', () => {
    const { spawner } = spawnerScene({ interval: 2, maxSpawns: 5, spawnRadius: 2 });
    spawner.update(4.5);
    const sj = spawner.toJSON();
    assert.strictEqual(sj.type, 'Spawner');
    const spawner2 = new Spawner();
    spawner2.fromJSON(sj);
    assert.strictEqual(spawner2.spawnedCount, 2);
    assert.strictEqual(spawner2.interval, 2);

    const go = new GameObject('Hero');
    const slot = go.addComponent(new SaveSlot({ slotName: 'a' }));
    go.transform.setPosition(3, 1, 2);
    slot.save();
    const tj = slot.toJSON();
    const go2 = new GameObject('Hero2');
    const slot2 = go2.addComponent(new SaveSlot());
    slot2.fromJSON(tj);
    assert.strictEqual(slot2.slotName, 'a');
    assert.strictEqual(slot2.hasSave, true);
    assert.strictEqual(slot2.load(), true);
    assert.deepStrictEqual(
      [go2.transform.position.x, go2.transform.position.y, go2.transform.position.z],
      [3, 1, 2]
    );
  });
});
