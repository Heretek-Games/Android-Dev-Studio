import { Component } from '../core/Component.js';

export interface SaveSlotOptions {
  /** Named checkpoint slot. Default 'slot1'. */
  slotName?: string;
  /** Autosave period in seconds (0 = manual save() only). Default 0. */
  autosaveInterval?: number;
}

export interface OwnerSnapshot {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  savedAtTick: number;
}

/**
 * SaveSlot behavior (Track 1.3 behavior library, GDevelop/Unity-informed).
 *
 * Owner-scope checkpoint: save() captures the owner's transform,
 * load() restores it (GDevelop variables-persistence / Unity PlayerPrefs
 * semantics at object scope; scene-wide saves stay in SaveSystem +
 * GameSession). The snapshot serializes with the component, so checkpoints
 * survive undo restore and scene save/load. A deterministic tick clock
 * (advanced in update) stamps saves instead of wall-clock time.
 */
export class SaveSlot extends Component {
  public slotName: string = 'slot1';
  public autosaveInterval: number = 0;

  public snapshot: OwnerSnapshot | null = null;
  public saveCount: number = 0;
  public loadCount: number = 0;

  private tick: number = 0;
  private autosaveElapsed: number = 0;

  constructor(options?: SaveSlotOptions) {
    super();
    if (options) {
      if (options.slotName !== undefined) this.slotName = options.slotName;
      if (options.autosaveInterval !== undefined) {
        this.autosaveInterval = Math.max(0, options.autosaveInterval);
      }
    }
  }

  public get hasSave(): boolean {
    return this.snapshot !== null;
  }

  /** Captures the owner's current transform into the slot. */
  public save(): void {
    const t = this.gameObject.transform;
    this.snapshot = {
      position: [t.position.x, t.position.y, t.position.z],
      rotation: [t.rotation.x, t.rotation.y, t.rotation.z],
      scale: [t.scale.x, t.scale.y, t.scale.z],
      savedAtTick: this.tick
    };
    this.saveCount++;
  }

  /** Restores the snapshot onto the owner; false when the slot is empty. */
  public load(): boolean {
    if (!this.snapshot) return false;
    const t = this.gameObject.transform;
    t.position.set(this.snapshot.position[0], this.snapshot.position[1], this.snapshot.position[2]);
    t.rotation.set(this.snapshot.rotation[0], this.snapshot.rotation[1], this.snapshot.rotation[2]);
    t.scale.set(this.snapshot.scale[0], this.snapshot.scale[1], this.snapshot.scale[2]);
    this.loadCount++;
    return true;
  }

  /** Drops the snapshot without touching the owner. */
  public clear(): void {
    this.snapshot = null;
  }

  public override update(deltaTime: number): void {
    this.tick += deltaTime;
    if (this.autosaveInterval <= 0) return;
    this.autosaveElapsed += deltaTime;
    if (this.autosaveElapsed >= this.autosaveInterval) {
      this.autosaveElapsed = this.autosaveElapsed % this.autosaveInterval;
      this.save();
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'SaveSlot',
      enabled: this.enabled,
      slotName: this.slotName,
      autosaveInterval: this.autosaveInterval,
      snapshot: this.snapshot ? { ...this.snapshot } : null,
      saveCount: this.saveCount,
      loadCount: this.loadCount
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.slotName !== undefined) this.slotName = data.slotName;
    if (data.autosaveInterval !== undefined) this.autosaveInterval = data.autosaveInterval;
    if (data.snapshot !== undefined) this.snapshot = data.snapshot;
    if (data.saveCount !== undefined) this.saveCount = data.saveCount;
    if (data.loadCount !== undefined) this.loadCount = data.loadCount;
  }
}
