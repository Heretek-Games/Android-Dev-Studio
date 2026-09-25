import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameObject } from './GameObject.js';
import { Component } from './Component.js';
import { Scene } from './Scene.js';

class LifecycleProbe extends Component {
  public awakeCount = 0;
  public startCount = 0;
  public updateCount = 0;
  public destroyCount = 0;

  public override awake(): void {
    this.awakeCount++;
  }
  public override start(): void {
    this.startCount++;
  }
  public override update(): void {
    this.updateCount++;
  }
  public override onDestroy(): void {
    this.destroyCount++;
  }
}

describe('GameObject — components, lifecycle, and identity', () => {
  test('addComponent awakes immediately and getComponent retrieves by class', () => {
    const go = new GameObject('Hero');
    const probe = go.addComponent(new LifecycleProbe());

    assert.strictEqual(probe.awakeCount, 1, 'awake runs on attach');
    assert.strictEqual(go.getComponent(LifecycleProbe), probe);
    assert.strictEqual(go.getComponent(Component as any), probe);
  });

  test('scene attach starts components; update ticks active objects only', () => {
    const scene = new Scene('LifecycleScene');
    const go = new GameObject('Actor');
    const probe = go.addComponent(new LifecycleProbe());
    scene.addGameObject(go);

    assert.strictEqual(probe.startCount, 1, 'start runs when added to a scene');
    go.update(0.016);
    assert.strictEqual(probe.updateCount, 1);

    go.active = false;
    go.update(0.016);
    assert.strictEqual(probe.updateCount, 1, 'inactive objects do not update');
  });

  test('destroy runs onDestroy and detaches from the scene', () => {
    const scene = new Scene('DestroyScene');
    const go = new GameObject('Temp');
    const probe = go.addComponent(new LifecycleProbe());
    scene.addGameObject(go);

    go.destroy();
    assert.strictEqual(probe.destroyCount, 1);
    assert.strictEqual(scene.gameObjects.length, 0);
    assert.strictEqual(scene.findByName('Temp'), null);
  });

  test('removeComponent detaches a component', () => {
    const go = new GameObject('Multi');
    const a = go.addComponent(new LifecycleProbe());
    const b = go.addComponent(new LifecycleProbe());
    assert.strictEqual(go.getComponents(LifecycleProbe).length, 2);

    go.removeComponent(a);
    assert.deepStrictEqual(go.getComponents(LifecycleProbe), [b]);
  });

  test('tags and layers filter through the scene', () => {
    const scene = new Scene('TagScene');
    const enemy = new GameObject('Enemy');
    enemy.tag = 'Hostile';
    scene.addGameObject(enemy);
    scene.addGameObject(new GameObject('Ally'));

    assert.strictEqual(scene.findByTag('Hostile').length, 1);
    assert.strictEqual(scene.findByTag('Hostile')[0].name, 'Enemy');
  });

  test('serialization captures identity and components', () => {
    const go = new GameObject('Serialized');
    go.transform.setPosition(1, 2, 3);
    go.addComponent(new LifecycleProbe());

    const json = go.toJSON();
    assert.strictEqual(json.name, 'Serialized');
    assert.deepStrictEqual(json.transform.position, [1, 2, 3]);
    assert.strictEqual(json.components[0].type, 'LifecycleProbe');
  });
});
