import { Component } from '../core/Component.js';
import type { GameObject } from '../core/GameObject.js';

export enum BTStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  RUNNING = 'RUNNING'
}

export abstract class BTNode {
  public abstract tick(actor: GameObject, dt: number): BTStatus;
}

export class SelectorNode extends BTNode {
  public children: BTNode[] = [];

  constructor(children: BTNode[] = []) {
    super();
    this.children = children;
  }

  public override tick(actor: GameObject, dt: number): BTStatus {
    for (const child of this.children) {
      const status = child.tick(actor, dt);
      if (status !== BTStatus.FAILURE) {
        return status;
      }
    }
    return BTStatus.FAILURE;
  }
}

export class SequenceNode extends BTNode {
  public children: BTNode[] = [];

  constructor(children: BTNode[] = []) {
    super();
    this.children = children;
  }

  public override tick(actor: GameObject, dt: number): BTStatus {
    for (const child of this.children) {
      const status = child.tick(actor, dt);
      if (status !== BTStatus.SUCCESS) {
        return status;
      }
    }
    return BTStatus.SUCCESS;
  }
}

export class InverterNode extends BTNode {
  constructor(public child: BTNode) {
    super();
  }

  public override tick(actor: GameObject, dt: number): BTStatus {
    const status = this.child.tick(actor, dt);
    if (status === BTStatus.SUCCESS) return BTStatus.FAILURE;
    if (status === BTStatus.FAILURE) return BTStatus.SUCCESS;
    return BTStatus.RUNNING;
  }
}

export class DistanceCheckNode extends BTNode {
  constructor(
    public targetName: string,
    public maxDistance: number,
    public compareMode: 'less' | 'greater' = 'less'
  ) {
    super();
  }

  public override tick(actor: GameObject, _dt: number): BTStatus {
    if (!actor.scene) return BTStatus.FAILURE;
    const target = actor.scene.findByName(this.targetName);
    if (!target) return BTStatus.FAILURE;

    const p1 = actor.transform.position;
    const p2 = target.transform.position;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = p1.z - p2.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const conditionMet = this.compareMode === 'less' ? dist <= this.maxDistance : dist >= this.maxDistance;
    return conditionMet ? BTStatus.SUCCESS : BTStatus.FAILURE;
  }
}

export class MoveTowardsNode extends BTNode {
  constructor(public targetName: string, public speed: number = 3.0, public stopDistance: number = 1.5) {
    super();
  }

  public override tick(actor: GameObject, dt: number): BTStatus {
    if (!actor.scene) return BTStatus.FAILURE;
    const target = actor.scene.findByName(this.targetName);
    if (!target) return BTStatus.FAILURE;

    const p1 = actor.transform.position;
    const p2 = target.transform.position;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= this.stopDistance) {
      return BTStatus.SUCCESS;
    }

    const step = (this.speed * dt);
    const nx = (dx / dist) * Math.min(step, dist);
    const nz = (dz / dist) * Math.min(step, dist);
    actor.transform.translate(nx, 0, nz);

    return BTStatus.RUNNING;
  }
}

/**
 * Attacks the target when within range, rate-limited by a cooldown. The attack
 * itself is an injected callback, so the node stays decoupled from game systems
 * (weapons, damage routing, events).
 */
export class AttackNode extends BTNode {
  private cooldownRemaining = 0;

  constructor(
    public targetName: string,
    public range: number,
    public attack: (actor: GameObject, target: GameObject) => void,
    public intervalSeconds: number = 1.0
  ) {
    super();
  }

  public override tick(actor: GameObject, dt: number): BTStatus {
    if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    if (!actor.scene) return BTStatus.FAILURE;
    const target = actor.scene.findByName(this.targetName);
    if (!target) return BTStatus.FAILURE;

    const p1 = actor.transform.position;
    const p2 = target.transform.position;
    const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
    if (dist > this.range) return BTStatus.FAILURE;
    if (this.cooldownRemaining > 0) return BTStatus.RUNNING;

    this.attack(actor, target);
    this.cooldownRemaining = this.intervalSeconds;
    return BTStatus.SUCCESS;
  }
}

export class BehaviorTreeComponent extends Component {
  public root: BTNode | null = null;
  public lastStatus: BTStatus = BTStatus.SUCCESS;

  constructor(root?: BTNode) {
    super();
    this.root = root || this.createDefaultHordeAI();
  }

  public override update(deltaTime: number): void {
    if (this.root && this.gameObject.active) {
      this.lastStatus = this.root.tick(this.gameObject, deltaTime);
    }
  }

  private createDefaultHordeAI(): BTNode {
    // Default Doom-style AI: If player within 15m, move towards player, else idle
    return new SelectorNode([
      new SequenceNode([
        new DistanceCheckNode('Player Hero', 15.0, 'less'),
        new MoveTowardsNode('Player Hero', 3.5, 1.8)
      ])
    ]);
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'BehaviorTreeComponent',
      lastStatus: this.lastStatus
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.lastStatus) this.lastStatus = data.lastStatus;
  }
}
