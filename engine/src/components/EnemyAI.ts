/**
 * EnemyAI — behavior-tree driven arena enemy.
 *
 * Priority: attack the target when in range (rate-limited), chase it inside the
 * aggro radius, otherwise idle. Damage is applied through the target's
 * `HealthComponent`, so the component stays decoupled from weapons/event sheets.
 */

import { Component } from '../core/Component.js';
import {
  AttackNode,
  BehaviorTreeComponent,
  BTStatus,
  DistanceCheckNode,
  MoveTowardsNode,
  SelectorNode,
  SequenceNode,
  type BTNode
} from '../ai/BehaviorTree.js';
import { HealthComponent } from './HealthComponent.js';

export interface EnemyAIOptions {
  targetName?: string;
  moveSpeed?: number;
  stopDistance?: number;
  aggroRange?: number;
  attackRange?: number;
  attackDamage?: number;
  attackIntervalSeconds?: number;
}

export class EnemyAI extends Component {
  public targetName: string;
  public moveSpeed: number;
  public stopDistance: number;
  public aggroRange: number;
  public attackRange: number;
  public attackDamage: number;
  public attackIntervalSeconds: number;

  public attacksLanded = 0;
  public lastStatus: BTStatus = BTStatus.SUCCESS;

  private tree: BehaviorTreeComponent;

  constructor(options: EnemyAIOptions = {}) {
    super();
    this.targetName = options.targetName ?? 'Player Hero';
    this.moveSpeed = options.moveSpeed ?? 2.5;
    this.stopDistance = options.stopDistance ?? 1.6;
    this.aggroRange = options.aggroRange ?? 18;
    this.attackRange = options.attackRange ?? 2.2;
    this.attackDamage = options.attackDamage ?? 10;
    this.attackIntervalSeconds = options.attackIntervalSeconds ?? 1.0;

    this.tree = new BehaviorTreeComponent(this.buildTree());
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.gameObject.active) return;
    this.tree.gameObject = this.gameObject;
    this.lastStatus = this.tree.root ? this.tree.root.tick(this.gameObject, deltaTime) : BTStatus.SUCCESS;
  }

  /** Attack the current target through its HealthComponent (if any). */
  public attackTarget(target: import('../core/GameObject.js').GameObject): void {
    const health = target.getComponent(HealthComponent);
    if (!health) return;
    const applied = health.takeDamage(this.attackDamage, this.gameObject);
    if (applied > 0) this.attacksLanded += 1;
  }

  /**
   * Retarget the behavior tree (Track E.6): node targets bake at build, so
   * reassigning targetName alone never redirects aggro — rebuild instead.
   * Party systems call this when the active hero swaps.
   */
  public retarget(targetName: string): void {
    if (!targetName || targetName === this.targetName) return;
    this.targetName = targetName;
    this.tree = new BehaviorTreeComponent(this.buildTree());
  }

  private buildTree(): BTNode {
    return new SelectorNode([
      new AttackNode(this.targetName, this.attackRange, (actor, target) => this.attackTarget(target), this.attackIntervalSeconds),
      new SequenceNode([
        new DistanceCheckNode(this.targetName, this.aggroRange, 'less'),
        new MoveTowardsNode(this.targetName, this.moveSpeed, this.stopDistance)
      ])
    ]);
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'EnemyAI',
      enabled: this.enabled,
      targetName: this.targetName,
      moveSpeed: this.moveSpeed,
      attackRange: this.attackRange,
      attackDamage: this.attackDamage,
      attackIntervalSeconds: this.attackIntervalSeconds
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.targetName !== undefined) this.targetName = data.targetName;
    if (data.moveSpeed !== undefined) this.moveSpeed = data.moveSpeed;
    if (data.stopDistance !== undefined) this.stopDistance = data.stopDistance;
    if (data.aggroRange !== undefined) this.aggroRange = data.aggroRange;
    if (data.attackRange !== undefined) this.attackRange = data.attackRange;
    if (data.attackDamage !== undefined) this.attackDamage = data.attackDamage;
    if (data.attackIntervalSeconds !== undefined) {
      this.attackIntervalSeconds = data.attackIntervalSeconds;
    }
    // Behavior-tree nodes capture tunables at construction; rebuild so the
    // restored values actually drive.
    this.tree = new BehaviorTreeComponent(this.buildTree());
  }
}
