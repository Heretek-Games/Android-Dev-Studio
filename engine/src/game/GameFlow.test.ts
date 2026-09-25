import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameFlow } from './GameFlow.js';

describe('GameFlow — phase state machine', () => {
  test('starts in menu', () => {
    const flow = new GameFlow();
    assert.strictEqual(flow.getPhase(), 'menu');
    assert.strictEqual(flow.isPlaying(), false);
    assert.strictEqual(flow.isOver(), false);
  });

  test('menu → playing → paused → playing', () => {
    const flow = new GameFlow();
    assert.strictEqual(flow.transition('start'), true);
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.strictEqual(flow.transition('pause'), true);
    assert.strictEqual(flow.getPhase(), 'paused');
    assert.strictEqual(flow.transition('resume'), true);
    assert.strictEqual(flow.getPhase(), 'playing');
  });

  test('win and lose end the game; restart returns to playing', () => {
    const won = new GameFlow();
    won.transition('start');
    assert.strictEqual(won.transition('win'), true);
    assert.strictEqual(won.isOver(), true);
    assert.strictEqual(won.transition('restart'), true);
    assert.strictEqual(won.getPhase(), 'playing');

    const lost = new GameFlow();
    lost.transition('start');
    assert.strictEqual(lost.transition('lose'), true);
    assert.strictEqual(lost.getPhase(), 'lost');
    assert.strictEqual(lost.transition('restart'), true);
    assert.strictEqual(lost.getPhase(), 'playing');
  });

  test('quit returns to menu from paused/won/lost', () => {
    for (const path of [
      ['start', 'pause'],
      ['start', 'win'],
      ['start', 'lose']
    ] as const) {
      const flow = new GameFlow();
      for (const event of path) flow.transition(event);
      assert.strictEqual(flow.transition('quit'), true);
      assert.strictEqual(flow.getPhase(), 'menu');
    }
  });

  test('invalid transitions are rejected with a reason', () => {
    const flow = new GameFlow();
    assert.strictEqual(flow.canTransition('win'), false);
    assert.strictEqual(flow.transition('win'), false);
    assert.strictEqual(flow.getPhase(), 'menu');
    assert.match(flow.getLastRejection() ?? '', /not valid in phase "menu"/);

    flow.transition('start');
    assert.strictEqual(flow.transition('start'), false, 'cannot start twice');
    assert.strictEqual(flow.getLastRejection() === null, false);
  });

  test('phase and event listeners fire with unsubscribe', () => {
    const flow = new GameFlow();
    const phases: string[] = [];
    const events: string[] = [];
    const offPhase = flow.onPhaseChange((change) => phases.push(`${change.from}->${change.to}:${change.event}`));
    const offEvent = flow.onEvent((event, phase) => events.push(`${event}@${phase}`));

    flow.transition('start');
    flow.transition('win');
    assert.deepStrictEqual(phases, ['menu->playing:start', 'playing->won:win']);
    assert.deepStrictEqual(events, ['start@playing', 'win@won']);

    offPhase();
    offEvent();
    flow.transition('restart');
    assert.strictEqual(phases.length, 2);
    assert.strictEqual(events.length, 2);
  });

  test('reset returns to menu and clears the rejection', () => {
    const flow = new GameFlow();
    flow.transition('win');
    assert.ok(flow.getLastRejection());
    flow.reset();
    assert.strictEqual(flow.getPhase(), 'menu');
    assert.strictEqual(flow.getLastRejection(), null);
  });
});
