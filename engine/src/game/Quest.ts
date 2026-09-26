/**
 * Quest — ordered stage tracker for quest chains (Track E.4).
 *
 * Game-layer primitive (beside GameSession, not a scene Component):
 * stages of objectives evaluated against a plain QuestProgress snapshot
 * supplied by game code each frame. Dialogue, combat, and exploration stay
 * decoupled — they produce flags/kills/phase; the quest only reads them
 * (Godot signals-and-Resources canon, data-driven). Stage and completion
 * listeners feed UI and the generation loop; JSON round-trips through
 * SaveSystem.
 */

export type QuestObjectiveKind = 'flag' | 'kills' | 'reactions' | 'phase' | 'stage';

export interface QuestObjective {
  id: string;
  kind: QuestObjectiveKind;
  /** Flag name, phase name, or nested stage id (kind-dependent). */
  target: string;
  /** Required count for kills/reactions (default 1). */
  count?: number;
}

export interface QuestStage {
  id: string;
  objectives: QuestObjective[];
}

export interface QuestProgress {
  flags: string[];
  kills: number;
  reactions: number;
  /** Session flow phase (e.g. 'won'). */
  phase: string;
}

export interface QuestSpec {
  id: string;
  stages: QuestStage[];
}

export class Quest {
  public readonly id: string;
  public readonly stages: QuestStage[];
  public completedStageIds: string[] = [];
  public complete: boolean = false;

  private stageListeners: Set<(stageId: string) => void> = new Set();
  private completeListeners: Set<() => void> = new Set();

  constructor(spec: QuestSpec) {
    this.id = spec.id;
    this.stages = (spec.stages || []).map(stage => ({
      id: stage.id,
      objectives: (stage.objectives || []).map(objective => ({
        id: objective.id,
        kind: objective.kind,
        target: objective.target,
        count: objective.count ?? 1
      }))
    }));
  }

  public get stageIndex(): number {
    return this.completedStageIds.length;
  }

  public currentStage(): QuestStage | null {
    return this.stages[this.completedStageIds.length] ?? null;
  }

  public onStage(listener: (stageId: string) => void): () => void {
    this.stageListeners.add(listener);
    return () => this.stageListeners.delete(listener);
  }

  public onComplete(listener: () => void): () => void {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }

  private objectiveMet(objective: QuestObjective, progress: QuestProgress): boolean {
    switch (objective.kind) {
      case 'flag':
        return progress.flags.includes(objective.target);
      case 'kills':
        return progress.kills >= Math.max(1, objective.count ?? 1);
      case 'reactions':
        return progress.reactions >= Math.max(1, objective.count ?? 1);
      case 'phase':
        return progress.phase === objective.target;
      case 'stage':
        return this.completedStageIds.includes(objective.target);
      default:
        return false;
    }
  }

  /**
   * Evaluate the current stage against fresh progress. Completes at most
   * one stage per call (ordered chains stay ordered); returns the newly
   * completed stage id, if any.
   */
  public update(progress: QuestProgress): string | null {
    if (this.complete) return null;
    const stage = this.currentStage();
    if (!stage) {
      this.complete = true;
      for (const listener of this.completeListeners) {
        try {
          listener();
        } catch {
          // listener errors must never break the quest
        }
      }
      return null;
    }
    const done = stage.objectives.every(objective => this.objectiveMet(objective, progress));
    if (!done) return null;
    this.completedStageIds.push(stage.id);
    for (const listener of this.stageListeners) {
      try {
        listener(stage.id);
      } catch {
        // listener errors must never break the quest
      }
    }
    if (this.completedStageIds.length >= this.stages.length) {
      this.complete = true;
      for (const listener of this.completeListeners) {
        try {
          listener();
        } catch {
          // listener errors must never break the quest
        }
      }
    }
    return stage.id;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'Quest',
      id: this.id,
      stages: this.stages,
      completedStageIds: [...this.completedStageIds],
      complete: this.complete
    };
  }

  public static fromJSON(data: Record<string, any>): Quest {
    const quest = new Quest({ id: data.id ?? 'quest', stages: data.stages ?? [] });
    quest.completedStageIds = Array.isArray(data.completedStageIds) ? [...data.completedStageIds] : [];
    quest.complete = data.complete === true;
    return quest;
  }
}
