/**
 * SceneStore — client for the harness scene store (source of truth).
 *
 * GET  /api/scene -> harness/scenes/active_scene.json
 * POST /api/scene -> transactional invariant gate + persist + memory snapshot
 *
 * All docks and panels that inspect or mutate the canonical scene go through
 * this service so app edits and agent/MCP edits share identical guardrails.
 */

export interface HarnessSceneEvent {
  name: string;
  conditions?: Array<{ type: string; params?: Record<string, unknown> }>;
  actions?: Array<{ type: string; params?: Record<string, unknown> }>;
}

export interface HarnessSceneObject {
  name: string;
  kind?: 'mesh' | 'model' | 'terrain' | 'light';
  shape?: string;
  size?: number[];
  position?: number[];
  rotation?: number[];
  scale?: number[];
  color?: string;
  physics?: 'dynamic' | 'fixed' | 'none';
  mass?: number;
  controller?: boolean;
  events?: HarnessSceneEvent[];
  lightType?: string;
  intensity?: number;
  modelUrl?: string;
  batched?: boolean;
  [key: string]: unknown;
}

export interface HarnessScene {
  id?: string;
  name?: string;
  goal?: string;
  gameObjects: HarnessSceneObject[];
  rules?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SceneSaveResult {
  ok: boolean;
  error: string | null;
}

type SceneListener = (scene: HarnessScene) => void;

class SceneStoreService {
  private listeners: Set<SceneListener> = new Set();
  private cached: HarnessScene | null = null;

  /** Fetch the canonical scene from the harness store. */
  public async fetchScene(): Promise<HarnessScene> {
    const res = await fetch('/api/scene');
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error || `Scene store HTTP ${res.status}`);
    }
    const scene: HarnessScene = await res.json();
    this.cached = scene;
    return scene;
  }

  /**
   * Persist a scene through the transactional invariant gate.
   * Returns { ok: false, error } when the gate rejects the write (HTTP 409).
   */
  public async saveScene(scene: HarnessScene): Promise<SceneSaveResult> {
    const res = await fetch('/api/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene)
    });
    const result: SceneSaveResult = await res.json().catch(() => ({
      ok: res.ok,
      error: res.ok ? null : `HTTP ${res.status}`
    }));
    if (result.ok) {
      this.cached = scene;
      this.notify(scene);
    }
    return result;
  }

  /** Mutate + save in one call: the mutator receives a deep copy to edit. */
  public async mutate(mutator: (scene: HarnessScene) => void): Promise<SceneSaveResult> {
    const scene = this.cached ?? (await this.fetchScene());
    const draft: HarnessScene = JSON.parse(JSON.stringify(scene));
    mutator(draft);
    return this.saveScene(draft);
  }

  public getCached(): HarnessScene | null {
    return this.cached;
  }

  /** Subscribe to successful saves (e.g. docks refresh their stats). */
  public subscribe(listener: SceneListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(scene: HarnessScene): void {
    for (const listener of this.listeners) {
      try {
        listener(scene);
      } catch {
        // listeners must never break the save path
      }
    }
  }
}

export const sceneStore = new SceneStoreService();
