import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameShell } from './GameShell.js';
import { LocalizationService } from './Localization.js';
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

describe('GameShell — localization binding (headless)', () => {
  const TABLES = {
    en: {
      'shell.button.start': 'Start',
      'shell.hud.score': 'Score',
      'shell.status.won': 'Victory — {score}'
    },
    es: {
      'shell.button.start': 'Comenzar',
      'shell.hud.score': 'Puntos',
      'shell.status.won': 'Victoria — {score}'
    }
  };

  test('labels resolve through the bound service with English defaults', () => {
    const svc = new LocalizationService(TABLES, 'es');
    const { shell, flow } = makeShell({ localization: svc });
    assert.strictEqual(shell.localize('shell.button.start', 'Start'), 'Comenzar');
    assert.strictEqual(shell.getView().scoreLabel, 'Puntos');
    flow.transition('start');
    assert.strictEqual(shell.getView().overlay, 'hud');
    shell.setLocale('en');
    assert.strictEqual(shell.getView().scoreLabel, 'Score');
    assert.strictEqual(svc.getLocale(), 'en');
  });

  test('missing keys fall back to English defaults and record misses', () => {
    const svc = new LocalizationService({ es: { 'shell.button.start': 'Comenzar' } }, 'es');
    const { shell } = makeShell({ localization: svc });
    // shell.hud.score has no ES entry and no EN table: English default wins.
    assert.strictEqual(shell.getView().scoreLabel, 'Score');
    // getView also resolves the menu status + score unit: all three miss.
    assert.deepStrictEqual(svc.missingKeys(), [
      'shell.hud.score',
      'shell.score.unit',
      'shell.status.menu'
    ]);
  });

  test('unbound shells render identical English (no behavior change)', () => {
    const { shell } = makeShell();
    assert.strictEqual(shell.localize('shell.button.start', 'Start'), 'Start');
    assert.strictEqual(shell.getView().scoreLabel, 'Score');
    assert.match(shell.getView().statusText, /Press Start/);
  });
});

describe('GameShell — theme tokens (headless)', () => {
  test('default theme preserves the pre-theme look', () => {
    const { shell } = makeShell();
    assert.deepStrictEqual(shell.getTheme(), {
      palette: {
        bg: '#09090c',
        surface: '#18181b',
        accent: '#2563eb',
        text: '#f4f4f5',
        muted: '#a1a1aa',
        success: '#22c55e',
        danger: '#f87171'
      },
      typography: { family: 'sans', basePx: 15, titlePx: 34 },
      radius: 8
    });
  });

  test('partial themes merge over the default', () => {
    const { shell } = makeShell({ theme: { palette: { accent: '#d4a24e' } } });
    const resolved = shell.getTheme();
    assert.strictEqual(resolved.palette.accent, '#d4a24e');
    assert.strictEqual(resolved.palette.text, '#f4f4f5');
    assert.strictEqual(resolved.typography.family, 'sans');
  });

  test('invalid values fall back per-field and never throw', () => {
    const { shell } = makeShell({
      theme: {
        palette: { accent: 'not-a-color', text: '#zzz' },
        typography: { family: 'comic', basePx: -3, titlePx: NaN },
        radius: -1
      }
    });
    const resolved = shell.getTheme();
    assert.strictEqual(resolved.palette.accent, '#2563eb');
    assert.strictEqual(resolved.palette.text, '#f4f4f5');
    assert.strictEqual(resolved.typography.family, 'sans');
    assert.strictEqual(resolved.typography.basePx, 15);
    assert.strictEqual(resolved.radius, 8);
  });

  test('setTheme switches at runtime; clearing restores the default', () => {
    const { shell } = makeShell();
    shell.setTheme({ palette: { accent: '#22d3ee' }, typography: { family: 'mono' }, radius: 6 });
    assert.strictEqual(shell.getTheme().palette.accent, '#22d3ee');
    assert.strictEqual(shell.getTheme().typography.family, 'mono');
    shell.setTheme(undefined);
    assert.strictEqual(shell.getTheme().palette.accent, '#2563eb');
  });

  test('harness fantasy tokens resolve through the shell', () => {
    const { shell } = makeShell({
      theme: {
        palette: { bg: '#14101c', surface: '#241d33', accent: '#d4a24e', text: '#f3e9d2' },
        typography: { family: 'serif', basePx: 16, titlePx: 28 },
        radius: 12
      }
    });
    const resolved = shell.getTheme();
    assert.strictEqual(resolved.palette.accent, '#d4a24e');
    assert.strictEqual(resolved.typography.family, 'serif');
    assert.strictEqual(resolved.typography.titlePx, 28);
    assert.strictEqual(resolved.radius, 12);
  });
});
