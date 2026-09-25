import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameShell } from './GameShell.js';
import { GameFlow } from '../game/GameFlow.js';
import { GameSession } from '../game/GameSession.js';

function makeShell(options: Record<string, unknown> = {}) {
  const flow = new GameFlow();
  const session = new GameSession(flow, { targetScore: 200, totalWaves: 2, scorePerKill: 100 });
  const shell = new GameShell({ flow, session, title: 'Test Arena', ...options });
  return { flow, session, shell };
}

describe('GameShell — overlay state and HUD (headless)', () => {
  test('starts on the menu overlay', () => {
    const { shell } = makeShell();
    const view = shell.getView();
    assert.strictEqual(view.overlay, 'menu');
    assert.strictEqual(view.title, 'Test Arena');
    assert.match(view.statusText, /Press Start/);
  });

  test('start button starts the flow and shows the HUD', () => {
    const calls: string[] = [];
    const { flow, shell } = makeShell({ onStart: () => calls.push('start') });
    shell.mount();
    assert.strictEqual(shell.handleButton('start'), true);
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.strictEqual(shell.getView().overlay, 'hud');
    assert.deepStrictEqual(calls, ['start']);
  });

  test('HUD reflects score, wave, kills, and elapsed time', () => {
    const { flow, session, shell } = makeShell();
    shell.mount();
    shell.handleButton('start');

    session.registerKill();
    session.update(1.5);
    const view = shell.getView();
    assert.strictEqual(view.score, 100);
    assert.strictEqual(view.kills, 1);
    assert.strictEqual(view.wave, 1);
    assert.ok(Math.abs(view.elapsedSeconds - 1.5) < 1e-9);
    assert.strictEqual(flow.getPhase(), 'playing');
  });

  test('pause/resume overlays and callbacks', () => {
    const calls: string[] = [];
    const { flow, shell } = makeShell({ onResume: () => calls.push('resume') });
    shell.mount();
    shell.handleButton('start');
    flow.transition('pause');
    assert.strictEqual(shell.getView().overlay, 'paused');
    assert.match(shell.getView().statusText, /Paused/);

    shell.handleButton('resume');
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.deepStrictEqual(calls, ['resume']);
  });

  test('win and lose overlays with restart and quit callbacks', () => {
    const calls: string[] = [];
    const { flow, session, shell } = makeShell({
      onRestart: () => calls.push('restart'),
      onQuit: () => calls.push('quit')
    });
    shell.mount();
    shell.handleButton('start');
    session.registerKill();
    session.registerKill();
    assert.strictEqual(flow.getPhase(), 'won');
    assert.strictEqual(shell.getView().overlay, 'won');
    assert.match(shell.getView().statusText, /Victory — 200 points/);

    shell.handleButton('restart');
    assert.strictEqual(flow.getPhase(), 'playing');
    assert.deepStrictEqual(calls, ['restart']);

    shell.handleButton('quit');
    assert.strictEqual(flow.getPhase(), 'menu');
    assert.deepStrictEqual(calls, ['restart', 'quit']);
  });

  test('lost overlay shows the defeat status', () => {
    const { flow, session, shell } = makeShell();
    shell.mount();
    shell.handleButton('start');
    session.playerDied();
    assert.strictEqual(flow.getPhase(), 'lost');
    assert.match(shell.getView().statusText, /Defeated/);
  });

  test('health fraction is clamped and reflects the provider', () => {
    const { shell } = makeShell({ getHealthFraction: () => 0.42 });
    assert.ok(Math.abs(shell.getView().healthFraction - 0.42) < 1e-9);

    const { shell: broken } = makeShell({ getHealthFraction: () => Number.NaN });
    assert.strictEqual(broken.getView().healthFraction, 0);
  });

  test('hasSave is surfaced for the Continue button', () => {
    const { shell } = makeShell({ hasSave: () => true });
    assert.strictEqual(shell.getView().hasSave, true);
  });

  test('save/load buttons invoke their callbacks without changing the phase', () => {
    const calls: string[] = [];
    const { flow, shell } = makeShell({ onSave: () => calls.push('save'), onLoad: () => calls.push('load') });
    shell.handleButton('start');
    assert.strictEqual(shell.handleButton('save'), true);
    assert.strictEqual(shell.handleButton('load'), true);
    assert.deepStrictEqual(calls, ['save', 'load']);
    assert.strictEqual(flow.getPhase(), 'playing');
  });

  test('destroy stops reacting to changes', () => {
    const { session, shell } = makeShell();
    shell.mount();
    shell.handleButton('start');
    shell.destroy();
    assert.strictEqual(shell.isDestroyed(), true);
    const before = shell.getView().score;
    session.registerKill();
    assert.strictEqual(shell.getView().score, before + 100, 'getView still computes; no listeners required');
    assert.strictEqual(shell.handleButton('restart'), false, 'destroyed shell ignores buttons');
  });
});
