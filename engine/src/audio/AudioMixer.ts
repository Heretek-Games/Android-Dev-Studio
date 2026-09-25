/**
 * AudioMixer — named buses, ducking, and snapshots with headless-steppable
 * gain math (Track 1.10, ADR-1790375806194).
 *
 * Godot-AudioServer + Unity-AudioMixer semantics, dependency-free: dB gains,
 * mute/solo, parent-send chains (child -> parent -> master), linear-dB duck
 * attack/release ramps, snapshot capture + timed manual-lerp transitions
 * (manual lerp = headless parity; no AudioParam automation needed to test).
 * No DSP/effect nodes in Phase 1 — this is the gain computer; the
 * WebAudioBackend owns the node graph. All math is pure and deterministic.
 */

export interface MixerBus {
  /** dB gain. Default 0. */
  gainDb?: number;
  mute?: boolean;
  solo?: boolean;
  /** Parent bus name (default master). Must not cycle (validated). */
  send?: string;
}

export interface DuckRule {
  /** Bus whose activity ducks the target. */
  trigger: string;
  target: string;
  /** dB applied at full duck. Default -12. */
  depthDb?: number;
  /** Seconds 0 -> depth. Default 0.05. */
  attack?: number;
  /** Seconds depth -> 0. Default 0.3. */
  release?: number;
}

export interface MixerOptions {
  buses?: Record<string, MixerBus>;
  duckRules?: DuckRule[];
  snapshots?: Record<string, Record<string, number>>;
}

export interface Audibility {
  gainLinear: number;
  audible: boolean;
  reason: string;
}

export const MASTER_BUS = 'master';

/** Boundary tolerance for IEEE754 fade-clock accumulation. */
const MIX_EPSILON = 1e-9;

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

interface ResolvedBus {
  gainDb: number;
  mute: boolean;
  solo: boolean;
  send: string | null;
}

interface DuckState {
  depthDb: number;
}

interface FadeState {
  snapshot: string;
  elapsed: number;
  duration: number;
  from: Record<string, number>;
  to: Record<string, number>;
}

export class AudioMixer {
  private buses: Map<string, ResolvedBus> = new Map();
  private duckRules: DuckRule[] = [];
  private snapshots: Map<string, Record<string, number>> = new Map();
  private duckDepths: Map<number, number> = new Map();
  private fade: FadeState | null = null;

  constructor(options?: MixerOptions) {
    this.defineBus(MASTER_BUS, {});
    if (options?.buses) {
      for (const [name, bus] of Object.entries(options.buses)) {
        this.defineBus(name, bus);
      }
    }
    if (options?.duckRules) {
      for (const rule of options.duckRules) this.addDuckRule(rule);
    }
    if (options?.snapshots) {
      for (const [name, gains] of Object.entries(options.snapshots)) {
        this.snapshots.set(name, { ...gains });
      }
    }
  }

  // ------------------------------------------------------------------ buses
  public defineBus(name: string, bus: MixerBus): void {
    if (!name) throw new Error('bus name must be non-empty');
    const send = name === MASTER_BUS ? null : (bus.send ?? MASTER_BUS);
    if (send !== null && this.wouldCycle(name, send)) {
      throw new Error(`bus send cycle: '${name}' -> '${send}'`);
    }
    this.buses.set(name, {
      gainDb: bus.gainDb ?? 0,
      mute: bus.mute ?? false,
      solo: bus.solo ?? false,
      send
    });
  }

  public removeBus(name: string): boolean {
    if (name === MASTER_BUS) return false;
    // Children of the removed bus fall back to master (no dangling sends).
    for (const bus of this.buses.values()) {
      if (bus.send === name) bus.send = MASTER_BUS;
    }
    return this.buses.delete(name);
  }

  public hasBus(name: string): boolean {
    return this.buses.has(name);
  }

  public busNames(): string[] {
    return [...this.buses.keys()].sort();
  }

  public setGainDb(name: string, db: number): void {
    const bus = this.requireBus(name);
    bus.gainDb = db;
  }

  public getGainDb(name: string): number {
    return this.requireBus(name).gainDb;
  }

  public setMute(name: string, mute: boolean): void {
    this.requireBus(name).mute = mute;
  }

  public setSolo(name: string, solo: boolean): void {
    this.requireBus(name).solo = solo;
  }

  private requireBus(name: string): ResolvedBus {
    const bus = this.buses.get(name);
    if (!bus) throw new Error(`unknown bus '${name}'`);
    return bus;
  }

  private wouldCycle(name: string, send: string): boolean {
    let current: string | null | undefined = send;
    const seen = new Set<string>([name]);
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.buses.get(current)?.send;
    }
    return false;
  }

  private chain(bus: string): string[] {
    const out: string[] = [];
    let current: string | null | undefined = bus;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      out.push(current);
      current = this.buses.get(current)?.send;
    }
    return out;
  }

  // ---------------------------------------------------------------- ducking
  public addDuckRule(rule: DuckRule): void {
    this.requireBus(rule.trigger);
    this.requireBus(rule.target);
    this.duckRules.push({
      trigger: rule.trigger,
      target: rule.target,
      depthDb: rule.depthDb ?? -12,
      attack: Math.max(0.001, rule.attack ?? 0.05),
      release: Math.max(0.001, rule.release ?? 0.3)
    });
    this.duckDepths.set(this.duckRules.length - 1, 0);
  }

  public clearDuckRules(): void {
    this.duckRules = [];
    this.duckDepths.clear();
  }

  // --------------------------------------------------------------- snapshots
  public captureSnapshot(name: string): void {
    const gains: Record<string, number> = {};
    for (const [busName, bus] of this.buses) gains[busName] = bus.gainDb;
    this.snapshots.set(name, gains);
  }

  public snapshotNames(): string[] {
    return [...this.snapshots.keys()].sort();
  }

  /** Timed transition to a snapshot (manual lerp; returns false when unknown). */
  public transitionTo(name: string, seconds: number): boolean {
    const target = this.snapshots.get(name);
    if (!target) return false;
    const from: Record<string, number> = {};
    for (const [busName, bus] of this.buses) from[busName] = bus.gainDb;
    this.fade = {
      snapshot: name,
      elapsed: 0,
      duration: Math.max(0.001, seconds),
      from,
      to: { ...target }
    };
    return true;
  }

  public activeTransition(): string | null {
    return this.fade ? this.fade.snapshot : null;
  }

  // ---------------------------------------------------------------- stepping
  /**
   * Advances fades and duck ramps. `activity` maps bus name -> voice-active
   * (the manager passes live voice presence per bus each frame).
   */
  public update(deltaTime: number, activity: Record<string, boolean> = {}): void {
    if (this.fade) {
      const fade = this.fade;
      fade.elapsed += deltaTime;
      // EPSILON: 60 x (1/60) sums to just under 1.0 in IEEE754 — a 1s fade
      // must land exactly on target instead of lingering a frame short.
      const done = fade.elapsed + MIX_EPSILON >= fade.duration;
      const alpha = done ? 1 : fade.elapsed / fade.duration;
      for (const [busName, bus] of this.buses) {
        const from = fade.from[busName] ?? bus.gainDb;
        const to = fade.to[busName] ?? from;
        bus.gainDb = from + (to - from) * alpha;
      }
      if (done) this.fade = null;
    }
    this.duckRules.forEach((rule, index) => {
      const active = activity[rule.trigger] === true;
      const target = active ? (rule.depthDb ?? -12) : 0;
      const rate = active ? (rule.attack ?? 0.05) : (rule.release ?? 0.3);
      const current = this.duckDepths.get(index) ?? 0;
      // Linear dB ramp scaled by the rule depth: sustained activity lands
      // exactly on target (no Zeno asymptote), flicker reverses cleanly.
      const fullScale = Math.abs(rule.depthDb ?? -12);
      const maxStep = fullScale <= 0 ? Math.abs(target - current) : (deltaTime / Math.max(0.001, rate)) * fullScale;
      this.duckDepths.set(index, moveToward(current, target, maxStep));
    });
  }

  private duckDepthFor(bus: string): number {
    let depth = 0;
    this.duckRules.forEach((rule, index) => {
      if (rule.target === bus) depth += this.duckDepths.get(index) ?? 0;
    });
    return depth;
  }

  // ------------------------------------------------------------------ query
  /**
   * dB gain for a bus incl. send chain, ducking, mute/solo.
   * Precedence: solo-gate, then mute, then summed gains. Master is the sum
   * point and is never solo-gated (mute still applies).
   */
  public effectiveGainDb(bus: string): number {
    if (!this.buses.has(bus)) return -Infinity;
    const anySolo = [...this.buses.values()].some(b => b.solo);
    if (anySolo && bus !== MASTER_BUS && !this.buses.get(bus)!.solo) return -Infinity;
    let db = 0;
    for (const name of this.chain(bus)) {
      const entry = this.buses.get(name)!;
      if (entry.mute) return -Infinity;
      db += entry.gainDb + this.duckDepthFor(name);
    }
    return db;
  }

  /** Linear gain for a voice routed to `bus` (unknown bus = silent). */
  public voiceGain(bus: string | undefined, baseVolume: number): number {
    if (!bus) return Math.min(1, Math.max(0, baseVolume));
    const linear = dbToLinear(this.effectiveGainDb(bus));
    return Math.min(1, Math.max(0, baseVolume * linear));
  }

  public getAudibility(bus: string): Audibility {
    if (!this.buses.has(bus)) {
      return { gainLinear: 0, audible: false, reason: `unknown bus '${bus}'` };
    }
    const anySolo = [...this.buses.values()].some(b => b.solo);
    if (anySolo && bus !== MASTER_BUS && !this.buses.get(bus)!.solo) {
      return { gainLinear: 0, audible: false, reason: 'solo overrides (another bus soloed)' };
    }
    for (const name of this.chain(bus)) {
      if (this.buses.get(name)!.mute) {
        return { gainLinear: 0, audible: false, reason: `'${name}' muted` };
      }
    }
    const gainLinear = dbToLinear(this.effectiveGainDb(bus));
    if (gainLinear <= 0.001) {
      return { gainLinear, audible: false, reason: 'gain below -60 dB' };
    }
    const ducked = this.duckDepthFor(bus);
    return {
      gainLinear,
      audible: true,
      reason: ducked < 0 ? `audible (ducked ${ducked.toFixed(1)} dB)` : 'audible'
    };
  }

  public toJSON(): Record<string, any> {
    const buses: Record<string, unknown> = {};
    for (const [name, bus] of this.buses) {
      buses[name] = { gainDb: bus.gainDb, mute: bus.mute, solo: bus.solo, send: bus.send };
    }
    const snapshots: Record<string, unknown> = {};
    for (const [name, gains] of this.snapshots) snapshots[name] = { ...gains };
    const duckDepths: Record<string, number> = {};
    this.duckDepths.forEach((depth, index) => {
      duckDepths[String(index)] = depth;
    });
    return {
      type: 'AudioMixer',
      buses,
      duckRules: this.duckRules.map(r => ({ ...r })),
      snapshots,
      duckDepths,
      fade: this.fade ? { ...this.fade, from: { ...this.fade.from }, to: { ...this.fade.to } } : null
    };
  }

  public fromJSON(data: Record<string, any>): void {
    this.buses.clear();
    this.duckRules = [];
    this.snapshots.clear();
    this.duckDepths.clear();
    this.fade = null;
    this.defineBus(MASTER_BUS, {});
    const buses = data.buses;
    if (buses && typeof buses === 'object') {
      for (const [name, bus] of Object.entries(buses as Record<string, MixerBus>)) {
        if (name === MASTER_BUS) {
          const master = this.buses.get(MASTER_BUS)!;
          if (typeof bus.gainDb === 'number') master.gainDb = bus.gainDb;
          if (typeof bus.mute === 'boolean') master.mute = bus.mute;
          if (typeof bus.solo === 'boolean') master.solo = bus.solo;
          continue;
        }
        try {
          this.defineBus(name, bus ?? {});
        } catch {
          // Corrupt send graph: attach flat to master, never throw restore.
          this.buses.set(name, {
            gainDb: typeof bus.gainDb === 'number' ? bus.gainDb : 0,
            mute: bus.mute === true,
            solo: bus.solo === true,
            send: MASTER_BUS
          });
        }
      }
    }
    if (Array.isArray(data.duckRules)) {
      for (const rule of data.duckRules) {
        try {
          this.addDuckRule(rule);
        } catch {
          // Unknown buses in stale rules: skip, never throw restore.
        }
      }
    }
    if (data.snapshots && typeof data.snapshots === 'object') {
      for (const [name, gains] of Object.entries(data.snapshots)) {
        if (gains && typeof gains === 'object') this.snapshots.set(name, { ...(gains as Record<string, number>) });
      }
    }
    if (data.duckDepths && typeof data.duckDepths === 'object') {
      for (const [index, depth] of Object.entries(data.duckDepths)) {
        if (typeof depth === 'number') this.duckDepths.set(Number(index), depth);
      }
    }
    if (data.fade && typeof data.fade === 'object') this.fade = data.fade as FadeState;
  }
}

function moveToward(current: number, target: number, maxStep: number): number {
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return target;
}
