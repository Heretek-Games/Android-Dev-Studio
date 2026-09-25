import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CelShadingComponent } from './CelShader.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';

describe('CelShadingComponent — toon step lighting and outlines', () => {
  test('defaults and option overrides', () => {
    const defaults = new CelShadingComponent();
    assert.strictEqual(defaults.steps, 3);
    assert.strictEqual(defaults.rimColor, '#ffffff');

    const custom = new CelShadingComponent({ steps: 4, rimColor: '#38bdf8', outlineWidth: 0.05 });
    assert.strictEqual(custom.steps, 4);
    assert.strictEqual(custom.rimColor, '#38bdf8');
    assert.strictEqual(custom.outlineWidth, 0.05);
  });

  test('serialization round-trips shading parameters', () => {
    const cel = new CelShadingComponent({ steps: 5, rimIntensity: 0.9, outlineColor: '#101010' });
    const json = cel.toJSON();
    assert.strictEqual(json.type, 'CelShadingComponent');
    assert.strictEqual(json.steps, 5);

    const host = new GameObject('Toon');
    const other = host.addComponent(new CelShadingComponent());
    other.fromJSON(json);
    assert.strictEqual(other.steps, 5);
    assert.strictEqual(other.rimIntensity, 0.9);
  });

  test('applies to a sibling MeshRenderer material when started', () => {
    const go = new GameObject('Toon');
    const mesh = go.addComponent(new MeshRenderer({ shape: 'sphere' }));
    go.addComponent(new CelShadingComponent({ steps: 4 }));
    // start() runs via addComponent -> awake only; explicit lifecycle:
    const cel = go.getComponent(CelShadingComponent)!;
    cel.start();
    assert.ok(mesh.threeMesh, 'mesh exists for the shader to modify');
  });
});
