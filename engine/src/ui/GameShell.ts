/**
 * GameShell — DOM overlay shell for a playable game: menu, HUD, pause, and
 * win/lose screens with restart.
 *
 * The shell computes a `ShellView` state on every flow/session change and applies
 * it to DOM elements when a document is available; headless runs (tests, QA) keep
 * the same view state without touching the DOM.
 */

import type { GameFlow, GamePhase } from '../game/GameFlow.js';
import type { GameSession } from '../game/GameSession.js';

export type ShellOverlay = 'menu' | 'hud' | 'paused' | 'won' | 'lost';

export interface ShellView {
  overlay: ShellOverlay;
  title: string;
  score: number;
  wave: number;
  kills: number;
  elapsedSeconds: number;
  healthFraction: number;
  hasSave: boolean;
  statusText: string;
}

export interface GameShellOptions {
  flow: GameFlow;
  session: GameSession;
  title?: string;
  /** Element to mount into (defaults to document.body when available). */
  root?: HTMLElement;
  /** Live player health provider (0..1); defaults to a constant 1. */
  getHealthFraction?: () => number;
  /** Whether a save slot exists (enables the Continue button). */
  hasSave?: () => boolean;
  onStart?: () => void;
  onRestart?: () => void;
  onQuit?: () => void;
  onResume?: () => void;
  onSave?: () => void;
  onLoad?: () => void;
}

const OVERLAY_FOR_PHASE: Record<GamePhase, ShellOverlay> = {
  menu: 'menu',
  playing: 'hud',
  paused: 'paused',
  won: 'won',
  lost: 'lost'
};

export class GameShell {
  public readonly title: string;

  private readonly flow: GameFlow;
  private readonly session: GameSession;
  private readonly options: GameShellOptions;
  private readonly unsubscribe: Array<() => void> = [];
  private mounted = false;
  private destroyed = false;
  private elements: Record<string, HTMLElement> = {};

  constructor(options: GameShellOptions) {
    this.options = options;
    this.flow = options.flow;
    this.session = options.session;
    this.title = options.title ?? 'Heretek Arena';
  }

  /** Current view state (always available, DOM or not). */
  public getView(): ShellView {
    const phase = this.flow.getPhase();
    const overlay = OVERLAY_FOR_PHASE[phase];
    return {
      overlay,
      title: this.title,
      score: this.session.getScore(),
      wave: this.session.getWave(),
      kills: this.session.getKills(),
      elapsedSeconds: this.session.getElapsedSeconds(),
      healthFraction: clamp01(this.options.getHealthFraction?.() ?? 1),
      hasSave: this.options.hasSave?.() ?? false,
      statusText: statusTextFor(overlay, this.session)
    };
  }

  /** Attach to the DOM (when available) and start reacting to flow/session changes. */
  public mount(): void {
    if (this.mounted || this.destroyed) return;
    this.mounted = true;

    const doc = (globalThis as unknown as { document?: Document }).document;
    const root = this.options.root ?? doc?.body ?? null;
    if (doc && root) {
      this.elements = buildDom(doc, root, this);
      applyView(doc, this.elements, this.getView(), this);
    }

    this.unsubscribe.push(this.flow.onPhaseChange(() => this.refresh()));
    this.unsubscribe.push(this.session.onChange(() => this.refresh()));
    this.refresh();
  }

  /** Refresh the DOM (or just recompute the view state headlessly). */
  public refresh(): void {
    if (this.destroyed) return;
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (doc && this.elements.root) {
      applyView(doc, this.elements, this.getView(), this);
    }
  }

  /** Called from the game loop; refreshes the HUD. */
  public update(_deltaTime: number): void {
    if (this.flow.getPhase() === 'playing') this.refresh();
  }

  public destroy(): void {
    this.destroyed = true;
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    const root = this.elements.root;
    if (root?.parentElement) root.parentElement.removeChild(root);
    this.elements = {};
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  // ------------------------------------------------------------------ buttons
  public handleButton(action: 'start' | 'pause' | 'resume' | 'restart' | 'quit' | 'save' | 'load'): boolean {
    if (this.destroyed) return false;
    switch (action) {
      case 'start':
        this.options.onStart?.();
        return this.flow.transition('start');
      case 'pause':
        return this.flow.transition('pause');
      case 'resume':
        this.options.onResume?.();
        return this.flow.transition('resume');
      case 'restart':
        this.options.onRestart?.();
        return this.flow.isOver() ? this.flow.transition('restart') : this.flow.transition('start');
      case 'quit':
        this.options.onQuit?.();
        return this.flow.transition('quit');
      case 'save':
        this.options.onSave?.();
        return true;
      case 'load':
        this.options.onLoad?.();
        return true;
    }
  }
}

function statusTextFor(overlay: ShellOverlay, session: GameSession): string {
  switch (overlay) {
    case 'menu':
      return 'Press Start to play';
    case 'paused':
      return 'Paused';
    case 'won':
      return `Victory — ${session.getScore()} points`;
    case 'lost':
      return `Defeated — ${session.getScore()} points`;
    default:
      return '';
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// --------------------------------------------------------------------- DOM layer
function buildDom(doc: Document, root: HTMLElement, shell: GameShell): Record<string, HTMLElement> {
  const container = doc.createElement('div');
  container.setAttribute('data-heretek-shell', 'true');
  container.style.cssText =
    'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#f4f4f5;z-index:50;';

  const overlay = doc.createElement('div');
  overlay.setAttribute('data-shell-overlay', 'true');
  overlay.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(9,9,12,0.82);pointer-events:auto;text-align:center;';

  const title = doc.createElement('h1');
  title.style.cssText = 'margin:0;font-size:34px;letter-spacing:0.5px;';
  const status = doc.createElement('div');
  status.style.cssText = 'font-size:16px;color:#a1a1aa;';
  const stats = doc.createElement('div');
  stats.style.cssText = 'font-size:14px;color:#d4d4d8;display:flex;gap:18px;';

  const buttons = doc.createElement('div');
  buttons.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
  const makeButton = (label: string, action: Parameters<GameShell['handleButton']>[0]) => {
    const button = doc.createElement('button');
    button.textContent = label;
    button.style.cssText =
      'pointer-events:auto;padding:10px 22px;border-radius:8px;border:1px solid #3f3f46;background:#2563eb;color:#fff;font-size:15px;cursor:pointer;';
    button.addEventListener('click', () => shell.handleButton(action));
    return button;
  };
  const startButton = makeButton('Start', 'start');
  const continueButton = makeButton('Continue', 'load');
  const resumeButton = makeButton('Resume', 'resume');
  const saveButton = makeButton('Save', 'save');
  const restartButton = makeButton('Restart', 'restart');
  const quitButton = makeButton('Menu', 'quit');
  buttons.append(startButton, continueButton, resumeButton, saveButton, restartButton, quitButton);
  overlay.append(title, status, stats, buttons);

  const hud = doc.createElement('div');
  hud.setAttribute('data-shell-hud', 'true');
  hud.style.cssText =
    'position:absolute;top:12px;left:0;right:0;display:flex;justify-content:center;gap:24px;font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;';
  const hudScore = doc.createElement('span');
  const hudWave = doc.createElement('span');
  const hudKills = doc.createElement('span');
  const hudTime = doc.createElement('span');
  const pauseButton = doc.createElement('button');
  pauseButton.textContent = '⏸ Pause';
  pauseButton.style.cssText =
    'pointer-events:auto;position:absolute;right:14px;top:-4px;padding:6px 14px;border-radius:8px;border:1px solid #3f3f46;background:rgba(24,24,27,0.85);color:#e4e4e7;font-size:13px;cursor:pointer;';
  pauseButton.addEventListener('click', () => shell.handleButton('pause'));
  hud.append(hudScore, hudWave, hudKills, hudTime, pauseButton);

  const healthBar = doc.createElement('div');
  healthBar.style.cssText =
    'position:absolute;left:16px;bottom:16px;width:220px;height:14px;border-radius:7px;border:1px solid #52525b;background:rgba(24,24,27,0.8);overflow:hidden;';
  const healthFill = doc.createElement('div');
  healthFill.style.cssText = 'height:100%;width:100%;background:#22c55e;transition:width 120ms linear;';
  healthBar.append(healthFill);

  container.append(overlay, hud, healthBar);
  root.append(container);

  return {
    root: container,
    overlay,
    title,
    status,
    stats,
    buttons,
    startButton,
    continueButton,
    resumeButton,
    saveButton,
    restartButton,
    quitButton,
    hud,
    hudScore,
    hudWave,
    hudKills,
    hudTime,
    pauseButton,
    healthBar,
    healthFill
  };
}

function applyView(doc: Document, elements: Record<string, HTMLElement>, view: ShellView, _shell: GameShell): void {
  if (!elements.root) return;
  const showOverlay = view.overlay !== 'hud';
  elements.overlay.style.display = showOverlay ? 'flex' : 'none';
  elements.hud.style.display = showOverlay ? 'none' : 'flex';
  elements.healthBar.style.display = showOverlay ? 'none' : 'block';

  elements.title.textContent = view.title;
  elements.status.textContent = view.statusText;
  elements.stats.textContent =
    view.overlay === 'menu'
      ? ''
      : `Score ${view.score} · Wave ${view.wave} · Kills ${view.kills} · ${view.elapsedSeconds.toFixed(1)}s`;

  const show = (element: HTMLElement | undefined, visible: boolean) => {
    if (element) element.style.display = visible ? 'inline-block' : 'none';
  };
  show(elements.startButton, view.overlay === 'menu');
  show(elements.continueButton, view.overlay === 'menu' && view.hasSave);
  show(elements.resumeButton, view.overlay === 'paused');
  show(elements.saveButton, view.overlay === 'paused');
  show(elements.restartButton, view.overlay === 'won' || view.overlay === 'lost');
  show(elements.quitButton, view.overlay !== 'menu');

  show(elements.pauseButton, view.overlay === 'hud');
  elements.hudScore.textContent = `Score ${view.score}`;
  elements.hudWave.textContent = `Wave ${view.wave}`;
  elements.hudKills.textContent = `Kills ${view.kills}`;
  elements.hudTime.textContent = `${view.elapsedSeconds.toFixed(1)}s`;
  elements.healthFill.style.width = `${Math.round(view.healthFraction * 100)}%`;
  elements.healthFill.style.background = view.healthFraction > 0.5 ? '#22c55e' : view.healthFraction > 0.2 ? '#eab308' : '#ef4444';
}
