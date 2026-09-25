import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameFlow } from './GameFlow.js';
import { GameSession } from './GameSession.js';

function started(config = {}) {
  const flow = new GameFlow();
  const session = new GameSession(flow, config);
  session.start();
  return { flow, session };
}

describe('GameSession — counters, win/lose conditions, snapshots', () => {
  test('start resets counters and enters playing', () => {
    const { flow, session } = started();
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.strictEqual(session.getScore(), 0);
    assert.strictEqual(session.getWave(), 1);
    assert.strictEqual(session.getKills(), 0);
  });

  test('counters only advance while playing', () => {
    const { flow, session } = started();
    session.registerKill();
    assert.strictEqual(session.getScore(), 100);

    flow.transition('pause');
    session.registerKill();
    session.addScore(50);
    session.update(1);
    assert.strictEqual(session.getScore(), 100, 'paused: no score');
    assert.strictEqual(session.getElapsedSeconds(), 0, 'paused: timer frozen');

    flow.transition('resume');
    session.update(0.5);
    assert.strictEqual(session.getElapsedSeconds(), 0.5);
  });

  test('kills award scorePerKill and targetScore wins', () => {
    const { flow, session } = started({ targetScore: 250, scorePerKill: 100 });
    session.registerKill();
    session.registerKill();
    assert.strictEqual(flow.getPhase(), 'playing');
    session.registerKill();
    assert.strictEqual(flow.getPhase(), 'won');
    assert.strictEqual(session.getKills(), 3);
  });

  test('addScore wins when the target is reached', () => {
    const { flow, session } = started({ targetScore: 10 });
    session.addScore(5);
    assert.strictEqual(flow.getPhase(), 'playing');
    session.addScore(5);
    assert.strictEqual(flow.getPhase(), 'won');
  });

  test('completeWave increments; clearing totalWaves wins', () => {
    const { flow, session } = started({ totalWaves: 3 });
    session.completeWave();
    assert.strictEqual(session.getWave(), 2);
    session.completeWave();
    assert.strictEqual(session.getWave(), 3);
    session.completeWave();
    assert.strictEqual(flow.getPhase(), 'won', 'cleared all waves');
  });

  test('time limit loses the game', () => {
    const { flow, session } = started({ timeLimitSeconds: 2 });
    session.update(1.5);
    assert.strictEqual(flow.getPhase(), 'playing');
    session.update(0.6);
    assert.strictEqual(flow.getPhase(), 'lost');
  });

  test('playerDied loses only while playing', () => {
    const { flow, session } = started();
    flow.transition('pause');
    session.playerDied();
    assert.strictEqual(flow.getPhase(), 'paused', 'paused: death is ignored');
    flow.transition('resume');
    session.playerDied();
    assert.strictEqual(flow.getPhase(), 'lost');
  });

  test('restart from won resets counters', () => {
    const { flow, session } = started({ targetScore: 10 });
    session.addScore(10);
    assert.strictEqual(flow.getPhase(), 'won');
    session.start();
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.strictEqual(session.getScore(), 0);
    assert.strictEqual(session.getWave(), 1);
  });

  test('snapshot/restore round-trips counters with clamping', () => {
    const { session } = started();
    session.addScore(120);
    session.registerKill();
    session.update(0.25);
    const snapshot = session.snapshot();
    assert.strictEqual(snapshot.score, 220);
    assert.strictEqual(snapshot.kills, 1);

    const other = started().session;
    other.restore(snapshot);
    assert.strictEqual(other.getScore(), 220);
    assert.strictEqual(other.getKills(), 1);
    assert.ok(Math.abs(other.getElapsedSeconds() - 0.25) < 1e-9);

    other.restore({ score: -5, wave: 0, kills: -1, elapsedSeconds: -2, phase: 'playing' });
    assert.strictEqual(other.getScore(), 0);
    assert.strictEqual(other.getWave(), 1);
    assert.strictEqual(other.getKills(), 0);
    assert.strictEqual(other.getElapsedSeconds(), 0);
  });

  test('onChange fires on counter changes with unsubscribe', () => {
    const { session } = started();
    let updates = 0;
    const off = session.onChange(() => updates++);
    session.registerKill();
    session.addScore(10);
    session.update(0.1);
    assert.ok(updates >= 3);
    off();
    const before = updates;
    session.registerKill();
    assert.strictEqual(updates, before);
  });
});

describe('GameSession — syncScore mirror', () => {
  test('mirrors external values both directions without triggering a score win', () => {
    const { flow, session } = started({ targetScore: 10 });
    session.syncScore(4);
    assert.strictEqual(session.getScore(), 4);
    session.syncScore(2);
    assert.strictEqual(session.getScore(), 2);
    assert.strictEqual(flow.getPhase(), 'playing');

    session.syncScore(100);
    assert.strictEqual(session.getScore(), 100);
    assert.strictEqual(flow.getPhase(), 'playing', 'syncScore never wins on its own');
  });

  test('clamps negatives and ignores non-finite values', () => {
    const { session } = started();
    session.syncScore(-5);
    assert.strictEqual(session.getScore(), 0);
    session.syncScore(Number.NaN);
    assert.strictEqual(session.getScore(), 0);
  });
});
