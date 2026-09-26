/**
 * Crash capture: breadcrumb ring, exception reports, PII scrubbing, and an
 * offline spool with next-launch flush (Track 3, ADR-1790381258218).
 *
 * Godot-Logger posture: the engine owns capture primitives; transport is a
 * caller-provided sink (Sentry/ACRA-shaped later, never vendored now).
 * Scrubbing runs BEFORE store and send — paths, emails, and tokens never
 * persist. Crash payloads are diagnostic, never behavioral (kids-safe).
 */

export interface CrashSink {
  send(report: CrashReport): boolean;
}

export interface CrashReport {
  id: string;
  session: string;
  build: string;
  timestamp: number;
  message: string;
  stack?: string;
  breadcrumbs: string[];
  context: Record<string, string>;
}

export interface CrashOptions {
  enabled?: boolean;
  sessionId?: string;
  build?: string;
  /** Breadcrumb ring capacity. Default 50. */
  breadcrumbCap?: number;
  /** Max spooled reports. Default 20. */
  spoolCap?: number;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UNIX_PATH_PATTERN = /\/(home|Users)\/[^\s:'"]*/g;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g;
const TOKEN_PATTERN = /\b(sk|ghp|AKIA|xox)[A-Za-z0-9-_]{8,}\b/g;

/** Scrubs emails, home-dir paths, and token-shaped strings. */
export function scrubPii(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const [pattern, replacement] of [
    [EMAIL_PATTERN, '[email]'],
    [UNIX_PATH_PATTERN, '/…'],
    [WINDOWS_PATH_PATTERN, '[drive]:\\…'],
    [TOKEN_PATTERN, '[token]']
  ] as Array<[RegExp, string]>) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, () => {
      redactions++;
      return replacement;
    });
  }
  return { text: out, redactions };
}

function randomId(): string {
  return 'crash-xxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export class CrashReportCollector {
  public enabled: boolean = false;
  public sessionId: string;
  public build: string = 'dev';
  public breadcrumbCap: number = 50;
  public spoolCap: number = 20;
  public redactions: number = 0;

  private breadcrumbs: string[] = [];
  private spool: CrashReport[] = [];
  private uninstallers: Array<() => void> = [];

  constructor(options?: CrashOptions) {
    if (options?.enabled !== undefined) this.enabled = options.enabled;
    if (options?.build !== undefined) this.build = options.build;
    if (options?.breadcrumbCap !== undefined) this.breadcrumbCap = Math.max(1, Math.floor(options.breadcrumbCap));
    if (options?.spoolCap !== undefined) this.spoolCap = Math.max(1, Math.floor(options.spoolCap));
    this.sessionId = options?.sessionId ?? randomId();
  }

  public leaveBreadcrumb(message: string): void {
    this.breadcrumbs.push(String(message).slice(0, 280));
    while (this.breadcrumbs.length > this.breadcrumbCap) this.breadcrumbs.shift();
  }

  public get breadcrumbCount(): number {
    return this.breadcrumbs.length;
  }

  /** Captures an exception (Error, string, or unknown) into the spool. */
  public captureException(error: unknown, context?: Record<string, unknown>): CrashReport | null {
    if (!this.enabled) return null;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const scrubbed = scrubPii(`${message}\n${stack ?? ''}`);
    this.redactions += scrubbed.redactions;
    const cleanContext: Record<string, string> = {};
    for (const [k, v] of Object.entries(context ?? {})) {
      cleanContext[k] = scrubPii(String(v)).text;
    }
    const firstLine = scrubbed.text.split('\n')[0];
    const report: CrashReport = {
      id: randomId(),
      session: this.sessionId,
      build: this.build,
      timestamp: Date.now(),
      message: firstLine.slice(0, 500),
      stack: scrubbed.text.slice(0, 4000),
      breadcrumbs: [...this.breadcrumbs],
      context: cleanContext
    };
    this.spool.push(report);
    while (this.spool.length > this.spoolCap) this.spool.shift();
    return report;
  }

  public get spooledReports(): number {
    return this.spool.length;
  }

  /** Flushes the spool (failures keep it for next launch). */
  public flush(sink: CrashSink): boolean {
    if (this.spool.length === 0) return true;
    const batch = [...this.spool];
    for (const report of batch) {
      if (!sink.send(report)) return false;
    }
    this.spool = this.spool.slice(batch.length);
    return true;
  }

  /**
   * Installs global handlers (browser window only; Node callers use
   * captureException directly so test runners are never hijacked).
   */
  public installGlobalHandlers(): () => void {
    const scope = globalThis as unknown as {
      window?: Window & typeof globalThis;
      addEventListener?: Window['addEventListener'];
      removeEventListener?: Window['removeEventListener'];
    };
    if (typeof scope.window === 'undefined' || !scope.addEventListener) return () => undefined;
    const onError = (event: ErrorEvent): void => {
      this.captureException(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      this.captureException(event.reason);
    };
    scope.addEventListener('error', onError as EventListener);
    scope.addEventListener('unhandledrejection', onRejection as EventListener);
    const uninstall = (): void => {
      scope.removeEventListener?.('error', onError as EventListener);
      scope.removeEventListener?.('unhandledrejection', onRejection as EventListener);
    };
    this.uninstallers.push(uninstall);
    return uninstall;
  }

  public uninstallAll(): void {
    for (const uninstall of this.uninstallers.splice(0)) uninstall();
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'CrashReportCollector',
      enabled: this.enabled,
      sessionId: this.sessionId,
      build: this.build,
      breadcrumbCap: this.breadcrumbCap,
      spoolCap: this.spoolCap,
      breadcrumbs: [...this.breadcrumbs],
      spool: this.spool.map(r => ({ ...r, breadcrumbs: [...r.breadcrumbs], context: { ...r.context } }))
    };
  }

  public fromJSON(data: Record<string, any>): void {
    if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
    if (typeof data.sessionId === 'string') this.sessionId = data.sessionId;
    if (typeof data.build === 'string') this.build = data.build;
    if (typeof data.breadcrumbCap === 'number') this.breadcrumbCap = data.breadcrumbCap;
    if (typeof data.spoolCap === 'number') this.spoolCap = data.spoolCap;
    if (Array.isArray(data.breadcrumbs)) {
      this.breadcrumbs = data.breadcrumbs.filter((b: unknown) => typeof b === 'string');
    }
    if (Array.isArray(data.spool)) {
      this.spool = data.spool.filter((r: unknown) => typeof r === 'object' && r !== null) as CrashReport[];
    }
  }
}
