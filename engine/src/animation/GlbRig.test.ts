import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseGlbRig } from './GlbRig.js';

/** Synthesizes a minimal rigged GLB (no binary blobs in the repo). */
function buildFixtureGlb(): Uint8Array {
  const times = new Float32Array([0, 0.5, 1.0]);
  const binBytes = new Uint8Array(times.buffer);

  const json = {
    asset: { version: '2.0' },
    nodes: [
      { name: 'Hips', children: [1, 3] },
      { name: 'Spine', children: [2] },
      { name: 'Head' },
      { name: 'ArmL' }
    ],
    skins: [{ joints: [0, 1, 2, 3] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binBytes.length }],
    accessors: [
      // 0: input times WITH max (fast path)
      { bufferView: 0, byteOffset: 0, count: 3, componentType: 5126, type: 'SCALAR', max: [1.0] },
      // 1: input times WITHOUT max (slow BIN path)
      { bufferView: 0, byteOffset: 0, count: 3, componentType: 5126, type: 'SCALAR' }
    ],
    animations: [
      {
        name: 'Idle',
        channels: [
          { sampler: 0, target: { node: 1, path: 'rotation' } },
          { sampler: 0, target: { node: 2, path: 'rotation' } }
        ],
        samplers: [{ input: 0, interpolation: 'LINEAR' }]
      },
      {
        name: 'Attack',
        channels: [{ sampler: 0, target: { node: 3, path: 'translation' } }],
        samplers: [{ input: 1, interpolation: 'STEP' }]
      }
    ]
  };
  const jsonText = JSON.stringify(json);
  const jsonPad = (4 - (jsonText.length % 4)) % 4;
  const jsonBytes = new TextEncoder().encode(jsonText + ' '.repeat(jsonPad));

  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46], 0); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  out.set([0x4a, 0x53, 0x4f, 0x4e], 16); // JSON
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.length;
  view.setUint32(binHeader, binBytes.length, true);
  out.set([0x42, 0x49, 0x4e, 0x00], binHeader + 4); // BIN
  out.set(binBytes, binHeader + 8);
  return out;
}

describe('GlbRig — headless rigged-GLB import proof', () => {
  test('parses joints in skin order with hierarchy', () => {
    const rig = parseGlbRig(buildFixtureGlb());
    assert.strictEqual(rig.skinCount, 1);
    assert.deepStrictEqual(rig.joints.map(j => j.name), ['Hips', 'Spine', 'Head', 'ArmL']);
    assert.deepStrictEqual(rig.joints[0].children, [1, 3]);
  });

  test('parses animations with durations, paths, interpolations', () => {
    const rig = parseGlbRig(buildFixtureGlb());
    assert.strictEqual(rig.animations.length, 2);
    const idle = rig.animations[0];
    assert.strictEqual(idle.name, 'Idle');
    assert.strictEqual(idle.duration, 1.0);
    assert.strictEqual(idle.channels, 2);
    assert.deepStrictEqual(idle.paths, ['rotation']);
    // Attack uses the slow BIN path (no accessor max) + STEP interpolation.
    const attack = rig.animations[1];
    assert.strictEqual(attack.duration, 1.0);
    assert.deepStrictEqual(attack.interpolations, ['STEP']);
  });

  test('rejects malformed input loudly', () => {
    assert.throws(() => parseGlbRig(new Uint8Array([1, 2, 3])), /not a GLB/);
    assert.throws(() => parseGlbRig(new TextEncoder().encode('{"asset":{}}')), /not a GLB/);
    const noJson = new Uint8Array(12);
    noJson.set([0x67, 0x6c, 0x54, 0x46], 0);
    new DataView(noJson.buffer).setUint32(4, 2, true);
    new DataView(noJson.buffer).setUint32(8, 12, true);
    assert.throws(() => parseGlbRig(noJson), /no JSON chunk/);
  });
});
