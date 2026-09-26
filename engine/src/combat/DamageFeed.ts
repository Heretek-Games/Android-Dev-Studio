/**
 * DamageFeed — structured damage-number log (Track E.2).
 *
 * Floating damage numbers are presentation (HUD/world floaters render these);
 * this feed is the headless-queryable record: every applied hit appends an
 * entry, capped as a ring. QA asserts totals/reactions off it; the HUD
 * polls latest() for floaters. Attach via DamageRouter's onDamage hook.
 */
export interface DamageNumber {
  target: string;
  amount: number;
  /** Monotonic sequence (ordering without wall-clock dependence). */
  seq: number;
  element?: string;
}

export class DamageFeed {
  private readonly entries: DamageNumber[] = [];
  private nextSeq = 0;

  constructor(public readonly capacity: number = 64) {}

  /** Record one applied hit; returns the entry. */
  public push(target: string, amount: number, element?: string): DamageNumber {
    const entry: DamageNumber = {
      target,
      amount,
      seq: this.nextSeq++,
      ...(element !== undefined ? { element } : {})
    };
    this.entries.push(entry);
    while (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  /** Newest-first snapshot (up to `limit`). */
  public latest(limit = 10): DamageNumber[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  public totalDealt(): number {
    return this.entries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  public totalTo(target: string): number {
    return this.entries
      .filter(entry => entry.target === target)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  public get size(): number {
    return this.entries.length;
  }

  public clear(): void {
    this.entries.length = 0;
  }
}
