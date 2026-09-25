import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { Draggable } from './Draggable.js';
import { DestroyOutsideScreen } from './DestroyOutsideScreen.js';

describe('Draggable + DestroyOutsideScreen behaviors', () => {
  test('draggable eases toward the target and honors axis lock', () => {
    const go = new GameObject('Crate');
    const drag = go.addComponent(new Draggable());
    drag.dragTarget = { x: 10, z: 0 };
    for (let i = 0; i < 120; i++) drag.update(1 / 60);
    assert.ok(go.transform.position.x > 9, `expected convergence, got ${go.transform.position.x}`);

    const locked = new GameObject('Locked');
    const dragZ = locked.addComponent(new Draggable({ axisLock: 'x' }));
    dragZ.dragTarget = { x: 10, z: 10 };
    for (let i = 0; i < 120; i++) dragZ.update(1 / 60);
    assert.strictEqual(locked.transform.position.x, 0);
    assert.ok(locked.transform.position.z > 9);
  });

  test('draggable snap-back returns home on release', () => {
    const go = new GameObject('Crate');
    go.transform.setPosition(2, 0, 3);
    const drag = go.addComponent(new Draggable({ snapBack: true }));
    drag.dragTarget = { x: 10, z: 10 };
    drag.update(1 / 60);
    assert.ok(go.transform.position.x > 2);
    drag.dragTarget = null;
    drag.update(1 / 60);
    assert.strictEqual(go.transform.position.x, 2);
    assert.strictEqual(go.transform.position.z, 3);
    assert.strictEqual(drag.isDragging, false);
  });

  test('destroy-outside removes escapees with a timestamp', () => {
    const scene = new Scene('Test');
    const go = new GameObject('Bolt');
    go.transform.setPosition(0, 0, 0);
    const doom = go.addComponent(new DestroyOutsideScreen({ margin: 10 }));
    scene.addGameObject(go);
    doom.update(0.5);
    assert.strictEqual(scene.findByName('Bolt'), go);
    assert.strictEqual(doom.destroyedAt, null);

    go.transform.setPosition(11, 0, 0);
    doom.update(0.5);
    assert.strictEqual(scene.findByName('Bolt'), null);
    assert.strictEqual(doom.destroyedAt, 1.0);
  });

  test('both serialize round-trip', () => {
    const drag = new Draggable({ axisLock: 'z', snapBack: true });
    const dj = drag.toJSON();
    assert.strictEqual(dj.type, 'Draggable');
    const drag2 = new Draggable();
    drag2.fromJSON(dj);
    assert.strictEqual(drag2.axisLock, 'z');

    const doom = new DestroyOutsideScreen({ margin: 25 });
    const oj = doom.toJSON();
    const doom2 = new DestroyOutsideScreen();
    doom2.fromJSON(oj);
    assert.strictEqual(doom2.margin, 25);
  });
});
