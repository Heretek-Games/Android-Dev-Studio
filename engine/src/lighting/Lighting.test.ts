import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LightProbeVolume,
  emptySH,
  shAddUniform,
  shAddLobe,
  shEvaluate,
  SH_C0
} from './LightProbe.js';
import { ColorGrade } from './ColorGrade.js';

const RED: [number, number, number] = [1, 0, 0];

describe('LightProbeVolume — SH bake, blend, coverage', () => {
  test('uniform term round-trips through evaluation', () => {
    const sh = emptySH();
    shAddUniform(sh, 0.5, 0.25, 1.0);
    const [r, g, b] = shEvaluate(sh, 0, 1, 0);
    assert.ok(Math.abs(r - 0.5) < 1e-9);
    assert.ok(Math.abs(g - 0.25) < 1e-9);
    assert.ok(Math.abs(b - 1.0) < 1e-9);
    assert.ok(Math.abs(sh[0] - 0.5 / SH_C0) < 1e-9);
  });

  test('directional lobe peaks along the light direction', () => {
    const sh = emptySH();
    shAddLobe(sh, 0, 1, 0, ...RED);
    const [rUp] = shEvaluate(sh, 0, 1, 0);
    const [rDown] = shEvaluate(sh, 0, -1, 0);
    assert.ok(Math.abs(rUp - 1) < 1e-9);
    assert.ok(Math.abs(rDown + 1) < 1e-9, 'lobe is antisymmetric (stylized, not clamped)');
  });

  test('bake sums ambient + directional + point falloff', () => {
    const volume = new LightProbeVolume({ probes: [{ position: [0, 0, 0], radius: 8 }] });
    volume.bake([
      { kind: 'ambient', color: [0.2, 0.2, 0.2], intensity: 1 },
      { kind: 'directional', color: [1, 1, 1], intensity: 2, direction: [0, 1, 0] },
      { kind: 'point', color: [1, 0, 0], intensity: 8, position: [3, 0, 0] }
    ]);
    // Point at d=3: falloff 1/(1+9) = 0.1 -> red 8*0.1 = 0.8.
    // Directional up: uniform 1.0 + lobe 1.0 along +Y.
    const [r, g, b] = volume.sample(0, 0, 0).color;
    assert.ok(Math.abs(r - (0.2 + 1.0 + 1.0 + 0.8)) < 1e-9, `r=${r}`);
    assert.ok(Math.abs(g - (0.2 + 1.0 + 1.0)) < 1e-9, `g=${g}`);
    assert.ok(Math.abs(b - (0.2 + 1.0 + 1.0)) < 1e-9, `b=${b}`);
  });

  test('sampling blends in-radius probes and reports coverage', () => {
    const volume = new LightProbeVolume({
      probes: [
        { position: [0, 0, 0], radius: 5 },
        { position: [10, 0, 0], radius: 5 }
      ]
    });
    volume.bake([{ kind: 'ambient', color: [1, 1, 1], intensity: 1 }]);
    // Midpoint: equal weights -> full ambient.
    const mid = volume.sample(5, 0, 0);
    assert.strictEqual(mid.covered, true);
    assert.ok(Math.abs(mid.color[0] - 1) < 1e-9);
    assert.strictEqual(volume.sample(100, 0, 0).covered, false);
    assert.strictEqual(volume.coverage([[0, 0, 0], [10, 0, 0], [100, 0, 0]]), 2 / 3);
    assert.strictEqual(volume.coverage([]), 1);
  });

  test('serialization round-trips probes and SH', () => {
    const volume = new LightProbeVolume({ probes: [{ position: [1, 2, 3], radius: 6 }] });
    volume.bake([{ kind: 'ambient', color: [0.5, 0.5, 0.5], intensity: 1 }]);
    const json = volume.toJSON();
    assert.strictEqual(json.type, 'LightProbeVolume');
    const other = new LightProbeVolume();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.probes.length, 1);
    assert.deepStrictEqual(other.probes[0].position, [1, 2, 3]);
    const [r] = other.sample(1, 2, 3).color;
    assert.ok(Math.abs(r - 0.5) < 1e-9);
  });
});

describe('ColorGrade — LUT sampling and presets', () => {
  test('neutral LUT is identity to numerical noise', () => {
    assert.ok(ColorGrade.neutralDrift(8) < 1e-6);
    const lut = new ColorGrade({ size: 8, preset: 'neutral', amount: 1 });
    const [r, g, b] = lut.grade(0.3, 0.6, 0.9);
    assert.ok(Math.abs(r - 0.3) + Math.abs(g - 0.6) + Math.abs(b - 0.9) < 1e-6);
  });

  test('sunset LUT warms highlights and cools shadows', () => {
    const lut = new ColorGrade({ size: 16, preset: 'sunset', amount: 1 });
    const [wr] = lut.grade(1, 1, 1);
    assert.ok(Math.abs(wr - 1) < 1e-9, `white stays white: ${wr}`);
    const [hr, , hb] = lut.grade(0.9, 0.5, 0.2);
    assert.ok(hr > 0.9, `red lifts: ${hr}`);
    assert.ok(hb < 0.2, `blue cools: ${hb}`);
    // Amount 0 disables grading entirely.
    const dry = new ColorGrade({ size: 8, preset: 'sunset', amount: 0 });
    assert.deepStrictEqual(dry.grade(0.9, 0.5, 0.2), [0.9, 0.5, 0.2]);
  });

  test('explicit data validates length; round-trips', () => {
    const lut = new ColorGrade({ size: 2, data: [0, 1] }); // wrong length -> neutral fallback
    const [r] = lut.sample(0, 0, 0);
    assert.ok(Math.abs(r) < 1e-9);
    const json = lut.toJSON();
    assert.strictEqual(json.type, 'ColorGrade');
    assert.strictEqual(json.data.length, 2 ** 3 * 3);
    const restored = ColorGrade.fromData(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(restored.size, 2);
  });
});
