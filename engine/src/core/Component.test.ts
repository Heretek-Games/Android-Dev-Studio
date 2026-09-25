import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Component } from './Component.js';
import { GameObject } from './GameObject.js';

class ProbeComponent extends Component {}

describe('Component — base lifecycle contract', () => {
  test('components default to enabled with safe no-op lifecycle hooks', () => {
    const component = new ProbeComponent();
    assert.strictEqual(component.enabled, true);

    // Every lifecycle hook is a safe no-op on the base class
    component.awake();
    component.start();
    component.update(0.016);
    component.lateUpdate(0.016);
    component.onCollisionEnter(new GameObject('Other'));
    component.onDestroy();
    component.fromJSON({});
  });

  test('default serialization captures type and enabled state', () => {
    const component = new ProbeComponent();
    component.enabled = false;
    const json = component.toJSON();
    assert.strictEqual(json.type, 'ProbeComponent');
    assert.strictEqual(json.enabled, false);
  });

  test('disabled components are skipped by GameObject update', () => {
    let updates = 0;
    class CountingComponent extends Component {
      public override update(): void {
        updates++;
      }
    }
    const go = new GameObject('Host');
    const component = go.addComponent(new CountingComponent());
    component.enabled = false;

    go.update(0.016);
    assert.strictEqual(updates, 0, 'disabled components do not tick');

    component.enabled = true;
    go.update(0.016);
    assert.strictEqual(updates, 1);
  });
});
