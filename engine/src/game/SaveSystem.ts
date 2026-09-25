/**
 * SaveSystem — slot-based save/load for game sessions.
 *
 * Storage is injectable (`StorageAdapter`); the default is `localStorage` in the
 * browser and an in-memory store headless (tests, QA). Corrupt or version-mismatched
 * payloads load as `null` with an explicit `lastError` — never a silent partial restore.
 */

import type { GameSessionSnapshot } from './GameSession.js';

export const SAVE_VERSION = 1;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }

  public get size(): number {
    return this.values.size;
  }
}

export interface SaveEnvelope {
  version: number;
  savedAt: number;
  slot: string;
  session: GameSessionSnapshot;
  /** Optional extra payload (scene deltas, inventory, …). */
  data?: Record<string, unknown>;
}

export class SaveSystem {
  private lastError: string | null = null;

  constructor(
    private readonly storage: StorageAdapter = SaveSystem.defaultStorage(),
    private readonly prefix: string = 'heretek.save.'
  ) {}

  /** localStorage when available, otherwise an in-memory adapter (headless). */
  public static defaultStorage(): StorageAdapter {
    const scope = globalThis as unknown as { localStorage?: StorageAdapter };
    return scope.localStorage ?? new MemoryStorage();
  }

  public save(slot: string, session: GameSessionSnapshot, data?: Record<string, unknown>): boolean {
    if (!slot) {
      this.lastError = 'save slot must be a non-empty string';
      return false;
    }
    const envelope: SaveEnvelope = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      slot,
      session,
      ...(data ? { data } : {})
    };
    try {
      this.storage.setItem(this.prefix + slot, JSON.stringify(envelope));
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = `storage write failed: ${String(error)}`;
      return false;
    }
  }

  public load(slot: string): SaveEnvelope | null {
    const raw = this.storage.getItem(this.prefix + slot);
    if (raw === null) {
      this.lastError = `no save in slot "${slot}"`;
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.lastError = `corrupt save in slot "${slot}": ${String(error)}`;
      return null;
    }
    const envelope = parsed as Partial<SaveEnvelope>;
    if (typeof envelope !== 'object' || envelope === null || typeof envelope.session !== 'object' || envelope.session === null) {
      this.lastError = `malformed save envelope in slot "${slot}"`;
      return null;
    }
    if (envelope.version !== SAVE_VERSION) {
      this.lastError = `unsupported save version ${envelope.version} (expected ${SAVE_VERSION})`;
      return null;
    }
    this.lastError = null;
    return envelope as SaveEnvelope;
  }

  public list(): string[] {
    const scope = this.storage as StorageAdapter & { keys?: () => string[] };
    if (typeof scope.keys !== 'function') return [];
    return scope
      .keys()
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }

  public delete(slot: string): boolean {
    if (this.storage.getItem(this.prefix + slot) === null) {
      this.lastError = `no save in slot "${slot}"`;
      return false;
    }
    this.storage.removeItem(this.prefix + slot);
    this.lastError = null;
    return true;
  }

  public getLastError(): string | null {
    return this.lastError;
  }
}
