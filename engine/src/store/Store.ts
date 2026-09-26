/**
 * Store services: provider interface + deterministic fake backend
 * (Track 3, ADR-1790381974860).
 *
 * OpenIAP-shaped vocabulary (init/fetch/purchase/validate/finish) over a
 * Godot-plugin-style structure: one IStoreProvider interface, per-store
 * adapters later, FakeBackend now. Purchase semantics mirror Play Billing
 * (acknowledge <= 3d, consume-once) and Steam Microtxn (server verification
 * before grant). Fully headless: scripted catalog, seeded ledger,
 * injectable failure modes. Real-device proof deferred with checklist.
 */

export type ProductKind = 'consumable' | 'non_consumable' | 'subscription';

export interface StoreProduct {
  sku: string;
  kind: ProductKind;
  title: string;
  priceMicros: number;
  currency: string;
}

export type PurchaseState =
  | 'purchased'
  | 'pending'
  | 'cancelled'
  | 'failed'
  | 'refunded'
  | 'expired';

export interface PurchaseRecord {
  orderId: string;
  sku: string;
  state: PurchaseState;
  acknowledged: boolean;
  consumed: boolean;
  receipt: string;
  timestamp: number;
}

export interface AuthState {
  signedIn: boolean;
  playerId: string;
  displayName: string;
}

export interface IStoreProvider {
  readonly backendName: string;
  signIn(interactive: boolean): Promise<AuthState>;
  signOut(): Promise<void>;
  authState(): AuthState;
  unlockAchievement(id: string): Promise<boolean>;
  showAchievements(): Promise<void>;
  submitScore(leaderboardId: string, score: number): Promise<boolean>;
  showLeaderboard(leaderboardId: string): Promise<void>;
  cloudPut(slot: string, data: string): Promise<boolean>;
  cloudGet(slot: string): Promise<string | null>;
  fetchProducts(skus: string[]): Promise<StoreProduct[]>;
  purchase(sku: string): Promise<PurchaseRecord>;
  restorePurchases(): Promise<PurchaseRecord[]>;
  consume(orderId: string): Promise<boolean>;
  acknowledge(orderId: string): Promise<boolean>;
}

export interface FakeBackendOptions {
  catalog?: StoreProduct[];
  /** Latency ms per call (0 = synchronous-ish). Default 0. */
  latencyMs?: number;
  /** Fail the next N calls of each method with 'failed'. Default 0. */
  failNext?: number;
  /** Purchases resolve to this state instead of purchased. Default purchased. */
  forcedState?: PurchaseState;
  seed?: number;
}

/**
 * Deterministic fake backend: scripted catalog, seeded order ids, ledger
 * with acknowledge/consume-once semantics, injectable failures. The
 * headless stand-in for Play Billing / Steam adapters (same interface).
 */
export class FakeStoreBackend implements IStoreProvider {
  public readonly backendName = 'fake';
  public latencyMs: number = 0;

  private catalog: Map<string, StoreProduct> = new Map();
  private ledger: Map<string, PurchaseRecord> = new Map();
  private auth: AuthState = { signedIn: false, playerId: '', displayName: '' };
  private achievements: Set<string> = new Set();
  private scores: Map<string, number> = new Map();
  private cloud: Map<string, string> = new Map();
  private failBudget: number = 0;
  private forcedState: PurchaseState = 'purchased';
  private orderCounter: number = 0;
  private seedState: number;

  constructor(options?: FakeBackendOptions) {
    for (const product of options?.catalog ?? []) {
      this.catalog.set(product.sku, { ...product });
    }
    if (options?.latencyMs !== undefined) this.latencyMs = options.latencyMs;
    if (options?.failNext !== undefined) this.failBudget = options.failNext;
    if (options?.forcedState !== undefined) this.forcedState = options.forcedState;
    this.seedState = (options?.seed ?? 42) >>> 0;
  }

  private nextOrderId(): string {
    this.seedState = (Math.imul(this.seedState, 1664525) + 1013904223) >>> 0;
    this.orderCounter++;
    return `fake-order-${this.orderCounter}-${this.seedState.toString(16)}`;
  }

  private async gate<T>(work: () => T): Promise<T> {
    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }
    if (this.failBudget > 0) {
      this.failBudget--;
      throw new Error('fake backend injected failure');
    }
    return work();
  }

  public async signIn(_interactive: boolean): Promise<AuthState> {
    return this.gate(() => {
      this.auth = { signedIn: true, playerId: 'fake-player-1', displayName: 'Fake Player' };
      return { ...this.auth };
    });
  }

  public async signOut(): Promise<void> {
    await this.gate(() => {
      this.auth = { signedIn: false, playerId: '', displayName: '' };
    });
  }

  public authState(): AuthState {
    return { ...this.auth };
  }

  public async unlockAchievement(id: string): Promise<boolean> {
    return this.gate(() => {
      if (!this.auth.signedIn) return false;
      this.achievements.add(id);
      return true;
    });
  }

  public async showAchievements(): Promise<void> {
    await this.gate(() => undefined);
  }

  public async submitScore(leaderboardId: string, score: number): Promise<boolean> {
    return this.gate(() => {
      if (!this.auth.signedIn || !Number.isFinite(score)) return false;
      const best = this.scores.get(leaderboardId);
      if (best === undefined || score > best) this.scores.set(leaderboardId, score);
      return true;
    });
  }

  public async showLeaderboard(_leaderboardId: string): Promise<void> {
    await this.gate(() => undefined);
  }

  public bestScore(leaderboardId: string): number | null {
    return this.scores.get(leaderboardId) ?? null;
  }

  public hasAchievement(id: string): boolean {
    return this.achievements.has(id);
  }

  public async cloudPut(slot: string, data: string): Promise<boolean> {
    return this.gate(() => {
      if (!slot) return false;
      this.cloud.set(slot, data);
      return true;
    });
  }

  public async cloudGet(slot: string): Promise<string | null> {
    return this.gate(() => this.cloud.get(slot) ?? null);
  }

  public async fetchProducts(skus: string[]): Promise<StoreProduct[]> {
    return this.gate(() => skus.flatMap(sku => {
      const product = this.catalog.get(sku);
      return product ? [{ ...product }] : [];
    }));
  }

  public async purchase(sku: string): Promise<PurchaseRecord> {
    return this.gate(() => {
      const product = this.catalog.get(sku);
      if (!product) {
        return {
          orderId: '', sku, state: 'failed' as PurchaseState,
          acknowledged: false, consumed: false, receipt: '', timestamp: Date.now()
        };
      }
      const record: PurchaseRecord = {
        orderId: this.nextOrderId(),
        sku,
        state: this.forcedState,
        acknowledged: false,
        consumed: false,
        receipt: `fake-receipt:${sku}`,
        timestamp: Date.now()
      };
      this.ledger.set(record.orderId, record);
      return { ...record };
    });
  }

  public async restorePurchases(): Promise<PurchaseRecord[]> {
    return this.gate(() => [...this.ledger.values()]
      .filter(r => r.state === 'purchased' && !r.consumed)
      .map(r => ({ ...r })));
  }

  public async consume(orderId: string): Promise<boolean> {
    return this.gate(() => {
      const record = this.ledger.get(orderId);
      if (!record || record.state !== 'purchased' || record.consumed) return false;
      const product = this.catalog.get(record.sku);
      if (product && product.kind !== 'consumable') return false;
      record.consumed = true;
      return true;
    });
  }

  public async acknowledge(orderId: string): Promise<boolean> {
    return this.gate(() => {
      const record = this.ledger.get(orderId);
      if (!record || record.state !== 'purchased' || record.acknowledged) return false;
      record.acknowledged = true;
      return true;
    });
  }

  /** Test introspection: ledger size. */
  public get ledgerSize(): number {
    return this.ledger.size;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'FakeStoreBackend',
      catalog: [...this.catalog.values()],
      ledger: [...this.ledger.values()],
      auth: { ...this.auth },
      achievements: [...this.achievements],
      scores: Object.fromEntries(this.scores),
      cloud: Object.fromEntries(this.cloud)
    };
  }

  public fromJSON(data: Record<string, any>): void {
    this.catalog.clear();
    for (const product of data.catalog ?? []) {
      if (product && typeof product.sku === 'string') this.catalog.set(product.sku, { ...product });
    }
    this.ledger.clear();
    for (const record of data.ledger ?? []) {
      if (record && typeof record.orderId === 'string') this.ledger.set(record.orderId, { ...record });
    }
    if (data.auth) this.auth = { ...data.auth };
    this.achievements = new Set(data.achievements ?? []);
    this.scores = new Map(Object.entries(data.scores ?? {}).map(([k, v]) => [k, Number(v)]));
    this.cloud = new Map(Object.entries(data.cloud ?? {}).map(([k, v]) => [k, String(v)]));
  }
}
