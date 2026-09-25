import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { Tween } from './Tween.js';

function hero(): { go: GameObject; tween: Tween } {
  const go = new GameObject('Hero');
  go.transform.setPosition(0, 0, 0);
  go.addComponent(new MeshRenderer({ shape: 'box', size: [1, 1, 1], color: '#ffffff' }));
  const tween = go.addComponent(new Tween());
  return { go, tween };
}

describe('Tween behavior — easings, loops, determinism', () => {
  test('linear position tween completes in duration', () => {
    const { go, tween } = hero();
    tween.play('slide', { property: 'position.x', to: 10, duration: 1.0, ease: 'linear' });
    tween.update(0.5);
    assert.ok(Math.abs(go.transform.position.x - 5) < 1e-9);
    assert.strictEqual(tween.isPlaying('slide'), true);
    tween.update(0.5);
    assert.ok(Math.abs(go.transform.position.x - 10) < 1e-9);
    assert.strictEqual(tween.isPlaying('slide'), false);
  });

  test('easings shape the curve (easeOutQuad leads linear at midpoint)', () => {
    const a = hero();
    const b = hero();
    a.tween.play('m', { property: 'position.x', to: 10, duration: 1.0, ease: 'linear' });
    b.tween.play('m', { property: 'position.x', to: 10, duration: 1.0, ease: 'easeOutQuad' });
    a.tween.update(0.5);
    b.tween.update(0.5);
    assert.ok(b.go.transform.position.x > a.go.transform.position.x);
  });

  test('loop restarts and stop halts', () => {
    const { go, tween } = hero();
    tween.play('pulse', { property: 'scale.x', to: 2, duration: 0.5, loop: true });
    tween.update(0.5);
    assert.strictEqual(tween.isPlaying('pulse'), true);
    tween.stop('pulse');
    assert.strictEqual(tween.isPlaying('pulse'), false);
  });

  test('replaying an identifier restarts from the current value', () => {
    const { go, tween } = hero();
    tween.play('m', { property: 'position.x', to: 10, duration: 1.0 });
    tween.update(0.5);
    tween.play('m', { property: 'position.x', to: 10, duration: 1.0 });
    tween.update(0.5);
    // Restarted from x=5: halfway to 10 again => 7.5.
    assert.ok(Math.abs(go.transform.position.x - 7.5) < 1e-9);
  });

  test('delay holds the start value', () => {
    const { go, tween } = hero();
    tween.play('m', { property: 'position.y', to: 10, duration: 1.0, delay: 0.5 });
    tween.update(0.4);
    assert.strictEqual(go.transform.position.y, 0);
    tween.update(0.6);
    assert.ok(go.transform.position.y > 0);
  });

  test('serializes as a behavior component', () => {
    const { tween } = hero();
    const json = tween.toJSON();
    assert.strictEqual(json.type, 'Tween');
    const other = new Tween();
    other.fromJSON(json);
    assert.strictEqual(other.enabled, true);
  });
});
