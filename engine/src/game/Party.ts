import type { GameObject } from '../core/GameObject.js';
import { MobileController } from '../components/MobileController.js';

export interface PartyOptions {
  /** Swap cooldown in seconds (Genshin-style swap lockout). */
  swapCooldownSeconds?: number;
}

/**
 * Party — single-player control roster with swap events (Track E.2).
 *
 * The active member is player-controlled; inactive members are AI companions
 * (driven by their own EnemyAI/behavior components — party never networks,
 * single-player charter). Swap transfers the MobileController enable flag
 * when present and emits onSwap for game code (camera retarget, UI, VFX).
 * Engine-primitive: no game rules, no elements, no damage here.
 */
export class Party {
  public swapCooldownSeconds: number;
  public activeIndex: number = 0;

  private members: GameObject[] = [];
  private cooldownLeft: number = 0;
  private swapListeners: Set<(prev: GameObject, next: GameObject) => void> = new Set();
  private swapCount = 0;

  constructor(options?: PartyOptions) {
    this.swapCooldownSeconds = Math.max(0, options?.swapCooldownSeconds ?? 1.0);
  }

  /** Roster (order-stable). Replaces membership; keeps a valid active index. */
  public setMembers(members: GameObject[]): void {
    this.members = [...members];
    if (this.activeIndex >= this.members.length) this.activeIndex = 0;
    this.applyControl();
  }

  public get size(): number {
    return this.members.length;
  }

  public active(): GameObject | null {
    return this.members[this.activeIndex] ?? null;
  }

  public onSwap(listener: (prev: GameObject, next: GameObject) => void): () => void {
    this.swapListeners.add(listener);
    return () => this.swapListeners.delete(listener);
  }

  public get swapsTaken(): number {
    return this.swapCount;
  }

  public get cooldownFraction(): number {
    if (this.swapCooldownSeconds <= 0) return 0;
    return Math.min(1, Math.max(0, this.cooldownLeft / this.swapCooldownSeconds));
  }

  /** Swap control to a member. Returns false on cooldown, bad index, or no-op. */
  public swapTo(index: number): boolean {
    if (index < 0 || index >= this.members.length) return false;
    if (index === this.activeIndex || this.cooldownLeft > 0) return false;
    const prev = this.members[this.activeIndex];
    this.activeIndex = index;
    const next = this.members[this.activeIndex];
    this.cooldownLeft = this.swapCooldownSeconds;
    this.swapCount++;
    this.applyControl();
    for (const listener of this.swapListeners) {
      try {
        listener(prev, next);
      } catch {
        // listener errors must never break the swap
      }
    }
    return true;
  }

  /** Advance cooldowns (called by game code each frame). */
  public update(deltaTime: number): void {
    if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - deltaTime);
    }
  }

  /** Active member holds the controller; companions keep their AI brains. */
  private applyControl(): void {
    this.members.forEach((member, i) => {
      const controller = member.getComponent(MobileController);
      if (controller) controller.enabled = i === this.activeIndex;
    });
  }
}
