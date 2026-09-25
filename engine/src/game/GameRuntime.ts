/**
 * GameRuntime — ties a scene to the game shell: session counters, wave spawning,
 * weapon damage routing, player death, and win/lose flow.
 *
 * The enemy factory and the weapon hit source are injected, so the runtime is
 * decoupled from specific visuals/weapons and fully headless-testable.
 */

import type { GameObject } from '../core/GameObject.js';
import type { Scene } from '../core/Scene.js';
import type { HitSource } from './DamageRouter.js';
import { attachDamageRouter } from './DamageRouter.js';
import { GameFlow } from './GameFlow.js';
import { GameSession, type GameSessionConfig } from './GameSession.js';
import { WaveSpawner, type EnemySpawnContext } from './WaveSpawner.js';
import { HealthComponent } from '../components/HealthComponent.js';
import type { GameShell } from '../ui/GameShell.js';

export interface GameRuntimeConfig {
  scene: Scene;
  playerName?: string;
  totalWaves?: number;
  enemiesPerWave?: (wave: number) => number;
  spawnRadius?: number;
  center?: [number, number, number];
  targetScore?: number;
  timeLimitSeconds?: number;
  scorePerKill?: number;
  interWaveDelaySeconds?: number;
  /** Build an enemy for a wave (already added to the scene). */
  buildEnemy: (context: EnemySpawnContext) => GameObject | null;
  /** Player weapon (or any hit source) whose hits damage enemies. */
  weapon?: HitSource;
  /** Optional UI shell to drive. */
  shell?: GameShell;
}

export class GameRuntime {
  public readonly flow: GameFlow;
  public readonly session: GameSession;
  public readonly spawner: WaveSpawner;

  private readonly scene: Scene;
  private readonly config: GameRuntimeConfig;
  private detachRouter: (() => void) | null = null;
  private detachPlayerDeath: (() => void) | null = null;
  private detachAllWaves: (() => void) | null = null;
  private running = false;

  constructor(config: GameRuntimeConfig) {
    this.config = config;
    this.scene = config.scene;
    this.flow = new GameFlow();
    // The session and the spawner must agree on the wave budget: the session is
    // advanced once per cleared wave and wins when the last wave is cleared.
    const totalWaves = config.totalWaves ?? 3;
    const sessionConfig: GameSessionConfig = {
      targetScore: config.targetScore,
      totalWaves,
      timeLimitSeconds: config.timeLimitSeconds,
      scorePerKill: config.scorePerKill
    };
    this.session = new GameSession(this.flow, sessionConfig);
    this.spawner = new WaveSpawner(config.scene, {
      totalWaves,
      enemiesPerWave: config.enemiesPerWave,
      spawnRadius: config.spawnRadius,
      center: config.center,
      interWaveDelaySeconds: config.interWaveDelaySeconds,
      buildEnemy: config.buildEnemy
    });
  }

  public isRunning(): boolean {
    return this.running;
  }

  /** Wire listeners (damage routing, player death, wave completion) without starting. */
  public prepare(): void {
    if (!this.running) {
      this.running = true;
      this.wire();
    }
  }

  /** Wire listeners, start the flow, and spawn wave 1. */
  public start(): void {
    this.prepare();
    this.session.start();
    this.spawner.start();
  }

  /** Restart the run: reset counters and respawn from wave 1. */
  public restart(): void {
    this.session.start();
    this.spawner.stop();
    this.spawner.start();
  }

  /** Advance the run (call once per frame from the game loop). */
  public update(deltaTime: number): void {
    if (!this.running) return;
    this.session.update(deltaTime);
    if (this.flow.isPlaying()) this.spawner.update(deltaTime);
    this.config.shell?.update(deltaTime);
  }

  /** Detach listeners and stop spawning (scene teardown). */
  public stop(): void {
    this.running = false;
    this.spawner.stop();
    this.detachRouter?.();
    this.detachRouter = null;
    this.detachPlayerDeath?.();
    this.detachPlayerDeath = null;
    this.detachAllWaves?.();
    this.detachAllWaves = null;
  }

  private wire(): void {
    if (this.config.weapon) {
      this.detachRouter = attachDamageRouter(this.scene, this.config.weapon, {
        onKill: () => this.session.registerKill()
      });
    }

    const playerName = this.config.playerName ?? 'Player Hero';
    const player = this.scene.findByName(playerName);
    const health = player?.getComponent(HealthComponent) ?? null;
    if (health) {
      this.detachPlayerDeath = health.onDeath(() => this.session.playerDied());
    }

    this.detachAllWaves = this.spawner.onWaveCleared(() => this.session.completeWave());
  }
}
