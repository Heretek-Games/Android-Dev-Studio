/**
 * EconomyTick — fixed-step economic and logistics simulation loop, decoupled
 * from the visual frame rate.
 *
 * Visual frames call `advance(realDeltaSeconds)` at whatever cadence they run;
 * the economic simulation always advances in fixed `stepSeconds` increments
 * (accumulator pattern), so resource totals are frame-rate independent and
 * deterministic for a given total elapsed time.
 *
 * Rules declare a cadence (`intervalSeconds`), resource effects, and optional
 * prerequisites. Every rule evaluation emits a structured event for telemetry
 * and QA assertions.
 *
 * Pure compute subsystem: depends on nothing outside itself (Strict Decoupling).
 */

export interface ResourceEffect {
  resource: string;
  delta: number;
}

export interface ResourceRequirement {
  resource: string;
  min: number;
}

export interface EconomyRule {
  id: string;
  /** How often (in simulated seconds) this rule fires. */
  intervalSeconds: number;
  effects: ResourceEffect[];
  /** Rule only fires when every requirement is satisfied. */
  requires?: ResourceRequirement[];
  enabled?: boolean;
  label?: string;
}

export interface EconomyEvent {
  tick: number;
  simTime: number;
  ruleId: string;
  applied: boolean;
  reason?: 'disabled' | 'prerequisites-unmet' | 'applied';
}

export interface EconomyAdvanceResult {
  stepsRun: number;
  simTime: number;
  events: EconomyEvent[];
}

interface RuleState {
  rule: EconomyRule;
  nextFireAt: number;
  fireCount: number;
}

export class EconomyTick {
  private resources: Map<string, number> = new Map();
  private rules: Map<string, RuleState> = new Map();
  private accumulator = 0;
  private simTime = 0;
  private tick = 0;

  constructor(private readonly stepSeconds: number = 1.0) {
    if (stepSeconds <= 0) throw new Error('EconomyTick stepSeconds must be > 0');
  }

  // ---- Resource accessors --------------------------------------------------

  public set(resource: string, value: number): void {
    this.resources.set(resource, value);
  }

  public get(resource: string): number {
    return this.resources.get(resource) ?? 0;
  }

  public all(): Record<string, number> {
    return Object.fromEntries(this.resources.entries());
  }

  // ---- Rule management -----------------------------------------------------

  public addRule(rule: EconomyRule): void {
    if (rule.intervalSeconds <= 0) throw new Error(`Rule "${rule.id}" intervalSeconds must be > 0`);
    this.rules.set(rule.id, {
      rule,
      nextFireAt: this.simTime + rule.intervalSeconds,
      fireCount: 0
    });
  }

  public removeRule(id: string): void {
    this.rules.delete(id);
  }

  public getRuleFireCount(id: string): number {
    return this.rules.get(id)?.fireCount ?? 0;
  }

  // ---- Simulation ----------------------------------------------------------

  /**
   * Advances the economy by a real (frame) delta, running as many fixed
   * economic steps as the accumulator allows.
   */
  public advance(realDeltaSeconds: number): EconomyAdvanceResult {
    if (realDeltaSeconds < 0) throw new Error('advance() requires a non-negative delta');
    this.accumulator += realDeltaSeconds;
    let stepsRun = 0;
    const events: EconomyEvent[] = [];

    while (this.accumulator >= this.stepSeconds) {
      this.accumulator -= this.stepSeconds;
      this.simTime += this.stepSeconds;
      this.tick++;
      stepsRun++;
      this.runStep(events);
    }

    return { stepsRun, simTime: this.simTime, events };
  }

  private runStep(events: EconomyEvent[]): void {
    for (const state of this.rules.values()) {
      if (this.simTime + 1e-9 < state.nextFireAt) continue;
      // Keep cadence anchored to the rule interval, not the frame boundary.
      state.nextFireAt += state.rule.intervalSeconds;

      if (state.rule.enabled === false) {
        events.push({ tick: this.tick, simTime: this.simTime, ruleId: state.rule.id, applied: false, reason: 'disabled' });
        continue;
      }

      const unmet = (state.rule.requires ?? []).find(req => this.get(req.resource) < req.min);
      if (unmet) {
        events.push({ tick: this.tick, simTime: this.simTime, ruleId: state.rule.id, applied: false, reason: 'prerequisites-unmet' });
        continue;
      }

      for (const effect of state.rule.effects) {
        this.set(effect.resource, this.get(effect.resource) + effect.delta);
      }
      state.fireCount++;
      events.push({ tick: this.tick, simTime: this.simTime, ruleId: state.rule.id, applied: true, reason: 'applied' });
    }
  }

  public getSimTime(): number {
    return this.simTime;
  }

  public getTick(): number {
    return this.tick;
  }
}
