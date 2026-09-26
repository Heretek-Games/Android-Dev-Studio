import { Component } from '../core/Component.js';

export type TelegraphPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface TelegraphOptions {
  /** Wind-up seconds before the strike lands (the readable tell). */
  windupSeconds?: number;
  /** Strike active seconds. */
  strikeSeconds?: number;
  /** Recovery seconds after the strike. */
  recoverSeconds?: number;
}

/**
 * Telegraph — readable enemy attacks (Track E.2).
 *
 * Anticipation/impact/follow-through as explicit phases: windup broadcasts
 * the tell (the game flashes/VFXes off onTelegraph), strike is the damage
 * window the game resolves with MeleeHitbox, recover is punishable downtime.
 * Pure timing state — presentation and damage stay with the game.
 */
export class Telegraph extends Component {
  public windupSeconds: number;
  public strikeSeconds: number;
  public recoverSeconds: number;

  public phase: TelegraphPhase = 'idle';
  private phaseTime: number = 0;
  private telegraphListeners: Set<() => void> = new Set();
  private strikeListeners: Set<() => void> = new Set();

  constructor(options?: TelegraphOptions) {
    super();
    this.windupSeconds = Math.max(0, options?.windupSeconds ?? 0.6);
    this.strikeSeconds = Math.max(0, options?.strikeSeconds ?? 0.2);
    this.recoverSeconds = Math.max(0, options?.recoverSeconds ?? 0.5);
  }

  /** Signal listeners (game flashes the tell / resolves the strike). */
  public onTelegraph(listener: () => void): () => void {
    this.telegraphListeners.add(listener);
    return () => this.telegraphListeners.delete(listener);
  }

  public onStrike(listener: () => void): () => void {
    this.strikeListeners.add(listener);
    return () => this.strikeListeners.delete(listener);
  }

  /** Begin the wind-up; ignored unless idle (no overlapping tells). */
  public start(): boolean {
    if (this.phase !== 'idle') return false;
    this.phase = 'windup';
    this.phaseTime = 0;
    for (const listener of this.telegraphListeners) {
      try {
        listener();
      } catch {
        // listener errors must never break the telegraph
      }
    }
    return true;
  }

  public cancel(): void {
    this.phase = 'idle';
    this.phaseTime = 0;
  }

  /** Fraction through the current phase (0..1), for progress-driven tells. */
  public phaseProgress(): number {
    const total =
      this.phase === 'windup' ? this.windupSeconds
      : this.phase === 'strike' ? this.strikeSeconds
      : this.phase === 'recover' ? this.recoverSeconds
      : 0;
    if (total <= 0) return 1;
    return Math.min(1, this.phaseTime / total);
  }

  public override update(deltaTime: number): void {
    if (this.phase === 'idle') return;
    this.phaseTime += deltaTime;
    // Boundary tolerance for IEEE754 accumulation (AnimFSM EXIT_EPSILON pattern).
    const EPSILON = 1e-9;
    if (this.phase === 'windup' && this.phaseTime + EPSILON >= this.windupSeconds) {
      this.phase = 'strike';
      this.phaseTime = 0;
      for (const listener of this.strikeListeners) {
        try {
          listener();
        } catch {
          // listener errors must never break the strike
        }
      }
    } else if (this.phase === 'strike' && this.phaseTime + EPSILON >= this.strikeSeconds) {
      this.phase = 'recover';
      this.phaseTime = 0;
    } else if (this.phase === 'recover' && this.phaseTime + EPSILON >= this.recoverSeconds) {
      this.phase = 'idle';
      this.phaseTime = 0;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Telegraph',
      enabled: this.enabled,
      windupSeconds: this.windupSeconds,
      strikeSeconds: this.strikeSeconds,
      recoverSeconds: this.recoverSeconds
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.windupSeconds !== undefined) this.windupSeconds = data.windupSeconds;
    if (data.strikeSeconds !== undefined) this.strikeSeconds = data.strikeSeconds;
    if (data.recoverSeconds !== undefined) this.recoverSeconds = data.recoverSeconds;
  }
}
