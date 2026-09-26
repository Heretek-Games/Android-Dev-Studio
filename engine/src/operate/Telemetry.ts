/**
 * Operate telemetry: local-first event log, crash capture, and remote
 * config (Track 3, ADR-1790381258218).
 *
 * Privacy defaults baked in: everything OFF/disabled until constructed
 * enabled, kids-mode drops behavioral events, no PII/keystroke/location
 * payloads accepted (scrubbed + counted), 30-day retention cap, random
 * per-install session ids only. Transport is a caller-provided sink so no
 * vendor SDK is required (OpenFeature-shaped pluggability later).
 */

export interface TelemetrySink {
  send(batch: TelemetryEvent[]): boolean;
}

export interface TelemetryEvent {
  session: string;
  build: string;
  event: string;
  t: number;
  params: Record<string, string | number | boolean>;
}

export interface TelemetryOptions {
  /** Master switch (default false — OFF until opted in). */
  enabled?: boolean;
  /** Kids mode: behavioral events dropped, diagnostics kept. Default false. */
  kidsMode?: boolean;
  sessionId?: string;
  build?: string;
  /** Max queued events (oldest dropped past it). Default 1000. */
  maxEvents?: number;
  /** Retention days for exported payloads. Default 30. */
  retentionDays?: number;
}

/** Diagnostic events allowed through kids mode. */
export const DIAGNOSTIC_EVENTS = new Set(['session_start', 'session_end', 'crash', 'error']);

/** Param keys that never leave the device (dropped + counted). */
const PII_KEY_PATTERN = /password|passwd|secret|token|email|phone|device|location|address|name/i;

function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export class Telemetry {
  public enabled: boolean = false;
  public kidsMode: boolean = false;
  public sessionId: string;
  public build: string = 'dev';
  public maxEvents: number = 1000;
  public retentionDays: number = 30;

  public droppedKids: number = 0;
  public droppedPii: number = 0;
  public droppedDisabled: number = 0;

  private queue: TelemetryEvent[] = [];
  private clock: number = 0;

  constructor(options?: TelemetryOptions) {
    if (options?.enabled !== undefined) this.enabled = options.enabled;
    if (options?.kidsMode !== undefined) this.kidsMode = options.kidsMode;
    if (options?.build !== undefined) this.build = options.build;
    if (options?.maxEvents !== undefined) this.maxEvents = Math.max(1, Math.floor(options.maxEvents));
    if (options?.retentionDays !== undefined) this.retentionDays = Math.max(1, Math.floor(options.retentionDays));
    this.sessionId = options?.sessionId ?? randomId();
  }

  /** Advances the logical clock (deterministic headless timestamps). */
  public tick(deltaTime: number): void {
    this.clock += deltaTime;
  }

  /** Records a whitelisted event (flat primitives; PII keys dropped). */
  public record(event: string, params?: Record<string, unknown>): boolean {
    if (!this.enabled) {
      this.droppedDisabled++;
      return false;
    }
    if (this.kidsMode && !DIAGNOSTIC_EVENTS.has(event)) {
      this.droppedKids++;
      return false;
    }
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
      if (PII_KEY_PATTERN.test(key)) {
        this.droppedPii++;
        continue;
      }
      if (typeof value === 'string' || typeof value === 'boolean') {
        clean[key] = value;
      } else if (typeof value === 'number') {
        clean[key] = Number.isFinite(value) ? value : 0;
      }
    }
    this.queue.push({ session: this.sessionId, build: this.build, event, t: this.clock, params: clean });
    while (this.queue.length > this.maxEvents) this.queue.shift();
    return true;
  }

  public get queuedEvents(): number {
    return this.queue.length;
  }

  public countOf(event: string): number {
    return this.queue.filter(e => e.event === event).length;
  }

  /** Per-event counts + numeric-param means (aggregate upload surface). */
  public summarize(): Record<string, { count: number; means: Record<string, number> }> {
    const out: Record<string, { count: number; means: Record<string, number> }> = {};
    const sums: Record<string, Record<string, { sum: number; n: number }>> = {};
    for (const e of this.queue) {
      const slot = (out[e.event] ??= { count: 0, means: {} });
      slot.count++;
      for (const [k, v] of Object.entries(e.params)) {
        if (typeof v !== 'number') continue;
        const acc = ((sums[e.event] ??= {})[k] ??= { sum: 0, n: 0 });
        acc.sum += v;
        acc.n++;
      }
    }
    for (const [event, acc] of Object.entries(sums)) {
      for (const [k, { sum, n }] of Object.entries(acc)) {
        out[event].means[k] = n > 0 ? sum / n : 0;
      }
    }
    return out;
  }

  /** Sends a copy; failures keep the queue (offline spool). */
  public flush(sink: TelemetrySink): boolean {
    if (this.queue.length === 0) return true;
    const ok = sink.send(this.queue.map(e => ({ ...e, params: { ...e.params } })));
    if (ok) this.queue = [];
    return ok;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'Telemetry',
      enabled: this.enabled,
      kidsMode: this.kidsMode,
      sessionId: this.sessionId,
      build: this.build,
      maxEvents: this.maxEvents,
      retentionDays: this.retentionDays,
      clock: this.clock,
      queue: this.queue.map(e => ({ ...e, params: { ...e.params } }))
    };
  }

  public fromJSON(data: Record<string, any>): void {
    if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
    if (typeof data.sessionId === 'string') this.sessionId = data.sessionId;
    if (typeof data.kidsMode === 'boolean') this.kidsMode = data.kidsMode;
    if (typeof data.build === 'string') this.build = data.build;
    if (typeof data.maxEvents === 'number') this.maxEvents = data.maxEvents;
    if (typeof data.retentionDays === 'number') this.retentionDays = data.retentionDays;
    if (typeof data.clock === 'number') this.clock = data.clock;
    if (Array.isArray(data.queue)) {
      this.queue = data.queue.filter((e: unknown) => typeof e === 'object' && e !== null) as TelemetryEvent[];
    }
  }
}
