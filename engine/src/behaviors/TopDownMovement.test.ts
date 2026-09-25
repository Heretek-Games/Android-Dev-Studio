import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { TopDownMovement } from './TopDownMovement.js';

function walker(options?: Record<string, unknown>): { go: GameObject; move: TopDownMovement } {
  const go = new GameObject('Walker');
  const move = go.addComponent(
    new TopDownMovement({ moveSpeed: 4, ...(options as object) })
  );
  return { go, move };
}

describe('TopDownMovement behavior — directions, diagonals, rotation', () => {
  test('simulated input drives planar motion and heading', () => {
    const { go, move } = walker({ simulate: { x: 1, y: 0 } });
    move.update(0.5);
    assert.strictEqual(move.isMoving, true);
    assert.ok(go.transform.position.x > 1.5, `expected +X motion, got ${go.transform.position.x}`);
    assert.ok(Math.abs(go.transform.rotation.y - move.movementAngle) < 1e-9);
  });

  test('four-direction mode snaps to the dominant axis', () => {
    const { go, move } = walker({ simulate: { x: 0.9, y: 0.4 }, allowDiagonals: false });
    move.update(0.5);
    assert.ok(Math.abs(go.transform.position.x) > 1.5);
    assert.strictEqual(go.transform.position.z, 0);
  });

  test('eight-direction mode keeps both axes', () => {
    const { go } = walker({ simulate: { x: 1, y: 1 } });
    const move = go.getComponent(TopDownMovement);
    move?.update(0.5);
    assert.ok(go.transform.position.x > 1 && go.transform.position.z < -1);
  });

  test('rotation toggle leaves heading alone', () => {
    const { go, move } = walker({ simulate: { x: 1, y: 0 }, rotateToHeading: false });
    move.update(0.5);
    assert.ok(go.transform.position.x > 1.5);
    assert.strictEqual(go.transform.rotation.y, 0);
  });

  test('dead stick and zero speed stay put', () => {
    const { go, move } = walker({ simulate: { x: 0.01, y: 0 } });
    move.update(0.5);
    assert.strictEqual(move.isMoving, false);
    assert.strictEqual(go.transform.position.x, 0);

    const stopped = walker({ simulate: { x: 1, y: 0 }, moveSpeed: 0 });
    stopped.move.update(0.5);
    assert.strictEqual(stopped.move.isMoving, false);
  });

  test('serializes behavior tuning options', () => {
    const move = new TopDownMovement({ moveSpeed: 7, allowDiagonals: false });
    const json = move.toJSON();
    assert.strictEqual(json.type, 'TopDownMovement');
    assert.strictEqual(json.moveSpeed, 7);
    assert.strictEqual(json.allowDiagonals, false);

    const other = new TopDownMovement();
    other.fromJSON(json);
    assert.strictEqual(other.moveSpeed, 7);
    assert.strictEqual(other.allowDiagonals, false);
  });
});
