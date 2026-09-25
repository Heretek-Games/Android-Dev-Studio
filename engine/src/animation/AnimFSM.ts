import { Component } from '../core/Component.js';
import { ModelRenderer } from '../components/ModelRenderer.js';

export type AnimConditionOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'trigger';

export interface AnimCondition {
  param: string;
  op: AnimConditionOp;
  /** Compared value (ignored for trigger ops). */
  value?: number;
}

export interface AnimState {
  /** Clip name (resolved on the sibling ModelRenderer mixer when present). */
  clip: string;
  /** Loop the clip. Default true. */
  loop?: boolean;
  /** Headless/override clip length in seconds (mixer length wins when bound). */
  clipLength?: number;
}

export interface AnimTransition {
  from: string;
  to: string;
  conditions?: AnimCondition[];
  /** Normalized state time (0..1) before the transition may fire. Default 0. */
  exitTime?: number;
  /** Cross-fade seconds. Default 0.25. */
  duration?: number;
}

export interface AnimFSMOptions {
  states?: Record<string, AnimState>;
  transitions?: AnimTransition[];
  /** Entry state. Defaults to the first declared state. */
  initial?: string;
  params?: Record<string, number>;
}

/** Boundary tolerance for IEEE754 normalized-time accumulation. */
const EXIT_EPSILON = 1e-9;

/**
 * Animation state machine (Track 1.7, ADR-1790374021375).
 *
 * Unity-transition + Godot-travel() semantics as a thin policy over the
 * ADOPTED three.js mixer: states name clips, transitions gate on parameter
 * comparisons (+ normalized exit times), and entry calls the sibling
 * ModelRenderer.playAnimation once with the cross-fade duration — the mixer
 * then advances untouched. Fully headless-steppable: clip lengths resolve
 * from the bound mixer when present, else from per-state clipLength
 * overrides (default 1s). Triggers are one-shot (consumed when a transition fires).
 */
export class AnimFSM extends Component {
  public states: Record<string, AnimState> = {};
  public transitions: AnimTransition[] = [];
  public current: string = '';
  public stateTime: number = 0;
  public params: Map<string, number> = new Map();
  public transitionsTaken: number = 0;
  public lastTransition: { from: string; to: string } | null = null;

  private triggers: Set<string> = new Set();

  constructor(options?: AnimFSMOptions) {
    super();
    if (options) {
      if (options.states) this.states = JSON.parse(JSON.stringify(options.states));
      if (options.transitions) {
        this.transitions = options.transitions.map(t => ({
          from: t.from,
          to: t.to,
          conditions: t.conditions ? [...t.conditions] : [],
          exitTime: t.exitTime ?? 0,
          duration: t.duration ?? 0.25
        }));
      }
      const names = Object.keys(this.states);
      this.current = options.initial ?? names[0] ?? '';
      if (options.params) {
        for (const [k, v] of Object.entries(options.params)) this.params.set(k, v);
      }
    }
  }

  public setFloat(param: string, value: number): void {
    this.params.set(param, value);
  }

  public setBool(param: string, value: boolean): void {
    this.params.set(param, value ? 1 : 0);
  }

  /** One-shot condition (Unity parity: consumed when a transition fires). */
  public setTrigger(param: string): void {
    this.triggers.add(param);
  }

  public getFloat(param: string): number {
    return this.params.get(param) ?? 0;
  }

  /** Length of the current clip: bound mixer wins, else the state override. */
  public currentClipLength(): number {
    const state = this.states[this.current];
    const mixerLength = this.mixerClipLength(state?.clip ?? '');
    if (mixerLength !== null) return mixerLength;
    return state?.clipLength ?? 1.0;
  }

  private mixerClipLength(clip: string): number | null {
    if (!clip) return null;
    const model = this.gameObject.getComponent(ModelRenderer);
    const length = model?.animations.get(clip)?.duration;
    return typeof length === 'number' && length > 0 ? length : null;
  }

  private checkCondition(cond: AnimCondition): boolean {
    if (cond.op === 'trigger') {
      return this.triggers.has(cond.param);
    }
    const actual = this.params.get(cond.param) ?? 0;
    const expected = cond.value ?? 0;
    switch (cond.op) {
      case '==': return actual === expected;
      case '!=': return actual !== expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
    }
  }

  public override start(): void {
    this.enter(this.current, 0);
  }

  private enter(state: string, fadeDuration: number): void {
    if (!this.states[state]) return;
    this.current = state;
    this.stateTime = 0;
    const target = this.states[state];
    const model = this.gameObject.getComponent(ModelRenderer);
    if (model && target.clip) {
      model.playAnimation(target.clip, fadeDuration);
    }
  }

  public override update(deltaTime: number): void {
    if (!this.current || !this.states[this.current]) return;
    this.stateTime += deltaTime;
    const clipLength = this.currentClipLength();
    const normalized = clipLength > 0 ? this.stateTime / clipLength : 1;

    for (const t of this.transitions) {
      if (t.from !== '*' && t.from !== this.current) continue;
      if (!this.states[t.to]) continue;
      const exitTime = t.exitTime ?? 0;
      if (normalized + EXIT_EPSILON < exitTime) continue;
      const conditions = t.conditions ?? [];
      let met = true;
      for (const cond of conditions) {
        if (!this.checkCondition(cond)) {
          met = false;
          break;
        }
      }
      if (!met) continue;
      const from = this.current;
      this.enter(t.to, t.duration ?? 0.25);
      this.transitionsTaken++;
      this.lastTransition = { from, to: t.to };
      // Unity parity: firing consumes all pending triggers; unfired
      // triggers persist to the next evaluation instead of vanishing.
      this.triggers.clear();
      break; // one transition per evaluation, Unity parity
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'AnimFSM',
      enabled: this.enabled,
      states: this.states,
      transitions: this.transitions,
      current: this.current,
      stateTime: this.stateTime,
      params: Object.fromEntries(this.params.entries()),
      transitionsTaken: this.transitionsTaken,
      lastTransition: this.lastTransition
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.states) this.states = data.states;
    if (data.transitions) this.transitions = data.transitions;
    if (typeof data.current === 'string') this.current = data.current;
    if (typeof data.stateTime === 'number') this.stateTime = data.stateTime;
    if (data.params) {
      this.params.clear();
      for (const [k, v] of Object.entries(data.params)) this.params.set(k, v as number);
    }
    if (typeof data.transitionsTaken === 'number') this.transitionsTaken = data.transitionsTaken;
    if (data.lastTransition !== undefined) this.lastTransition = data.lastTransition;
  }
}
