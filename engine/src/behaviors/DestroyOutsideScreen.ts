import { Component } from '../core/Component.js';

export interface DestroyOutsideScreenOptions {
  /** Half-extent of the live box (default 60). */
  margin?: number;
}

/**
 * DestroyOutsideScreen behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Destroys the owner once its XZ position leaves the centered live box
 * (projectiles, stray NPCs, escaped physics bodies). Headless-deterministic.
 */
export class DestroyOutsideScreen extends Component {
  public margin: number = 60;
  public destroyedAt: number | null = null;

  private age: number = 0;

  constructor(options?: DestroyOutsideScreenOptions) {
    super();
    if (options?.margin !== undefined) this.margin = options.margin;
  }

  public override update(deltaTime: number): void {
    this.age += deltaTime;
    const p = this.gameObject.transform.position;
    if (Math.abs(p.x) > this.margin || Math.abs(p.z) > this.margin) {
      this.destroyedAt = this.age;
      this.gameObject.destroy();
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'DestroyOutsideScreen',
      enabled: this.enabled,
      margin: this.margin
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.margin !== undefined) this.margin = data.margin;
  }
}
