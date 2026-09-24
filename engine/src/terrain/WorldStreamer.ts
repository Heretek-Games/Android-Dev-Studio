import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { TerrainChunk } from './TerrainChunk.js';

export interface WorldStreamerOptions {
  chunkSize?: number;
  renderDistance?: number; // In chunks (e.g., 2 means 5x5 = 25 chunks)
  resolution?: number; // Vertices per chunk edge
  maxHeight?: number;
  seed?: number;
  target?: GameObject | THREE.Vector3;
}

/**
 * Open-world Chunk Streaming Manager (Genshin Impact / Skyrim architecture).
 * Dynamically streams, instantiates, and unloads terrain chunks around the player's
 * coordinates with frame-budgeted instantiation to prevent mobile frame drops.
 */
export class WorldStreamer extends Component {
  public chunkSize: number = 48;
  public renderDistance: number = 2;
  public resolution: number = 24;
  public maxHeight: number = 12;
  public seed: number = 1337;

  public target: GameObject | THREE.Vector3 | null = null;
  public activeChunks: Map<string, GameObject> = new Map();
  private pendingQueue: Array<{ cx: number; cz: number }> = [];
  private lastChunkX: number = NaN;
  private lastChunkZ: number = NaN;

  constructor(options?: WorldStreamerOptions) {
    super();
    if (options) {
      if (options.chunkSize !== undefined) this.chunkSize = options.chunkSize;
      if (options.renderDistance !== undefined) this.renderDistance = options.renderDistance;
      if (options.resolution !== undefined) this.resolution = options.resolution;
      if (options.maxHeight !== undefined) this.maxHeight = options.maxHeight;
      if (options.seed !== undefined) this.seed = options.seed;
      if (options.target) this.target = options.target;
    }
  }

  public override start(): void {
    this.updateStreaming(true);
  }

  public override update(_deltaTime: number): void {
    // Process at most 1 chunk creation per frame to maintain 60 FPS on mobile
    if (this.pendingQueue.length > 0) {
      const next = this.pendingQueue.shift()!;
      this.spawnChunk(next.cx, next.cz);
    }

    const targetPos = this.getTargetPosition();
    if (!targetPos) return;

    const currentChunkX = Math.floor(targetPos.x / this.chunkSize);
    const currentChunkZ = Math.floor(targetPos.z / this.chunkSize);

    if (currentChunkX !== this.lastChunkX || currentChunkZ !== this.lastChunkZ) {
      this.lastChunkX = currentChunkX;
      this.lastChunkZ = currentChunkZ;
      this.updateStreaming(false);
    }
  }

  private getTargetPosition(): THREE.Vector3 | null {
    if (this.target instanceof THREE.Vector3) {
      return this.target;
    }
    if (this.target instanceof GameObject) {
      return this.target.transform.position;
    }
    // Default: find Player Hero in the scene
    if (this.gameObject.scene) {
      const player = this.gameObject.scene.findByName('Player Hero');
      if (player) return player.transform.position;
    }
    return null;
  }

  private updateStreaming(immediate: boolean): void {
    const targetPos = this.getTargetPosition();
    if (!targetPos) return;

    const centerCX = Math.floor(targetPos.x / this.chunkSize);
    const centerCZ = Math.floor(targetPos.z / this.chunkSize);
    const neededKeys = new Set<string>();

    for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
      for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
        const cx = centerCX + dx;
        const cz = centerCZ + dz;
        const key = `${cx},${cz}`;
        neededKeys.add(key);

        if (!this.activeChunks.has(key)) {
          if (immediate) {
            this.spawnChunk(cx, cz);
          } else if (!this.pendingQueue.some((q) => q.cx === cx && q.cz === cz)) {
            this.pendingQueue.push({ cx, cz });
          }
        }
      }
    }

    // Unload chunks that have moved out of view radius
    for (const [key, chunkGo] of this.activeChunks.entries()) {
      if (!neededKeys.has(key)) {
        chunkGo.destroy();
        this.activeChunks.delete(key);
      }
    }
  }

  private spawnChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.activeChunks.has(key) || !this.gameObject.scene) return;

    const chunkGo = new GameObject(`TerrainChunk_${key}`);
    chunkGo.addComponent(
      new TerrainChunk({
        chunkX: cx,
        chunkZ: cz,
        size: this.chunkSize,
        resolution: this.resolution,
        maxHeight: this.maxHeight,
        seed: this.seed
      })
    );

    this.gameObject.scene.addGameObject(chunkGo);
    this.activeChunks.set(key, chunkGo);
  }

  public override onDestroy(): void {
    for (const chunkGo of this.activeChunks.values()) {
      chunkGo.destroy();
    }
    this.activeChunks.clear();
    this.pendingQueue = [];
  }
}
