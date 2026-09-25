import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { AnimeCelShader } from './AnimeCelShader.js';

describe('AnimeCelShader — multi-pass anime shading parameters', () => {
  test('parses color options into THREE colors with defaults', () => {
    const shader = new AnimeCelShader({
      baseColor: '#ff8800',
      shadowColor: '#331100',
      rimColor: '#ffffff',
      outlineThickness: 0.02,
      rimPower: 4
    });

    assert.ok(shader.baseColor instanceof THREE.Color);
    assert.strictEqual(`#${shader.baseColor.getHexString()}`, '#ff8800');
    assert.strictEqual(shader.outlineThickness, 0.02);
    assert.strictEqual(shader.rimPower, 4);
  });

  test('defaults are stable for agents and QA scenarios', () => {
    const shader = new AnimeCelShader();
    assert.strictEqual(`#${shader.baseColor.getHexString()}`, '#38bdf8');
    assert.strictEqual(`#${shader.shadowColor.getHexString()}`, '#1e3a8a');
    assert.ok(shader.outlineThickness > 0);
    assert.ok(Math.abs(shader.lightDirection.length() - 1) < 1e-6, 'light direction is normalized');
  });

  test('applyShader is safe before any mesh is attached', () => {
    const shader = new AnimeCelShader();
    shader.applyShader(); // must not throw without a gameObject/mesh
    assert.strictEqual(shader.customMaterial, null);
  });
});
