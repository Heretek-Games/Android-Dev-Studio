import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ModelRenderer } from './ModelRenderer.js';
import { GameObject } from '../core/GameObject.js';

describe('ModelRenderer — glTF model attachment and animation state', () => {
  test('stores model URL, shadows, and scale multiplier', () => {
    const go = new GameObject('Hero');
    const mr = go.addComponent(
      new ModelRenderer({ modelUrl: 'https://example.com/hero.glb', castShadow: false, scale: [2, 2, 2] })
    );
    assert.strictEqual(mr.modelUrl, 'https://example.com/hero.glb');
    assert.strictEqual(mr.castShadow, false);
    assert.deepStrictEqual(mr.scaleMultiplier, [2, 2, 2]);
  });

  test('serialization round-trips renderer options', () => {
    const mr = new ModelRenderer({ modelUrl: 'a.glb', defaultAnimation: 'Run', receiveShadow: false });
    const json = mr.toJSON();
    assert.strictEqual(json.type, 'ModelRenderer');
    assert.strictEqual(json.modelUrl, 'a.glb');
    assert.strictEqual(json.defaultAnimation, 'Run');

    const host = new GameObject('Copy');
    const other = host.addComponent(new ModelRenderer());
    other.fromJSON(json);
    assert.strictEqual(other.modelUrl, 'a.glb');
    assert.strictEqual(other.defaultAnimation, 'Run');
    assert.strictEqual(other.receiveShadow, false);
  });

  test('starts unloaded with no active animation', () => {
    const mr = new ModelRenderer();
    assert.strictEqual(mr.isLoaded, false);
    assert.strictEqual(mr.isLoading, false);
    assert.strictEqual(mr.activeAction, null);
    assert.strictEqual(mr.loadedRoot, null);
  });
});
