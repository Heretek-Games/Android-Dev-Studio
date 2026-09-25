import { Component } from '../core/Component.js';

export interface DraggableOptions {
  /** Lock an axis: 'x' | 'z' | null (default null = free planar drag). */
  axisLock?: 'x' | 'z' | null;
  /** Programmatic drag target (touch wiring sets this); headless-testable. */
  dragTarget?: { x: number; z: number } | null;
  /** Snap-back when no target is set. Default false. */
  snapBack?: boolean;
}

/**
 * Draggable behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Eases the object toward a drag target on the XZ plane (touch handlers or
 * AI set `dragTarget`; clearing it releases). Optional axis lock and
 * snap-back to the grab point. Headless-deterministic.
 */
export class Draggable extends Component {
  public axisLock: 'x' | 'z' | null = null;
  public dragTarget: { x: number; z: number } | null = null;
  public snapBack: boolean = false;
  public isDragging: boolean = false;

  private homeX: number | null = null;
  private homeZ: number | null = null;

  constructor(options?: DraggableOptions) {
    super();
    if (options) {
      if (options.axisLock !== undefined) this.axisLock = options.axisLock;
      if (options.dragTarget !== undefined) this.dragTarget = options.dragTarget;
      if (options.snapBack !== undefined) this.snapBack = options.snapBack;
    }
  }

  public override update(deltaTime: number): void {
    const t = this.gameObject.transform;
    if (this.homeX === null) {
      this.homeX = t.position.x;
      this.homeZ = t.position.z;
    }
    if (!this.dragTarget) {
      this.isDragging = false;
      if (this.snapBack && this.homeX !== null && this.homeZ !== null) {
        t.position.x = this.homeX;
        t.position.z = this.homeZ;
      }
      return;
    }
    this.isDragging = true;
    const rate = Math.min(1, deltaTime * 12);
    const nx = t.position.x + (this.dragTarget.x - t.position.x) * rate;
    const nz = t.position.z + (this.dragTarget.z - t.position.z) * rate;
    if (this.axisLock !== 'x') t.position.x = nx;
    if (this.axisLock !== 'z') t.position.z = nz;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Draggable',
      enabled: this.enabled,
      axisLock: this.axisLock,
      dragTarget: this.dragTarget,
      snapBack: this.snapBack
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.axisLock !== undefined) this.axisLock = data.axisLock;
    if (data.dragTarget !== undefined) this.dragTarget = data.dragTarget;
    if (data.snapBack !== undefined) this.snapBack = data.snapBack;
  }
}
