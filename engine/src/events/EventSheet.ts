import { Component } from '../core/Component.js';
import { MobileInput } from '../input/MobileInput.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { MeshRenderer } from '../components/MeshRenderer.js';

export interface EventCondition {
  type: 'OnStart' | 'EveryFrame' | 'OnTouchTap' | 'OnButtonPress' | 'Timer' | 'TagNear';
  params?: Record<string, any>;
}

export interface EventAction {
  type: 'Translate' | 'RotateY' | 'ApplyImpulse' | 'SetColor' | 'Destroy' | 'SetScale';
  params?: Record<string, any>;
}

export interface VisualEvent {
  id: string;
  name: string;
  enabled: boolean;
  conditions: EventCondition[];
  actions: EventAction[];
}

/** Per-condition execution outcome (Track 1.4 debugger trace, ADR-1790372118637). */
export interface ConditionTrace {
  type: string;
  /** Outcome of the most recent evaluation (null = never evaluated). */
  lastResult: boolean | null;
  evalCount: number;
  /** Most recent outcomes, oldest-first, capped at TRACE_RING. */
  recent: boolean[];
}

/** Per-event execution record. */
export interface EventTrace {
  eventId: string;
  name: string;
  fireCount: number;
  /** Component tick of the last fire (-1 = never fired). */
  lastFireTick: number;
  evalCount: number;
  conditions: ConditionTrace[];
}

/** Ring length for per-condition recent outcomes. */
export const TRACE_RING = 8;

/** Boundary tolerance for IEEE754 timer accumulation (see Timer condition). */
const TIMER_EPSILON = 1e-9;

export class EventSheet extends Component {
  public events: VisualEvent[] = [];
  private timers: Map<string, number> = new Map();
  private hasStarted = false;
  /** Monotonic evaluation pass counter (start() + every update). */
  private tick: number = 0;
  private trace: Map<string, EventTrace> = new Map();

  constructor(events: VisualEvent[] = []) {
    super();
    this.events = events;
  }

  public override start(): void {
    this.hasStarted = true;
    this.evaluateEvents('OnStart');
  }

  public override update(deltaTime: number): void {
    this.evaluateEvents('EveryFrame', deltaTime);
  }

  public addEvent(event: VisualEvent): void {
    this.events.push(event);
  }

  public removeEvent(id: string): void {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx !== -1) this.events.splice(idx, 1);
    this.trace.delete(id);
  }

  /** Snapshot of per-event execution records (debugger + headless QA). */
  public getTrace(): EventTrace[] {
    return this.events.map(ev => this.traceFor(ev));
  }

  /** Fire count for one event by id or name (0 when unknown). */
  public fireCount(eventIdOrName: string): number {
    for (const ev of this.events) {
      if (ev.id === eventIdOrName || ev.name === eventIdOrName) {
        return this.traceFor(ev).fireCount;
      }
    }
    return 0;
  }

  /** Clears all execution records (keeps the events). */
  public resetTrace(): void {
    this.trace.clear();
    this.tick = 0;
  }

  private traceFor(ev: VisualEvent): EventTrace {
    let record = this.trace.get(ev.id);
    if (!record) {
      record = {
        eventId: ev.id,
        name: ev.name,
        fireCount: 0,
        lastFireTick: -1,
        evalCount: 0,
        conditions: ev.conditions.map(c => ({
          type: c.type,
          lastResult: null,
          evalCount: 0,
          recent: []
        }))
      };
      this.trace.set(ev.id, record);
    }
    // Keep condition slots aligned when the editor adds/removes conditions.
    while (record.conditions.length < ev.conditions.length) {
      const c = ev.conditions[record.conditions.length];
      record.conditions.push({ type: c.type, lastResult: null, evalCount: 0, recent: [] });
    }
    if (record.conditions.length > ev.conditions.length) {
      record.conditions.length = ev.conditions.length;
    }
    return record;
  }

  private evaluateEvents(triggerType: string, dt = 0): void {
    if (!this.enabled || !this.gameObject.active) return;
    this.tick++;

    for (const ev of this.events) {
      if (!ev.enabled) continue;
      const record = this.traceFor(ev);
      record.evalCount++;

      let allConditionsMet = true;
      for (let i = 0; i < ev.conditions.length; i++) {
        const result = this.checkCondition(ev.conditions[i], triggerType, dt);
        const slot = record.conditions[i];
        slot.lastResult = result;
        slot.evalCount++;
        slot.recent.push(result);
        if (slot.recent.length > TRACE_RING) slot.recent.shift();
        if (!result) {
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
        record.fireCount++;
        record.lastFireTick = this.tick;
        for (const action of ev.actions) {
          this.executeAction(action, dt);
        }
      }
    }
  }

  private checkCondition(cond: EventCondition, trigger: string, dt: number): boolean {
    switch (cond.type) {
      case 'OnStart':
        return trigger === 'OnStart';
      case 'EveryFrame':
        return trigger === 'EveryFrame';
      case 'OnButtonPress': {
        const btn = cond.params?.button || 'jump';
        return MobileInput.instance.getButton(btn);
      }
      case 'OnTouchTap':
        return MobileInput.instance.touches.size > 0;
      case 'Timer': {
        // Lazy accumulation: a timer starts counting from its first evaluation
        // so Timer conditions fire even when the named timer never existed.
        // EPSILON + subtract (never modulo): 60 x (1/60) sums to just under
        // 1.0 in IEEE754 — the boundary must trip on time, and modulo would
        // return the pre-interval value unchanged and double-fire next frame.
        const timerName = cond.params?.name || 'timer_0';
        const interval = cond.params?.interval || 1.0;
        const current = (this.timers.get(timerName) || 0) + dt;
        if (current + TIMER_EPSILON >= interval) {
          this.timers.set(timerName, current - interval);
          return true;
        }
        this.timers.set(timerName, current);
        return false;
      }
      default:
        return false;
    }
  }

  private executeAction(action: EventAction, dt: number): void {
    const t = this.gameObject.transform;
    const p = action.params || {};

    switch (action.type) {
      case 'Translate': {
        const dx = (p.x || 0) * (p.relativeToDelta ? dt : 1);
        const dy = (p.y || 0) * (p.relativeToDelta ? dt : 1);
        const dz = (p.z || 0) * (p.relativeToDelta ? dt : 1);
        t.translate(dx, dy, dz);
        break;
      }
      case 'RotateY': {
        // "degrees" rotates a fixed step per event fire (Timer/OnStart triggers);
        // "speed" is an angular velocity in rad/s for continuous EveryFrame spins.
        if (p.degrees !== undefined) {
          t.rotateY((p.degrees * Math.PI) / 180);
        } else {
          const speed = p.speed || 1.0;
          t.rotateY(speed * dt);
        }
        break;
      }
      case 'ApplyImpulse': {
        const rb = this.gameObject.getComponent(RigidBody3D);
        if (rb) {
          rb.applyImpulse(p.x || 0, p.y || 0, p.z || 0);
        }
        break;
      }
      case 'SetColor': {
        const mr = this.gameObject.getComponent(MeshRenderer);
        if (mr && p.color) {
          mr.setMaterial(p.color);
        }
        break;
      }
      case 'SetScale': {
        if (p.x !== undefined && p.y !== undefined && p.z !== undefined) {
          t.setScale(p.x, p.y, p.z);
        }
        break;
      }
      case 'Destroy': {
        this.gameObject.destroy();
        break;
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'EventSheet',
      enabled: this.enabled,
      events: this.events,
      tick: this.tick,
      trace: [...this.trace.values()].map(r => ({
        eventId: r.eventId,
        name: r.name,
        fireCount: r.fireCount,
        lastFireTick: r.lastFireTick,
        evalCount: r.evalCount,
        conditions: r.conditions.map(c => ({
          type: c.type,
          lastResult: c.lastResult,
          evalCount: c.evalCount,
          recent: [...c.recent]
        }))
      }))
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.events) this.events = data.events;
    if (typeof data.tick === 'number') this.tick = data.tick;
    this.trace.clear();
    if (Array.isArray(data.trace)) {
      for (const r of data.trace) {
        if (!r || typeof r.eventId !== 'string') continue;
        this.trace.set(r.eventId, {
          eventId: r.eventId,
          name: typeof r.name === 'string' ? r.name : r.eventId,
          fireCount: typeof r.fireCount === 'number' ? r.fireCount : 0,
          lastFireTick: typeof r.lastFireTick === 'number' ? r.lastFireTick : -1,
          evalCount: typeof r.evalCount === 'number' ? r.evalCount : 0,
          conditions: Array.isArray(r.conditions)
            ? r.conditions.map((c: Record<string, unknown>) => ({
                type: typeof c.type === 'string' ? c.type : '?',
                lastResult: typeof c.lastResult === 'boolean' ? c.lastResult : null,
                evalCount: typeof c.evalCount === 'number' ? c.evalCount : 0,
                recent: Array.isArray(c.recent)
                  ? (c.recent as unknown[]).filter(x => typeof x === 'boolean')
                  : []
              }))
            : []
        });
      }
    }
  }
}
