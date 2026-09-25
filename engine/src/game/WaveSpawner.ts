/**
 * WaveSpawner — spawns waves of enemies around a center point and advances when
 * a wave is cleared.
 *
 * The enemy factory is injected (`buildEnemy`), so the spawner stays decoupled
 * from meshes/physics/AI wiring and is fully headless-testable. Spawn positions
 * are deterministic (ring layout with a per-wave angle offset).
 */

import type { GameObject } from '../core/GameObject.js';
import type { Scene } from '../core/Scene.js';

export interface EnemySpawnContext {
  scene: Scene;
  name: string;
  position: [number, number, number];
  wave: number;
  index: number;
}

export interface WaveSpawnerConfig {
  totalWaves: number;
  /** Enemies in a given wave (default: 3 + wave). */
  enemiesPerWave?: (wave: number) => number;
  /** Ring radius around `center` (default 12). */
  spawnRadius?: number;
  center?: [number, number, number];
  /** Delay between a cleared wave and the next spawn (default 2s). */
  interWaveDelaySeconds?: number;
  /** Enemy name (default `Enemy W{wave}-{index}`). */
  nameForEnemy?: (wave: number, index: number) => string;
  /** Build and return the enemy GameObject (already added to the scene). */
  buildEnemy: (context: EnemySpawnContext) => GameObject | null;
}

export class WaveSpawner {
  private started = false;
  private complete = false;
  private wave = 0;
  private pendingDelay = 0;
  private spawnedNames: string[] = [];
  private readonly waveClearedListeners = new Set<(wave: number) => void>();
  private readonly allClearedListeners = new Set<() => void>();

  constructor(
    private readonly scene: Scene,
    private readonly config: WaveSpawnerConfig
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.complete = false;
    this.wave = 1;
    this.pendingDelay = 0;
    this.spawnWave(1);
  }

  public stop(): void {
    this.started = false;
  }

  public update(deltaTime: number): void {
    if (!this.started || this.complete) return;
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    if (this.pendingDelay > 0) {
      this.pendingDelay -= deltaTime;
      if (this.pendingDelay <= 0) {
        this.pendingDelay = 0;
        this.spawnWave(this.wave);
      }
      return;
    }

    if (this.spawnedNames.length === 0) {
      // Nothing spawned this wave (factory returned null): treat it as cleared so
      // the spawner cannot deadlock; the inter-wave delay still paces progression.
      this.handleWaveCleared();
      return;
    }
    if (this.getAliveCount() > 0) return;

    this.handleWaveCleared();
  }

  private handleWaveCleared(): void {
    for (const listener of this.waveClearedListeners) listener(this.wave);
    if (this.wave >= this.config.totalWaves) {
      this.complete = true;
      for (const listener of this.allClearedListeners) listener();
      return;
    }
    this.wave += 1;
    this.pendingDelay = this.config.interWaveDelaySeconds ?? 2;
  }

  public getWave(): number {
    return this.wave;
  }

  public isStarted(): boolean {
    return this.started;
  }

  public isComplete(): boolean {
    return this.complete;
  }

  public getAliveCount(): number {
    return this.spawnedNames.filter((name) => this.scene.findByName(name) !== null).length;
  }

  public getSpawnedNames(): string[] {
    return [...this.spawnedNames];
  }

  public onWaveCleared(listener: (wave: number) => void): () => void {
    this.waveClearedListeners.add(listener);
    return () => this.waveClearedListeners.delete(listener);
  }

  public onAllWavesCleared(listener: () => void): () => void {
    this.allClearedListeners.add(listener);
    return () => this.allClearedListeners.delete(listener);
  }

  private spawnWave(wave: number): void {
    const count = Math.max(1, this.config.enemiesPerWave ? this.config.enemiesPerWave(wave) : 3 + wave);
    const radius = this.config.spawnRadius ?? 12;
    const [cx, cy, cz] = this.config.center ?? [0, 0, 0];
    const names: string[] = [];

    for (let index = 0; index < count; index++) {
      const name = this.config.nameForEnemy ? this.config.nameForEnemy(wave, index) : `Enemy W${wave}-${index}`;
      const angle = (2 * Math.PI * index) / count + wave * 0.37;
      const position: [number, number, number] = [
        cx + Math.cos(angle) * radius,
        cy,
        cz + Math.sin(angle) * radius
      ];
      const enemy = this.config.buildEnemy({ scene: this.scene, name, position, wave, index });
      if (enemy) names.push(enemy.name);
    }
    this.spawnedNames = names;
  }
}
