/**
 * GameSession — score, waves, timer, and win/lose conditions for a game shell.
 *
 * Pure and headless: the session owns counters and rules; the shell renders them
 * and the scene/runtime feeds it events (`registerKill`, `playerDied`, …).
 * Counters only advance while the flow is in the `playing` phase.
 */

import type { GameFlow, GamePhase } from './GameFlow.js';

export interface GameSessionConfig {
  /** Win when score reaches this value. */
  targetScore?: number;
  /** Win after this many waves are completed. */
  totalWaves?: number;
  /** Lose when the elapsed time reaches this many seconds. */
  timeLimitSeconds?: number;
  /** Score awarded per registered kill. */
  scorePerKill?: number;
}

export interface GameSessionSnapshot {
  score: number;
  wave: number;
  kills: number;
  elapsedSeconds: number;
  phase: GamePhase;
}

export class GameSession {
  public readonly config: Required<GameSessionConfig>;

  private score = 0;
  private wave = 1;
  private kills = 0;
  private elapsedSeconds = 0;
  private readonly changeListeners = new Set<(session: GameSession) => void>();

  constructor(
    private readonly flow: GameFlow,
    config: GameSessionConfig = {}
  ) {
    this.config = {
      targetScore: config.targetScore ?? Number.POSITIVE_INFINITY,
      totalWaves: config.totalWaves ?? Number.POSITIVE_INFINITY,
      timeLimitSeconds: config.timeLimitSeconds ?? Number.POSITIVE_INFINITY,
      scorePerKill: config.scorePerKill ?? 100
    };
  }

  public getScore(): number {
    return this.score;
  }

  public getWave(): number {
    return this.wave;
  }

  public getKills(): number {
    return this.kills;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  /** Reset counters and start playing (from menu/won/lost). */
  public start(): boolean {
    this.score = 0;
    this.wave = 1;
    this.kills = 0;
    this.elapsedSeconds = 0;
    if (this.flow.getPhase() === 'menu') {
      const started = this.flow.transition('start');
      this.notify();
      return started;
    }
    if (this.flow.isOver()) {
      const restarted = this.flow.transition('restart');
      this.notify();
      return restarted;
    }
    this.notify();
    return this.flow.isPlaying();
  }

  public update(deltaTime: number): void {
    if (!this.flow.isPlaying()) return;
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.elapsedSeconds += deltaTime;
    if (this.elapsedSeconds >= this.config.timeLimitSeconds) {
      this.flow.transition('lose');
    }
    this.notify();
  }

  /** Award raw score (no kill bookkeeping). */
  public addScore(amount: number): void {
    if (!this.flow.isPlaying() || !Number.isFinite(amount) || amount <= 0) return;
    this.score += amount;
    this.checkScoreWin();
    this.notify();
  }

  /**
   * Mirror an external simulation value into the score display (e.g. settlement
   * population in build mode). Unlike addScore it can move both directions and
   * never triggers a score win — the owning runtime decides the phase.
   */
  public syncScore(value: number): void {
    if (!Number.isFinite(value)) return;
    this.score = Math.max(0, value);
    this.notify();
  }

  /** Register an enemy kill: increments kills and awards scorePerKill. */
  public registerKill(): void {
    if (!this.flow.isPlaying()) return;
    this.kills += 1;
    this.score += this.config.scorePerKill;
    this.checkScoreWin();
    this.notify();
  }

  /** Complete the current wave; wins when totalWaves is reached. */
  public completeWave(): void {
    if (!this.flow.isPlaying()) return;
    if (this.wave >= this.config.totalWaves) {
      this.flow.transition('win');
    } else {
      this.wave += 1;
    }
    this.notify();
  }

  public playerDied(): void {
    if (this.flow.isPlaying()) {
      this.flow.transition('lose');
      this.notify();
    }
  }

  public onChange(listener: (session: GameSession) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  public snapshot(): GameSessionSnapshot {
    return {
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      elapsedSeconds: this.elapsedSeconds,
      phase: this.flow.getPhase()
    };
  }

  /** Restore counters from a snapshot (save/load). Does not change the flow phase. */
  public restore(snapshot: GameSessionSnapshot): void {
    this.score = Math.max(0, snapshot.score ?? 0);
    this.wave = Math.max(1, snapshot.wave ?? 1);
    this.kills = Math.max(0, snapshot.kills ?? 0);
    this.elapsedSeconds = Math.max(0, snapshot.elapsedSeconds ?? 0);
    this.notify();
  }

  private checkScoreWin(): void {
    if (this.score >= this.config.targetScore) {
      this.flow.transition('win');
    }
  }

  private notify(): void {
    for (const listener of this.changeListeners) listener(this);
  }
}
