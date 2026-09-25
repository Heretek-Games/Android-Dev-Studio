import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { EnemyAI } from '../components/EnemyAI.js';
import { AnimeCelShader } from '../shaders/AnimeCelShader.js';
import { EventSheet } from '../events/EventSheet.js';
import {
  applyPrefabFields,
  instantiatePrefab,
  type PrefabDef,
  type PrefabStore
} from './Prefab.js';
import { GameObject } from '../core/GameObject.js';
import '../core/BuiltinComponents.js';

function goblin(): PrefabDef {
  return {
    id: 'goblin',
    name: 'Goblin',
    template: {
      shape: 'capsule',
      size: [1, 1.5, 1],
      color: '#4d7c0f',
      physics: 'none',
      health: { maxHealth: 50 },
      ai: { targetName: 'Player Hero', moveSpeed: 2.5 }
    }
  };
}

describe('Prefab — templates, variants, runtime instantiation', () => {
  test('instantiate builds mesh + health + AI from template', () => {
    const scene = new Scene('Test');
    const store: PrefabStore = new Map([['goblin', goblin()]]);
    const go = instantiatePrefab(scene, store, 'goblin', 'Goblin A');

    assert.strictEqual(go.name, 'Goblin A');
    assert.ok(go.getComponent(MeshRenderer));
    assert.strictEqual(go.getComponent(HealthComponent)?.maxHealth, 50);
    assert.strictEqual(go.getComponent(EnemyAI)?.targetName, 'Player Hero');
    assert.strictEqual(scene.findByName('Goblin A'), go);
  });

  test('instance overrides win over template', () => {
    const scene = new Scene('Test');
    const store: PrefabStore = new Map([['goblin', goblin()]]);
    const go = instantiatePrefab(scene, store, 'goblin', 'Goblin B', {
      position: [5, 1.5, 0],
      color: '#ff0000',
      health: { maxHealth: 80 }
    });

    assert.deepStrictEqual(
      [go.transform.position.x, go.transform.position.y, go.transform.position.z],
      [5, 1.5, 0]
    );
    assert.strictEqual(go.getComponent(HealthComponent)?.maxHealth, 80);
    // Untouched template fields survive.
    assert.strictEqual(go.getComponent(EnemyAI)?.moveSpeed, 2.5);
  });

  test('variant chains resolve root-first with overrides winning per level', () => {
    const scene = new Scene('Test');
    const store: PrefabStore = new Map([
      ['goblin', goblin()],
      ['goblin-brute', {
        id: 'goblin-brute',
        base: 'goblin',
        overrides: { health: { maxHealth: 120 } }
      }],
      ['goblin-king', {
        id: 'goblin-king',
        base: 'goblin-brute',
        overrides: { color: '#ffd700' }
      }]
    ]);
    const go = instantiatePrefab(scene, store, 'goblin-king', 'King');

    assert.strictEqual(go.getComponent(HealthComponent)?.maxHealth, 120);
    const mesh = go.getComponent(MeshRenderer);
    assert.strictEqual(mesh?.color, '#ffd700');
  });

  test('unknown prefab and cycles throw with specific messages', () => {
    const scene = new Scene('Test');
    const store: PrefabStore = new Map([['goblin', goblin()]]);
    assert.throws(() => instantiatePrefab(scene, store, 'orc', 'Orc'), /unknown prefab 'orc'/);

    const cyclic: PrefabStore = new Map([
      ['a', { id: 'a', base: 'b', template: {} }],
      ['b', { id: 'b', base: 'a', template: {} }]
    ]);
    assert.throws(() => instantiatePrefab(scene, cyclic, 'a', 'A'), /base cycle: a -> b -> a/);
  });

  test('cel + events apply from prefab fields', () => {
    const scene = new Scene('Test');
    const go = new GameObject('Hero');
    applyPrefabFields(go, {
      shape: 'capsule',
      cel: { baseColor: '#38bdf8', rimPower: 3.5 },
      events: [{ name: 'Spin', conditions: [{ type: 'EveryFrame' }], actions: [{ type: 'RotateY' }] }]
    });

    assert.ok(go.getComponent(AnimeCelShader));
    assert.strictEqual(go.getComponent(EventSheet)?.events.length, 1);
    // Field application alone never stamps linkage.
    assert.strictEqual(go.prefabId, null);
  });

  test('instantiation stamps linkage; detach + scene round-trip preserve it', () => {
    const scene = new Scene('Test');
    const store: PrefabStore = new Map([
      ['goblin', goblin()],
      ['goblin-brute', { id: 'goblin-brute', base: 'goblin', overrides: { color: '#ff0000' } }]
    ]);
    const brute = instantiatePrefab(scene, store, 'goblin-brute', 'Brute');
    assert.strictEqual(brute.prefabId, 'goblin-brute');
    assert.strictEqual(brute.prefabBase, 'goblin');

    const plain = instantiatePrefab(scene, store, 'goblin', 'Grunt');
    assert.strictEqual(plain.prefabId, 'goblin');
    assert.strictEqual(plain.prefabBase, null);

    // Detach drops linkage without touching the baked components.
    brute.prefabId = null;
    brute.prefabBase = null;
    assert.strictEqual(brute.getComponent(HealthComponent)?.maxHealth, 50);
    const detachedJson = brute.toJSON();
    assert.ok(!('prefabId' in detachedJson), 'detached objects stay snapshot-identical');

    // Attached linkage survives a full scene JSON round-trip (undo path).
    const json = JSON.stringify(scene.toJSON());
    const restored = new Scene('Restored');
    restored.fromJSON(JSON.parse(json));
    const restoredGrunt = restored.findByName('Grunt');
    assert.strictEqual(restoredGrunt?.prefabId, 'goblin');
    assert.strictEqual(restoredGrunt?.prefabBase, null);
    assert.strictEqual(restored.findByName('Brute')?.prefabId, null);
  });
});
