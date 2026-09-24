import type { Scene } from './Scene.js';

export class EngineContext {
  public static instance: EngineContext | null = null;
  public activeScene: Scene | null = null;

  public isRunning: boolean = false;
  public isPaused: boolean = false;
  public timeScale: number = 1.0;

  public deltaTime: number = 0;
  public totalTime: number = 0;
  public frameCount: number = 0;

  private lastTimestamp: number = 0;
  private animFrameId: number | null = null;
  private tickCallbacks: Array<(dt: number) => void> = [];

  constructor() {
    EngineContext.instance = this;
  }

  public setScene(scene: Scene): void {
    this.activeScene = scene;
  }

  public onTick(cb: (dt: number) => void): () => void {
    this.tickCallbacks.push(cb);
    return () => {
      const idx = this.tickCallbacks.indexOf(cb);
      if (idx !== -1) this.tickCallbacks.splice(idx, 1);
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    if (!this.isRunning) {
      this.start();
      return;
    }
    this.isPaused = false;
    this.lastTimestamp = performance.now();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public step(dt?: number): void {
    const delta = (dt !== undefined ? dt : 1 / 60) * this.timeScale;
    this.deltaTime = delta;
    this.totalTime += delta;
    this.frameCount++;

    if (this.activeScene) {
      this.activeScene.update(delta);
    }

    for (const cb of this.tickCallbacks) {
      cb(delta);
    }
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    const rawDelta = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    // Clamp delta to prevent spiral of death
    const clampedDelta = Math.min(rawDelta, 0.1);

    if (!this.isPaused) {
      this.step(clampedDelta);
    }

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animFrameId = requestAnimationFrame(this.loop);
    }
  };
}
