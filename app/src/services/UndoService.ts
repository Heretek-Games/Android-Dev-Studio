import { HistoryStack } from '@heretek/engine';
import type { Scene } from '@heretek/engine';

/**
 * Studio undo/redo over live engine scenes (Track 1.2).
 *
 * Snapshot-stack design: every mutating studio action checkpoints the scene
 * JSON first; undo/redo restore via Scene.fromJSON and refresh the viewport.
 * Snapshots are KB-scale strings capped at 50 depth — no per-operation
 * inverses, so all present and future edits are undoable uniformly.
 */
class UndoService {
  private history = new HistoryStack(50);
  private refresh: () => void = () => {};

  public bindRefresh(refresh: () => void): void {
    this.refresh = refresh;
  }

  public get canUndo(): boolean {
    return this.history.canUndo;
  }

  public get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Records pre-mutation state. Call before every studio mutation. */
  public checkpoint(scene: Scene): void {
    this.history.checkpoint(JSON.stringify(scene.toJSON()));
  }

  public undo(scene: Scene): boolean {
    const current = JSON.stringify(scene.toJSON());
    const snapshot = this.history.popUndo();
    if (snapshot === null) return false;
    this.history.stageRedo(current);
    scene.fromJSON(JSON.parse(snapshot) as Record<string, unknown>);
    this.refresh();
    return true;
  }

  public redo(scene: Scene): boolean {
    const current = JSON.stringify(scene.toJSON());
    const snapshot = this.history.popRedo();
    if (snapshot === null) return false;
    this.history.pushUndo(current);
    scene.fromJSON(JSON.parse(snapshot) as Record<string, unknown>);
    this.refresh();
    return true;
  }

  public clear(): void {
    this.history.clear();
  }
}

export const undoService = new UndoService();
