import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getInspectorSchema,
  readInspectorField,
  registerInspectorSchema,
  registeredSchemaTypes,
  writeInspectorField,
  type InspectorField
} from './InspectorSchema.js';
import '../components/LightComponent.js';
import '../particles/ParticleSystem.js';

describe('InspectorSchema — explicit reflection tables', () => {
  test('spiked components register schemas under stable type strings', () => {
    const types = registeredSchemaTypes();
    assert.ok(types.includes('LightComponent'));
    assert.ok(types.includes('ParticleSystem'));
    const light = getInspectorSchema('LightComponent')!;
    assert.ok(light.some(f => f.key === 'lightType' && f.kind === 'enum'));
    assert.ok(light.some(f => f.key === 'intensity' && f.kind === 'slider'));
    assert.strictEqual(getInspectorSchema('Nope'), null);
  });

  test('minification safety: lookup never touches constructor names', () => {
    // Simulate a mangled class: register under an explicit alias and prove
    // the registry resolves it while the class name differs.
    class Mangled_abc123 {
      public power = 3;
    }
    registerInspectorSchema('StableTypeName', [{ key: 'power', kind: 'number' }]);
    const schema = getInspectorSchema('StableTypeName')!;
    const instance = new Mangled_abc123();
    assert.notStrictEqual(instance.constructor.name, 'StableTypeName');
    assert.strictEqual(readInspectorField(instance, schema[0]), 3);
    assert.deepStrictEqual(writeInspectorField(instance, schema[0], 9), { ok: true });
    assert.strictEqual(instance.power, 9);
  });

  test('write validation: numbers clamp, enums/colors strict', () => {
    const target: Record<string, unknown> = { intensity: 1, lightType: 'directional', color: '#fff' };
    const num: InspectorField = { key: 'intensity', kind: 'slider', min: 0, max: 8 };
    assert.deepStrictEqual(writeInspectorField(target, num, 99), { ok: true });
    assert.strictEqual(target.intensity, 8);
    assert.ok(!writeInspectorField(target, num, 'hot').ok);
    assert.ok(!writeInspectorField(target, num, NaN).ok);
    const en: InspectorField = { key: 'lightType', kind: 'enum', options: ['directional', 'point'] };
    assert.ok(!writeInspectorField(target, en, 'spot').ok);
    assert.deepStrictEqual(writeInspectorField(target, en, 'point'), { ok: true });
    const col: InspectorField = { key: 'color', kind: 'color' };
    assert.ok(!writeInspectorField(target, col, 'red').ok);
    assert.deepStrictEqual(writeInspectorField(target, col, '#ff0000'), { ok: true });
    const flag: InspectorField = { key: 'on', kind: 'boolean' };
    assert.ok(!writeInspectorField(target, flag, 1).ok);
    const vec: InspectorField = { key: 'dir', kind: 'vec3' };
    assert.ok(!writeInspectorField(target, vec, [1, 2]).ok);
    assert.deepStrictEqual(writeInspectorField(target, vec, [0, 1, 0]), { ok: true });
    assert.ok(!writeInspectorField(null, num, 1).ok);
  });

  test('read returns null for missing or malformed values', () => {
    const vec: InspectorField = { key: 'dir', kind: 'vec3' };
    assert.strictEqual(readInspectorField({}, vec), null);
    assert.strictEqual(readInspectorField({ dir: [1, 2] }, vec), null);
    assert.deepStrictEqual(readInspectorField({ dir: [1, 2, 3] }, vec), [1, 2, 3]);
  });
});
