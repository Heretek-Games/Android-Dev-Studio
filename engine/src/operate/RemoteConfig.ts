/**
 * Remote config: key-value tuning with bundled defaults, staged fetch +
 * activate, and deterministic cohort gating (Track 3, ADR-1790381258218).
 *
 * OpenFeature-shaped layering without the dependency: bundled defaults
 * always win offline; fetched values stage then activate (Firebase
 * fetch/activate semantics); gating is version/build + opt-in-cohort hash
 * only (no behavioral targeting). Kill-switches and difficulty/economy
 * tuning without resubmits; experimentation UIs deferred to Phase 2.
 */

export type ConfigValues = Record<string, unknown>;

export interface RemoteConfigOptions {
  defaults?: ConfigValues;
  /** Stable install id for cohort hashing (random per instance default). */
  installId?: string;
  build?: number;
}

function randomId(): string {
  return 'install-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function hashCohort(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export class RemoteConfig {
  public installId: string;
  public build: number = 0;

  private defaults: ConfigValues = {};
  private staged: ConfigValues | null = null;
  private active: ConfigValues = {};

  constructor(options?: RemoteConfigOptions) {
    if (options?.defaults) this.defaults = { ...options.defaults };
    if (typeof options?.build === 'number') this.build = options.build;
    this.installId = options?.installId ?? randomId();
  }

  /** Bundled defaults (offline source of truth). */
  public setDefaults(defaults: ConfigValues): void {
    this.defaults = { ...defaults };
  }

  /** Stages fetched values (applied on activate). */
  public async fetch(provider: () => ConfigValues | Promise<ConfigValues>): Promise<boolean> {
    try {
      const values = await provider();
      if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
      this.staged = { ...(values as ConfigValues) };
      return true;
    } catch {
      return false;
    }
  }

  /** Swaps staged values into active (false when nothing staged). */
  public activate(): boolean {
    if (!this.staged) return false;
    this.active = { ...this.staged };
    this.staged = null;
    return true;
  }

  public get hasStaged(): boolean {
    return this.staged !== null;
  }

  private resolve(key: string): unknown {
    if (key in this.active) return this.active[key];
    if (key in this.defaults) return this.defaults[key];
    return undefined;
  }

  public get(key: string, fallback?: unknown): unknown {
    const value = this.resolve(key);
    return value === undefined ? fallback : value;
  }

  public getBool(key: string, fallback = false): boolean {
    return coerceBool(this.resolve(key), fallback);
  }

  public getNumber(key: string, fallback = 0): number {
    return coerceNumber(this.resolve(key), fallback);
  }

  public getString(key: string, fallback = ''): string {
    const value = this.resolve(key);
    return typeof value === 'string' ? value : fallback;
  }

  /**
   * Deterministic cohort gate: installId+key hash below rollout percent.
   * Version/build floor optional. No behavioral inputs, ever.
   */
  public gated(key: string, rolloutPercent: number, minBuild = 0): boolean {
    if (this.build < minBuild) return false;
    if (rolloutPercent <= 0) return false;
    if (rolloutPercent >= 100) return true;
    return hashCohort(`${this.installId}:${key}`) < rolloutPercent;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'RemoteConfig',
      installId: this.installId,
      build: this.build,
      defaults: { ...this.defaults },
      active: { ...this.active }
    };
  }

  public fromJSON(data: Record<string, any>): void {
    if (typeof data.installId === 'string') this.installId = data.installId;
    if (typeof data.build === 'number') this.build = data.build;
    if (data.defaults && typeof data.defaults === 'object') this.defaults = { ...data.defaults };
    if (data.active && typeof data.active === 'object') this.active = { ...data.active };
    this.staged = null;
  }
}
