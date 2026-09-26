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
import type { LocalizationService } from './Localization.js';

export type ShellOverlay = 'menu' | 'hud' | 'paused' | 'won' | 'lost';

export interface ShellView {
  overlay: ShellOverlay;
  title: string;
  score: number;
  /** Unit suffix appended to the score in the HUD (e.g. 'm' for distance runs). */
  scoreSuffix: string;
  /** HUD labels; games can rename or hide the wave/kill counters. */
  scoreLabel: string;
  showWave: boolean;
  showKills: boolean;
  showHealth: boolean;
  wave: number;
  kills: number;
  elapsedSeconds: number;
  healthFraction: number;
  hasSave: boolean;
  statusText: string;
}

export interface ShellHudConfig {
  scoreLabel?: string;
  scoreSuffix?: string;
  showWave?: boolean;
  showKills?: boolean;
  /** Hide the health bar for games without health (e.g. driving). */
  showHealth?: boolean;
}

/** Data-driven shell theme (Track A.3 Phase 2): mirrors the harness genre
 * token tables (`harness/loop/ui_themes.py`) so the loop picks `theme` instead
 * of inventing raw colors. Partial themes merge over the default; unknown
 * values fall back per-field and never throw. */
export interface ShellThemePalette {
  bg?: string;
  surface?: string;
  accent?: string;
  text?: string;
  muted?: string;
  success?: string;
  danger?: string;
}

export interface ShellTheme {
  palette?: ShellThemePalette;
  typography?: {
    family?: 'serif' | 'sans' | 'mono';
    basePx?: number;
    titlePx?: number;
  };
  /** Corner radius in px for buttons and bars. */
  radius?: number;
}

/** The pre-theme look, preserved exactly: existing games see zero change
 * unless they opt into a theme. */
export const DEFAULT_SHELL_THEME: {
  palette: Required<ShellThemePalette>;
  typography: { family: 'serif' | 'sans' | 'mono'; basePx: number; titlePx: number };
  radius: number;
} = {
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
};

const FONT_STACK: Record<string, string> = {
  serif: 'Georgia,"Times New Roman",serif',
  sans: 'system-ui,sans-serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,monospace'
};

/** Resolves any partial theme over the default (pure: unit-testable headless). */
export function resolveShellTheme(theme?: ShellTheme): typeof DEFAULT_SHELL_THEME {
  const palette = { ...DEFAULT_SHELL_THEME.palette, ...(theme?.palette ?? {}) };
  for (const key of Object.keys(palette) as Array<keyof ShellThemePalette>) {
    const value = palette[key];
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) {
      palette[key] = DEFAULT_SHELL_THEME.palette[key];
    }
  }
  const family = theme?.typography?.family;
  const basePx = theme?.typography?.basePx;
  const titlePx = theme?.typography?.titlePx;
  const radius = theme?.radius;
  return {
    palette,
    typography: {
      family: family === 'serif' || family === 'sans' || family === 'mono'
        ? family
        : DEFAULT_SHELL_THEME.typography.family,
      basePx: Number.isFinite(basePx) && (basePx as number) > 0
        ? (basePx as number)
        : DEFAULT_SHELL_THEME.typography.basePx,
      titlePx: Number.isFinite(titlePx) && (titlePx as number) > 0
        ? (titlePx as number)
        : DEFAULT_SHELL_THEME.typography.titlePx
    },
    radius: Number.isFinite(radius) && (radius as number) >= 0
      ? (radius as number)
      : DEFAULT_SHELL_THEME.radius
  };
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
  /** HUD presentation overrides (e.g. distance runs hide wave/kills). */
  hud?: ShellHudConfig;
  /** Visual theme tokens (Track A.3): partial themes merge over the default. */
  theme?: ShellTheme;
  /** Optional key-based labels (Track 1.8); English defaults when absent. */
  localization?: LocalizationService;
}

/** English defaults for every shell label key (also the fallback table). */
export const SHELL_DEFAULT_EN: Record<string, string> = {
  'shell.button.start': 'Start',
  'shell.button.continue': 'Continue',
  'shell.button.resume': 'Resume',
  'shell.button.save': 'Save',
  'shell.button.restart': 'Restart',
  'shell.button.menu': 'Menu',
  'shell.button.pause': '⏸ Pause',
  'shell.hud.score': 'Score',
  'shell.hud.wave': 'Wave',
  'shell.hud.kills': 'Kills',
  'shell.status.menu': 'Press Start to play',
  'shell.status.paused': 'Paused',
  'shell.status.won': 'Victory — {score}',
  'shell.status.lost': 'Defeated — {score}',
  'shell.score.unit': ' points'
};

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

  /** Resolved theme (default merged with any option theme). */
  public getTheme(): typeof DEFAULT_SHELL_THEME {
    return resolveShellTheme(this.options.theme);
  }

  /** Switches the theme at runtime and repaints (validated merge, never throws). */
  public setTheme(theme?: ShellTheme): void {
    this.options.theme = theme;
    this.refresh();
  }

  /** Current view state (always available, DOM or not). */
  public getView(): ShellView {
    const phase = this.flow.getPhase();
    const overlay = OVERLAY_FOR_PHASE[phase];
    const hud = this.options.hud ?? {};
    return {
      overlay,
      title: this.title,
      score: this.session.getScore(),
      scoreSuffix: hud.scoreSuffix ?? '',
      scoreLabel: hud.scoreLabel ?? this.localize('shell.hud.score', 'Score'),
      showWave: hud.showWave ?? true,
      showKills: hud.showKills ?? true,
      showHealth: hud.showHealth ?? true,
      wave: this.session.getWave(),
      kills: this.session.getKills(),
      elapsedSeconds: this.session.getElapsedSeconds(),
      healthFraction: clamp01(this.options.getHealthFraction?.() ?? 1),
      hasSave: this.options.hasSave?.() ?? false,
      statusText: statusTextFor(overlay, this.session, hud, (k, f, v) => this.localize(k, f, v))
    };
  }

  /** Resolves a shell label key (English default when no service is bound). */
  public localize(key: string, fallback?: string, vars?: Record<string, unknown>): string {
    const tableFallback = fallback ?? SHELL_DEFAULT_EN[key] ?? key;
    const svc = this.options.localization;
    if (!svc) return substituteVars(tableFallback, vars);
    const resolved = svc.t(key, vars);
    if (resolved === key) return substituteVars(tableFallback, vars);
    return resolved;
  }

  /** Switches the bound service locale and refreshes (no-op without a service). */
  public setLocale(locale: string): void {
    this.options.localization?.setLocale(locale);
    this.refresh();
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

function statusTextFor(
  overlay: ShellOverlay,
  session: GameSession,
  hud: ShellHudConfig,
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string
): string {
  const score = `${session.getScore().toFixed(hud.scoreSuffix ? 1 : 0)}${hud.scoreSuffix ?? t('shell.score.unit', ' points')}`;
  switch (overlay) {
    case 'menu':
      return t('shell.status.menu', 'Press Start to play');
    case 'paused':
      return t('shell.status.paused', 'Paused');
    case 'won':
      return t('shell.status.won', 'Victory — {score}', { score });
    case 'lost':
      return t('shell.status.lost', 'Defeated — {score}', { score });
    default:
      return '';
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Minimal {var} substitution for the service-less path (mirrors the service). */
function substituteVars(template: string, vars?: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = vars?.[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// --------------------------------------------------------------------- DOM layer
/** #rrggbb + alpha → rgba() (theme overlay washes need translucency). */
function hexToRgba(hex: string, alpha: number): string {
  let digits = hex.replace('#', '');
  if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
  const value = parseInt(digits, 16);
  if (!Number.isFinite(value)) return `rgba(9,9,12,${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildDom(doc: Document, root: HTMLElement, shell: GameShell): Record<string, HTMLElement> {
  const theme = shell.getTheme();
  const font = FONT_STACK[theme.typography.family];
  const container = doc.createElement('div');
  container.setAttribute('data-heretek-shell', 'true');
  container.style.cssText =
    `position:absolute;inset:0;pointer-events:none;font-family:${font};color:${theme.palette.text};z-index:50;`;

  const overlay = doc.createElement('div');
  overlay.setAttribute('data-shell-overlay', 'true');
  overlay.style.cssText =
    `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:${hexToRgba(theme.palette.bg, 0.82)};pointer-events:auto;text-align:center;`;

  const title = doc.createElement('h1');
  title.style.cssText = `margin:0;font-size:${theme.typography.titlePx}px;letter-spacing:0.5px;`;
  const status = doc.createElement('div');
  status.style.cssText = `font-size:${theme.typography.basePx}px;color:${theme.palette.muted};`;
  const stats = doc.createElement('div');
  stats.style.cssText = `font-size:${theme.typography.basePx - 1}px;color:${theme.palette.text};display:flex;gap:18px;`;

  const buttons = doc.createElement('div');
  buttons.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
  const makeButton = (
    labelKey: string,
    fallback: string,
    action: Parameters<GameShell['handleButton']>[0]
  ) => {
    const button = doc.createElement('button');
    button.textContent = shell.localize(labelKey, fallback);
    button.setAttribute('data-shell-label', labelKey);
    button.setAttribute('data-shell-fallback', fallback);
    button.style.cssText =
      `pointer-events:auto;padding:10px 22px;border-radius:${theme.radius}px;border:1px solid #3f3f46;background:${theme.palette.accent};color:#fff;font-size:${theme.typography.basePx}px;cursor:pointer;`;
    button.addEventListener('click', () => shell.handleButton(action));
    return button;
  };
  const startButton = makeButton('shell.button.start', 'Start', 'start');
  const continueButton = makeButton('shell.button.continue', 'Continue', 'load');
  const resumeButton = makeButton('shell.button.resume', 'Resume', 'resume');
  const saveButton = makeButton('shell.button.save', 'Save', 'save');
  const restartButton = makeButton('shell.button.restart', 'Restart', 'restart');
  const quitButton = makeButton('shell.button.menu', 'Menu', 'quit');
  buttons.append(startButton, continueButton, resumeButton, saveButton, restartButton, quitButton);
  overlay.append(title, status, stats, buttons);

  const hud = doc.createElement('div');
  hud.setAttribute('data-shell-hud', 'true');
  hud.style.cssText =
    `position:absolute;top:12px;left:0;right:0;display:flex;justify-content:center;gap:24px;font-size:${theme.typography.basePx}px;text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none;`;
  const hudScore = doc.createElement('span');
  const hudWave = doc.createElement('span');
  const hudKills = doc.createElement('span');
  const hudTime = doc.createElement('span');
  const pauseButton = doc.createElement('button');
  pauseButton.textContent = shell.localize('shell.button.pause', '⏸ Pause');
  pauseButton.setAttribute('data-shell-label', 'shell.button.pause');
  pauseButton.setAttribute('data-shell-fallback', '⏸ Pause');
  pauseButton.style.cssText =
    `pointer-events:auto;position:absolute;right:14px;top:-4px;padding:6px 14px;border-radius:${theme.radius}px;border:1px solid #3f3f46;background:${hexToRgba(theme.palette.surface, 0.85)};color:${theme.palette.text};font-size:${theme.typography.basePx - 2}px;cursor:pointer;`;
  pauseButton.addEventListener('click', () => shell.handleButton('pause'));
  hud.append(hudScore, hudWave, hudKills, hudTime, pauseButton);

  const healthBar = doc.createElement('div');
  healthBar.style.cssText =
    'position:absolute;left:16px;bottom:16px;width:220px;height:14px;border-radius:7px;border:1px solid #52525b;background:rgba(24,24,27,0.8);overflow:hidden;';
  const healthFill = doc.createElement('div');
  healthFill.style.cssText = `height:100%;width:100%;background:${theme.palette.success};transition:width 120ms linear;`;
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

function applyView(doc: Document, elements: Record<string, HTMLElement>, view: ShellView, shell: GameShell): void {
  if (!elements.root) return;
  const showOverlay = view.overlay !== 'hud';
  elements.overlay.style.display = showOverlay ? 'flex' : 'none';
  elements.hud.style.display = showOverlay ? 'none' : 'flex';
  elements.healthBar.style.display = showOverlay ? 'none' : 'block';

  elements.title.textContent = view.title;
  elements.status.textContent = view.statusText;
  const statParts = [`${view.scoreLabel} ${view.score.toFixed(view.scoreSuffix ? 1 : 0)}${view.scoreSuffix}`];
  const waveLabel = shell.localize('shell.hud.wave', 'Wave');
  const killsLabel = shell.localize('shell.hud.kills', 'Kills');
  if (view.showWave) statParts.push(`${waveLabel} ${view.wave}`);
  if (view.showKills) statParts.push(`${killsLabel} ${view.kills}`);
  statParts.push(`${view.elapsedSeconds.toFixed(1)}s`);
  elements.stats.textContent = view.overlay === 'menu' ? '' : statParts.join(' · ');

  // Re-resolve every keyed label so runtime locale switches repaint the DOM.
  for (const element of Object.values(elements)) {
    const key = element.getAttribute?.('data-shell-label');
    if (key) {
      element.textContent = shell.localize(key, element.getAttribute('data-shell-fallback') ?? key);
    }
  }

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
  elements.hudScore.textContent = `${view.scoreLabel} ${view.score.toFixed(view.scoreSuffix ? 1 : 0)}${view.scoreSuffix}`;
  elements.hudWave.textContent = `${waveLabel} ${view.wave}`;
  elements.hudKills.textContent = `${killsLabel} ${view.kills}`;
  elements.hudWave.style.display = view.showWave ? '' : 'none';
  elements.hudKills.style.display = view.showKills ? '' : 'none';
  elements.healthBar.style.display = view.showHealth && view.overlay !== 'hud' ? 'none' : view.showHealth ? 'block' : 'none';
  elements.hudTime.textContent = `${view.elapsedSeconds.toFixed(1)}s`;
  elements.healthFill.style.width = `${Math.round(view.healthFraction * 100)}%`;
  const palette = shell.getTheme().palette;
  elements.healthFill.style.background =
    view.healthFraction > 0.5 ? palette.success : view.healthFraction > 0.2 ? palette.accent : palette.danger;
}
