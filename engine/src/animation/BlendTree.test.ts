import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AnimationController, BlendTree1D } from './BlendTree.js';
import { GameObject } from '../core/GameObject.js';

describe('BlendTree1D & AnimationController — locomotion blending', () => {
  test('evaluates exact thresholds and interpolates between clips', () => {
    const tree = new BlendTree1D('speed', [
      { name: 'Idle', duration: 2, threshold: 0 },
      { name: 'Walk', duration: 1, threshold: 4 },
      { name: 'Run', duration: 0.6, threshold: 8 }
    ]);

    const idle = tree.evaluate(0, 0.1);
    assert.strictEqual(idle.primaryClip, 'Idle');
    assert.strictEqual(idle.blendWeight, 0);

    const mid = tree.evaluate(6, 0.1);
    assert.strictEqual(mid.primaryClip, 'Walk');
    assert.strictEqual(mid.secondaryClip, 'Run');
    assert.strictEqual(mid.blendWeight, 0.5);

    const run = tree.evaluate(12, 0.1);
    assert.strictEqual(run.primaryClip, 'Run');
    assert.strictEqual(run.blendWeight, 0);
  });

  test('clamps below the first and above the last threshold', () => {
    const tree = new BlendTree1D('speed', [
      { name: 'Idle', duration: 2, threshold: 2 },
      { name: 'Run', duration: 1, threshold: 8 }
    ]);
    assert.strictEqual(tree.evaluate(-5, 0.1).primaryClip, 'Idle');
    assert.strictEqual(tree.evaluate(50, 0.1).primaryClip, 'Run');
  });

  test('addEntry keeps entries sorted by threshold', () => {
    const tree = new BlendTree1D('speed');
    tree.addEntry({ name: 'Run', duration: 1, threshold: 8 });
    tree.addEntry({ name: 'Idle', duration: 2, threshold: 0 });
    tree.addEntry({ name: 'Walk', duration: 1, threshold: 4 });
    assert.deepStrictEqual(
      tree.entries.map(e => e.name),
      ['Idle', 'Walk', 'Run']
    );
  });

  test('AnimationController drives trees from named parameters', () => {
    const go = new GameObject('Character');
    const controller = go.addComponent(new AnimationController());
    const tree = new BlendTree1D('speed', [
      { name: 'Idle', duration: 2, threshold: 0 },
      { name: 'Run', duration: 1, threshold: 8 }
    ]);
    controller.blendTrees.set('locomotion', tree);
    controller.setFloat('speed', 8);

    assert.strictEqual(controller.getFloat('speed'), 8);
    controller.update(0.1);
    assert.ok(controller.lastResult, 'controller evaluates its active tree');
    assert.strictEqual(controller.lastResult!.primaryClip, 'Run');

    const json = controller.toJSON();
    assert.strictEqual(json.type, 'AnimationController');
  });
});
