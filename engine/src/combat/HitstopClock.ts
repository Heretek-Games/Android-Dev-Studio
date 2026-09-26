/**
 * HitstopClock — freeze-frame juice without engine coupling (Track E.2).
 *
 * Game-feel canon: freeze both actors for 2-4 frames on a clean hit so the
 * brain reads impact weight. This clock is pure (no singleton, no scene):
 * the game calls request() on hits and applies timeScale() to the engine
 * timestep each frame. Stacked requests take the max; expiry restores 1.
 */
export class HitstopClock {
  private frozenLeft: number = 0;

  /** Freeze for `frames` rendered frames (max wins when stacked). */
  public request(frames: number): void {
    if (!Number.isFinite(frames) || frames <= 0) return;
    this.frozenLeft = Math.max(this.frozenLeft, Math.floor(frames));
  }

  /** Advance one rendered frame; returns the timestep scale to apply. */
  public advance(): number {
    if (this.frozenLeft <= 0) return 1;
    this.frozenLeft -= 1;
    return 0;
  }

  public get active(): boolean {
    return this.frozenLeft > 0;
  }

  public cancel(): void {
    this.frozenLeft = 0;
  }
}
