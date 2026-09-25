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
}
