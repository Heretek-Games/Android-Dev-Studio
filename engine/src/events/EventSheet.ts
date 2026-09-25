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

export class EventSheet extends Component {
  public events: VisualEvent[] = [];
  private timers: Map<string, number> = new Map();
  private hasStarted = false;

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
  }

  private evaluateEvents(triggerType: string, dt = 0): void {
    if (!this.enabled || !this.gameObject.active) return;

    for (const ev of this.events) {
      if (!ev.enabled) continue;

      let allConditionsMet = true;
      for (const cond of ev.conditions) {
        if (!this.checkCondition(cond, triggerType, dt)) {
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
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
        const timerName = cond.params?.name || 'timer_0';
        const interval = cond.params?.interval || 1.0;
        const current = (this.timers.get(timerName) || 0) + dt;
        if (current >= interval) {
          this.timers.set(timerName, current % interval);
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
      events: this.events
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.events) this.events = data.events;
  }
}
