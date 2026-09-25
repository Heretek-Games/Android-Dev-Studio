/**
 * HarnessTrace — structured per-call telemetry for the AI harness pipeline.
 *
 * Records the full lifecycle of every LLM generation call so breakdowns can be
 * localized to a specific pipeline stage:
 *   request -> transport -> parse -> apply -> outcome
 *
 * Records are exposed:
 *   - in-memory on `window.__HARNESS_TRACE__` (machine-readable for QA automation)
 *   - mirrored to localStorage key `harness-trace` (capped ring buffer)
 *
 * This deliberately never stores API keys or full request headers — only
 * metadata, counts, timings and previews.
 */

export type HarnessCallKind = 'generate' | 'self-heal';

export type HarnessOutcome =
  | 'llm-success'     // LLM returned parseable actions that all applied cleanly
  | 'parse-degraded'  // transport OK but response JSON could not be parsed
  | 'apply-error'     // actions parsed but one or more failed to apply
  | 'fallback'        // transport/other failure, local heuristic fallback engaged
  | 'transport-error'; // transport failed and no fallback available

export type HarnessActionStatus = 'applied' | 'target-missing' | 'invalid' | 'error';

export interface HarnessActionOutcome {
  index: number;
  type: string;
  target?: string;
  status: HarnessActionStatus;
  detail: string;
}

export interface HarnessTransportInfo {
  httpStatus: number | null;
  latencyMs: number | null;
  promptTokens?: number;
  completionTokens?: number;
  /** finish_reason from the provider — 'length' signals max_tokens truncation. */
  finishReason?: string;
  reasoningChars: number;
  contentChars: number;
  error?: string;
}

export interface HarnessParseInfo {
  strategy: 'codeblock' | 'raw' | 'salvaged' | 'none';
  ok: boolean;
  error?: string;
  /** True when the provider response was truncated (finish_reason=length). */
  truncated?: boolean;
  actionCount: number;
  actionTypeCounts: Record<string, number>;
  summaryPreview?: string;
}

export interface HarnessApplyInfo {
  outcomes: HarnessActionOutcome[];
  applied: number;
  targetMissing: number;
  invalid: number;
  failed: number;
}

export interface HarnessTraceRecord {
  id: string;
  kind: HarnessCallKind;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  model: string;
  promptPreview: string;
  promptChars: number;
  sceneObjectCount: number;
  transport: HarnessTransportInfo;
  parse: HarnessParseInfo;
  apply: HarnessApplyInfo;
  outcome: HarnessOutcome;
  outcomeReason?: string;
}

const STORAGE_KEY = 'harness-trace';
const MAX_RECORDS = 50;

class HarnessTraceStore {
  private records: HarnessTraceRecord[] = [];

  constructor() {
    // Rehydrate prior records (survives reloads) for comparable run telemetry.
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) this.records = JSON.parse(raw);
      }
    } catch {
      this.records = [];
    }
    this.expose();
  }

  public record(rec: HarnessTraceRecord): HarnessTraceRecord {
    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
      }
    } catch {
      // Storage quota/privacy mode — in-memory trace still works.
    }
    this.expose();
    return rec;
  }

  public getAll(): HarnessTraceRecord[] {
    return [...this.records];
  }

  public getLast(): HarnessTraceRecord | null {
    return this.records.length ? this.records[this.records.length - 1] : null;
  }

  public clear(): void {
    this.records = [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    this.expose();
  }

  /** Publish the trace to window for QA automation (chrome-devtools). */
  private expose(): void {
    try {
      if (typeof window !== 'undefined') {
        window.__HARNESS_TRACE__ = this.records;
      }
    } catch {
      // ignore
    }
  }
}

export const harnessTrace = new HarnessTraceStore();

declare global {
  interface Window {
    __HARNESS_TRACE__?: HarnessTraceRecord[];
  }
}
