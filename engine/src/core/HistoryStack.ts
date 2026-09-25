/**
 * Bounded undo/redo stack over opaque scene snapshots (Track 1.2).
 *
 * Stores JSON strings (KBs per scene); no per-operation inverses needed, so
 * every studio edit is undoable uniformly. Pure logic — the app layer pushes
 * `JSON.stringify(scene.toJSON())` before each mutation and restores via
 * `scene.fromJSON(JSON.parse(...))` on undo/redo.
 */
export class HistoryStack {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  constructor(private readonly capacity: number = 50) {}

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoDepth(): number {
    return this.undoStack.length;
  }

  /** Records the pre-mutation state; clears the redo branch. */
  public checkpoint(snapshot: string): void {
    this.pushUndo(snapshot);
    this.redoStack = [];
  }

  /** Pushes onto the undo branch without touching redo (redo navigation). */
  public pushUndo(snapshot: string): void {
    this.undoStack.push(snapshot);
    while (this.undoStack.length > this.capacity) {
      this.undoStack.shift();
    }
  }

  /**
   * Pops the last checkpoint for restore. Returns null when empty.
   * The caller pushes the current state to the redo branch first via
   * `stageRedo`.
   */
  public popUndo(): string | null {
    return this.undoStack.pop() ?? null;
  }

  public stageRedo(snapshot: string): void {
    this.redoStack.push(snapshot);
  }

  public popRedo(): string | null {
    return this.redoStack.pop() ?? null;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
