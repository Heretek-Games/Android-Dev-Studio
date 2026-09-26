import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { AnimFSM } from './AnimFSM.js';

const DT = 1 / 60;

function fsm(options?: Record<string, unknown>): AnimFSM {
  const scene = new Scene('Test');
  const go = new GameObject('Actor');
  const fsm = go.addComponent(new AnimFSM(options as never));
  scene.addGameObject(go);
  return fsm;
}

const STATES = {
  Idle: { clip: 'idle', clipLength: 2.0 },
  Run: { clip: 'run', clipLength: 1.0 },
  Attack: { clip: 'attack', clipLength: 0.5, loop: false }
};

describe('AnimFSM — states, transitions, triggers', () => {
  test('param condition transitions between states', () => {
    const f = fsm({
      states: STATES,
      initial: 'Idle',
      transitions: [{ from: 'Idle', to: 'Run', conditions: [{ param: 'speed', op: '>', value: 0.5 }] }]
    });
    assert.strictEqual(f.current, 'Idle');
    for (let i = 0; i < 30; i++) f.update(DT);
    assert.strictEqual(f.current, 'Idle');
    f.setFloat('speed', 3);
    f.update(DT);
    assert.strictEqual(f.current, 'Run');
    assert.strictEqual(f.transitionsTaken, 1);
    assert.deepStrictEqual(f.lastTransition, { from: 'Idle', to: 'Run' });
  });

  test('trigger fires a one-shot transition and is consumed', () => {
    const f = fsm({
      states: STATES,
      initial: 'Run',
      transitions: [
        { from: 'Run', to: 'Attack', conditions: [{ param: 'attack', op: 'trigger' }] },
        { from: 'Attack', to: 'Idle', exitTime: 1.0, conditions: [] }
      ]
    });
    f.setTrigger('attack');
    f.update(DT);
    assert.strictEqual(f.current, 'Attack');
    // Trigger consumed: no repeated firing, and exitTime gates the return.
    for (let i = 0; i < 20; i++) f.update(DT);
    assert.strictEqual(f.current, 'Attack');
    for (let i = 0; i < 20; i++) f.update(DT);
    assert.strictEqual(f.current, 'Idle');
  });

  test('wildcard transitions fire from any state', () => {
    const f = fsm({
      states: STATES,
      initial: 'Run',
      transitions: [{ from: '*', to: 'Idle', conditions: [{ param: 'stop', op: '==' , value: 1 }] }]
    });
    f.setFloat('stop', 1);
    f.update(DT);
    assert.strictEqual(f.current, 'Idle');
  });

  test('unknown target states never fire; one transition per update', () => {
    const f = fsm({
      states: { A: { clip: 'a' }, B: { clip: 'b' }, C: { clip: 'c' } },
      initial: 'A',
      transitions: [
        { from: 'A', to: 'Missing', conditions: [] },
        { from: 'A', to: 'B', conditions: [] },
        { from: 'A', to: 'C', conditions: [] }
      ]
    });
    f.update(DT);
    assert.strictEqual(f.current, 'B');
    assert.strictEqual(f.transitionsTaken, 1);
  });

  test('serializes state, params, and history', () => {
    const f = fsm({
      states: STATES,
      initial: 'Idle',
      params: { speed: 0 },
      transitions: [{ from: 'Idle', to: 'Run', conditions: [{ param: 'speed', op: '>', value: 0.5 }] }]
    });
    f.setFloat('speed', 5);
    f.update(DT);
    const json = f.toJSON();
    assert.strictEqual(json.type, 'AnimFSM');
    const other = new AnimFSM({ states: STATES });
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.current, 'Run');
    assert.strictEqual(other.getFloat('speed'), 5);
    assert.strictEqual(other.transitionsTaken, 1);
  });

  test('attack combo chains through a cancel window (Track E.1)', () => {
    const f = fsm({
      states: {
        Idle: { clip: 'idle', clipLength: 2.0 },
        Attack1: { clip: 'attack1', clipLength: 0.5, loop: false },
        Attack2: { clip: 'attack2', clipLength: 0.5, loop: false }
      },
      initial: 'Idle',
      transitions: [
        { from: 'Idle', to: 'Attack1', conditions: [{ param: 'attack', op: 'trigger' }] },
        // Cancel window: combo input during the last 60% of Attack1 chains.
        { from: 'Attack1', to: 'Attack2', exitTime: 0.4, conditions: [{ param: 'combo', op: 'trigger' }] },
        { from: 'Attack1', to: 'Idle', exitTime: 1.0, conditions: [] },
        { from: 'Attack2', to: 'Idle', exitTime: 1.0, conditions: [] }
      ]
    });
    f.setTrigger('attack');
    f.update(DT);
    assert.strictEqual(f.current, 'Attack1');
    // Too early: exitTime blocks the cancel.
    f.setTrigger('combo');
    f.update(DT);
    assert.strictEqual(f.current, 'Attack1');
    // Past the cancel window with a fresh trigger: chains into Attack2.
    for (let i = 0; i < 15; i++) f.update(DT);
    f.setTrigger('combo');
    f.update(DT);
    assert.strictEqual(f.current, 'Attack2');
    // Chain resolves back to Idle.
    for (let i = 0; i < 40; i++) f.update(DT);
    assert.strictEqual(f.current, 'Idle');
    assert.strictEqual(f.transitionsTaken, 3);
  });
});
