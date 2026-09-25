import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from './Scene.js';
import { GameObject } from './GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { EnemyAI } from '../components/EnemyAI.js';
import { AnimeCelShader } from '../shaders/AnimeCelShader.js';
import { HistoryStack } from './HistoryStack.js';
import './BuiltinComponents.js';

function questScene(): Scene {
  const scene = new Scene('Quest');
  const hero = new GameObject('Hero');
  hero.transform.setPosition(0, 1.5, 0);
  hero.addComponent(new MeshRenderer({ shape: 'capsule', size: [1, 1.5, 1], color: '#3b82f6' }));
  hero.addComponent(new HealthComponent({ maxHealth: 100 }));
  scene.addGameObject(hero);

  const goblin = new GameObject('Goblin');
  goblin.transform.setPosition(5, 1.5, 0);
  goblin.addComponent(new MeshRenderer({ shape: 'capsule', size: [1, 1.5, 1], color: '#4d7c0f' }));
  goblin.addComponent(new HealthComponent({ maxHealth: 50 }));
  goblin.addComponent(new EnemyAI({ targetName: 'Hero', moveSpeed: 3 }));
  goblin.addComponent(new AnimeCelShader({ baseColor: '#4d7c0f', rimPower: 2.5 }));
  scene.addGameObject(goblin);
  return scene;
}

describe('Scene restore — toJSON/fromJSON round-trip + HistoryStack', () => {
  test('round-trip preserves objects, transforms, and component state', () => {
    const scene = questScene();
    const snapshot = JSON.stringify(scene.toJSON());

    const restored = new Scene('Empty');
    restored.fromJSON(JSON.parse(snapshot));

    assert.strictEqual(restored.gameObjects.length, 2);
    const hero = restored.findByName('Hero');
    assert.ok(hero);
    assert.deepStrictEqual(
      [hero.transform.position.x, hero.transform.position.y, hero.transform.position.z],
      [0, 1.5, 0]
    );
    assert.strictEqual(hero.getComponent(HealthComponent)?.maxHealth, 100);
    const goblin = restored.findByName('Goblin');
    assert.strictEqual(goblin?.getComponent(EnemyAI)?.moveSpeed, 3);
    assert.ok(goblin?.getComponent(AnimeCelShader));
  });

  test('unknown component types fail loudly, never silently drop', () => {
    const scene = questScene();
    const data = JSON.parse(JSON.stringify(scene.toJSON()));
    data.gameObjects[0].components.push({ type: 'NopeComponent' });
    assert.throws(() => new Scene('X').fromJSON(data), /unknown component type 'NopeComponent'/);
  });

  test('HistoryStack undo/redo with cap and branch clearing', () => {
    const history = new HistoryStack(3);
    assert.strictEqual(history.canUndo, false);

    history.checkpoint('s0');
    history.checkpoint('s1');
    history.checkpoint('s2');
    history.checkpoint('s3'); // over capacity: s0 evicted
    assert.strictEqual(history.undoDepth, 3);

    assert.strictEqual(history.popUndo(), 's3');
    history.stageRedo('s4');
    assert.strictEqual(history.canRedo, true);
    assert.strictEqual(history.popRedo(), 's4');

    history.checkpoint('s5'); // new branch clears redo
    assert.strictEqual(history.canRedo, false);
    assert.strictEqual(history.popUndo(), 's5');
    assert.strictEqual(history.popUndo(), 's2');
    assert.strictEqual(history.popUndo(), 's1');
    assert.strictEqual(history.popUndo(), null);
  });

  test('full undo cycle restores a deleted object', () => {
    const scene = questScene();
    const history = new HistoryStack();
    history.checkpoint(JSON.stringify(scene.toJSON()));

    scene.findByName('Goblin')?.destroy();
    assert.strictEqual(scene.findByName('Goblin'), null);

    const snap = history.popUndo();
    assert.ok(snap);
    scene.fromJSON(JSON.parse(snap));
    const goblin = scene.findByName('Goblin');
    assert.ok(goblin);
    assert.strictEqual(goblin?.getComponent(HealthComponent)?.maxHealth, 50);
  });

  test('pushUndo preserves the redo branch for redo navigation', () => {
    const history = new HistoryStack();
    history.checkpoint('s0');
    history.checkpoint('s1');
    assert.strictEqual(history.popUndo(), 's1');
    history.stageRedo('s2');
    history.pushUndo('s1-again');
    // Redo branch intact: s2 still available.
    assert.strictEqual(history.popRedo(), 's2');
    assert.strictEqual(history.canRedo, false);
  });
});
