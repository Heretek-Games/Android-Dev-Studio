import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { LightComponent } from '../components/LightComponent.js';
import { DayNightCycle } from './DayNightCycle.js';

describe('DayNightCycle — time-of-day sun rig', () => {
  test('pure sun function: noon high and white, midnight low and dark', () => {
    const noon = DayNightCycle.sunStateAt(0.5);
    assert.strictEqual(noon.color, '#fff7ed');
    assert.strictEqual(noon.phase, 'day');
    assert.ok(noon.elevation > 1.2, `noon elevation=${noon.elevation}`);
    const midnight = DayNightCycle.sunStateAt(0);
    assert.strictEqual(midnight.phase, 'night');
    assert.ok(midnight.elevation < 0, `midnight elevation=${midnight.elevation}`);
    assert.ok(midnight.intensity < noon.intensity);
  });

  test('phase boundaries walk night -> dawn -> day -> dusk -> night', () => {
    const at = (t: number) => DayNightCycle.sunStateAt(t).phase;
    assert.deepStrictEqual([at(0), at(0.25), at(0.5), at(0.75), at(0.95)],
      ['night', 'dawn', 'day', 'dusk', 'night']);
  });

  test('sunrise/sunset read warm, day reads bright', () => {
    assert.strictEqual(DayNightCycle.sunStateAt(0.25).color, '#fb923c');
    assert.strictEqual(DayNightCycle.sunStateAt(0.75).color, '#fb923c');
  });

  test('update advances time, wraps, and drives bound lights', () => {
    const rig = new GameObject('Sun Rig');
    const cycle = rig.addComponent(new DayNightCycle({ dayLengthSeconds: 100, startTimeOfDay: 0.5 }));
    const sunGo = new GameObject('Sun');
    const sun = sunGo.addComponent(new LightComponent({ type: 'directional' }));
    const ambGo = new GameObject('Sky');
    const ambient = ambGo.addComponent(new LightComponent({ type: 'ambient' }));
    cycle.bind(sun, ambient);
    assert.strictEqual(sun.color, '#fff7ed');
    cycle.update(25); // quarter day -> dusk
    assert.strictEqual(cycle.phase(), 'dusk');
    assert.strictEqual(sun.color, '#fb923c');
    cycle.update(25); // -> midnight
    assert.strictEqual(cycle.phase(), 'night');
    assert.ok(ambient.intensity < 0.2, `night ambient=${ambient.intensity}`);
    assert.strictEqual(cycle.timeOfDay, 0);
  });

  test('invalid options fall back to safe defaults', () => {
    const cycle = new DayNightCycle({ dayLengthSeconds: -5, startTimeOfDay: NaN });
    assert.strictEqual(cycle.dayLengthSeconds, 240);
    assert.ok(Number.isFinite(cycle.timeOfDay));
  });
});
