/**
 * GameFlow — the game-shell state machine (menu → playing → won/lost → restart).
 *
 * Pure and headless: it owns phase transitions and listeners only; the DOM shell
 * and the game session subscribe to it. Invalid transitions are rejected
 * explicitly (return false + a reason) instead of silently changing state.
 */

export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'lost';

export type GameEvent = 'start' | 'pause' | 'resume' | 'win' | 'lose' | 'restart' | 'quit';

export interface PhaseChange {
  from: GamePhase;
  to: GamePhase;
  event: GameEvent;
}

const TRANSITIONS: Record<GamePhase, Partial<Record<GameEvent, GamePhase>>> = {
  menu: { start: 'playing' },
  playing: { pause: 'paused', win: 'won', lose: 'lost', quit: 'menu' },
  paused: { resume: 'playing', quit: 'menu' },
  won: { restart: 'playing', quit: 'menu' },
  lost: { restart: 'playing', quit: 'menu' }
};

export class GameFlow {
  private phase: GamePhase = 'menu';
  private readonly phaseListeners = new Set<(change: PhaseChange) => void>();
  private readonly eventListeners = new Set<(event: GameEvent, phase: GamePhase) => void>();
  private rejection: string | null = null;

  public getPhase(): GamePhase {
    return this.phase;
  }

  public isPlaying(): boolean {
    return this.phase === 'playing';
  }

  public isOver(): boolean {
    return this.phase === 'won' || this.phase === 'lost';
  }

  /** Whether `event` is legal in the current phase. */
  public canTransition(event: GameEvent): boolean {
    return Boolean(TRANSITIONS[this.phase][event]);
  }

  /** Apply an event; returns false (and records a reason) when illegal. */
  public transition(event: GameEvent): boolean {
    const next = TRANSITIONS[this.phase][event];
    if (!next) {
      this.rejection = `event "${event}" is not valid in phase "${this.phase}"`;
      return false;
    }
    this.rejection = null;
    const previous = this.phase;
    this.phase = next;
    for (const listener of this.phaseListeners) listener({ from: previous, to: next, event });
    for (const listener of this.eventListeners) listener(event, next);
    return true;
  }

  /** Last rejection reason (null when the last transition succeeded). */
  public getLastRejection(): string | null {
    return this.rejection;
  }

  public onPhaseChange(listener: (change: PhaseChange) => void): () => void {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  }

  public onEvent(listener: (event: GameEvent, phase: GamePhase) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Force back to menu (scene teardown/restart flows). */
  public reset(): void {
    this.phase = 'menu';
    this.rejection = null;
  }
}
