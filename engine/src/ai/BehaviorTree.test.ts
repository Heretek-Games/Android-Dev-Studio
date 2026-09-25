import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import {
  AttackNode,
  BTNode,
  BTStatus,
  BehaviorTreeComponent,
  DistanceCheckNode,
  InverterNode,
  MoveTowardsNode,
  SelectorNode,
  SequenceNode
} from './BehaviorTree.js';

class StubNode extends BTNode {
  constructor(private status: BTStatus) {
    super();
  }
  public override tick(): BTStatus {
    return this.status;
  }
}

describe('BehaviorTree — composite and leaf node semantics', () => {
  test('selector returns the first non-failure child', () => {
    const selector = new SelectorNode([
      new StubNode(BTStatus.FAILURE),
      new StubNode(BTStatus.RUNNING),
      new StubNode(BTStatus.SUCCESS)
    ]);
    assert.strictEqual(selector.tick(new GameObject('A'), 0.016), BTStatus.RUNNING);
    assert.strictEqual(new SelectorNode([new StubNode(BTStatus.FAILURE)]).tick(new GameObject('A'), 0.016), BTStatus.FAILURE);
  });

  test('sequence requires all children to succeed', () => {
    const passing = new SequenceNode([new StubNode(BTStatus.SUCCESS), new StubNode(BTStatus.SUCCESS)]);
    assert.strictEqual(passing.tick(new GameObject('A'), 0.016), BTStatus.SUCCESS);

    const blocked = new SequenceNode([new StubNode(BTStatus.SUCCESS), new StubNode(BTStatus.FAILURE)]);
    assert.strictEqual(blocked.tick(new GameObject('A'), 0.016), BTStatus.FAILURE);
  });

  test('inverter flips success and failure, preserves running', () => {
    assert.strictEqual(new InverterNode(new StubNode(BTStatus.SUCCESS)).tick(new GameObject('A'), 0.016), BTStatus.FAILURE);
    assert.strictEqual(new InverterNode(new StubNode(BTStatus.FAILURE)).tick(new GameObject('A'), 0.016), BTStatus.SUCCESS);
    assert.strictEqual(new InverterNode(new StubNode(BTStatus.RUNNING)).tick(new GameObject('A'), 0.016), BTStatus.RUNNING);
  });

  test('distance check evaluates proximity to a named target', () => {
    const scene = new Scene('BTS');
    const actor = new GameObject('Actor');
    const target = new GameObject('Target');
    target.transform.setPosition(5, 0, 0);
    scene.addGameObject(actor);
    scene.addGameObject(target);

    assert.strictEqual(new DistanceCheckNode('Target', 10, 'less').tick(actor, 0.016), BTStatus.SUCCESS);
    assert.strictEqual(new DistanceCheckNode('Target', 3, 'less').tick(actor, 0.016), BTStatus.FAILURE);
    assert.strictEqual(new DistanceCheckNode('Target', 3, 'greater').tick(actor, 0.016), BTStatus.SUCCESS);
    assert.strictEqual(new DistanceCheckNode('Missing', 100).tick(actor, 0.016), BTStatus.FAILURE);
  });

  test('move-towards walks the actor toward the target and stops at range', () => {
    const scene = new Scene('BTMove');
    const actor = new GameObject('Actor');
    const target = new GameObject('Target');
    target.transform.setPosition(0, 0, -10);
    scene.addGameObject(actor);
    scene.addGameObject(target);

    const move = new MoveTowardsNode('Target', 4, 1.5);
    const status = move.tick(actor, 0.5); // 2m step
    assert.strictEqual(status, BTStatus.RUNNING);
    assert.ok(Math.abs(actor.transform.position.z - -2) < 1e-6, `expected -2, got ${actor.transform.position.z}`);

    for (let i = 0; i < 10; i++) move.tick(actor, 0.5);
    assert.strictEqual(move.tick(actor, 0.5), BTStatus.SUCCESS, 'arrives and reports success');
  });

  test('BehaviorTreeComponent ticks its tree against the owning GameObject', () => {
    const scene = new Scene('BTComponent');
    const actor = new GameObject('Guard');
    const player = new GameObject('Player Hero');
    player.transform.setPosition(5, 0, 0);
    scene.addGameObject(actor);
    scene.addGameObject(player);

    // Default horde AI: player within 15m -> move towards (RUNNING), else FAILURE
    const component = actor.addComponent(new BehaviorTreeComponent());
    component.update(0.1);
    assert.strictEqual(component.lastStatus, BTStatus.RUNNING);
    assert.ok(actor.transform.position.z < 0 || actor.transform.position.x > 0, 'moved toward the player');

    player.transform.setPosition(100, 0, 0);
    component.update(0.1);
    assert.strictEqual(component.lastStatus, BTStatus.FAILURE);
  });
});

describe('AttackNode — range-gated, rate-limited attacks', () => {
  test('attacks when in range and respects the interval', () => {
    const scene = new Scene('AttackScene');
    const player = new GameObject('Player Hero');
    scene.addGameObject(player);

    const enemy = new GameObject('Enemy');
    enemy.transform.setPosition(2, 0, 0);
    scene.addGameObject(enemy);

    let attacks = 0;
    const node = new AttackNode('Player Hero', 3, () => attacks++, 1.0);

    assert.strictEqual(node.tick(enemy, 0.1), BTStatus.SUCCESS);
    assert.strictEqual(attacks, 1);
    assert.strictEqual(node.tick(enemy, 0.2), BTStatus.RUNNING, 'cooldown blocks');
    assert.strictEqual(attacks, 1);
    assert.strictEqual(node.tick(enemy, 1.0), BTStatus.SUCCESS, 'cooldown elapsed');
    assert.strictEqual(attacks, 2);
  });

  test('fails when the target is out of range or missing', () => {
    const scene = new Scene('AttackScene');
    const enemy = new GameObject('Enemy');
    scene.addGameObject(enemy);
    const node = new AttackNode('Player Hero', 3, () => {});

    assert.strictEqual(node.tick(enemy, 0.1), BTStatus.FAILURE, 'missing target');

    const player = new GameObject('Player Hero');
    player.transform.setPosition(50, 0, 0);
    scene.addGameObject(player);
    assert.strictEqual(node.tick(enemy, 0.1), BTStatus.FAILURE, 'out of range');
  });

  test('the attack callback receives actor and target', () => {
    const scene = new Scene('AttackScene');
    const player = new GameObject('Player Hero');
    scene.addGameObject(player);
    const enemy = new GameObject('Enemy');
    scene.addGameObject(enemy);

    const seen: string[] = [];
    const node = new AttackNode('Player Hero', 5, (actor, target) => seen.push(`${actor.name}->${target.name}`));
    node.tick(enemy, 0.1);
    assert.deepStrictEqual(seen, ['Enemy->Player Hero']);
  });
});
