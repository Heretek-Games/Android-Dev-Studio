import { MobileInput } from './MobileInput.js';

export type ActionType = 'button' | 'axis1' | 'axis2';
export type BindingSource = 'key' | 'button' | 'stick' | 'gamepad-button' | 'gamepad-axis';

/** Standard-layout gamepad button names (W3C §14 remapping table). */
const PAD_BUTTONS: Record<string, number> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7,
  select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16
};

export interface ActionBinding {
  source: BindingSource;
  /** key: KeyboardEvent.code · button: MobileInput button name · stick: left|right
   *  gamepad-button: name or padN · gamepad-axis: axisN (pair with axis below). */
  code: string;
  /** Stick/gamepad axis component for axis1 reads. Default 'x'. */
  axis?: 'x' | 'y';
  /** Digital contribution for axis1 actions (e.g. KeyD +1, KeyA -1). */
  output?: number;
  /** Digital contribution for axis2 actions (e.g. KeyW [0, 1]). */
  output2?: [number, number];
  /** Per-binding scale multiplier. Default 1. */
  scale?: number;
}

export interface InputAction {
  type: ActionType;
  /** Radial (sticks/pads) or axial deadzone. Default 0.15. */
  deadzone?: number;
  bindings: ActionBinding[];
}

export interface InputMapOptions {
  actions?: Record<string, InputAction>;
}

/** Scripted override (headless QA injection): value holds for N frames. */
interface InjectedValue {
  value: boolean | number | { x: number; y: number };
  framesLeft: number;
}

/**
 * InputActionMap — named-action input over the MobileInput capture path
 * (Track 1.9, ADR-1790375323743).
 *
 * Godot-InputMap-shaped tables (action -> event list) layered on the
 * Exp-2-proven MobileInput singleton: nothing about touch/keyboard capture
 * changes. Digital bindings declare explicit outputs; analog sticks and pads
 * contribute directly; 2D composites normalize diagonals (Godot get_vector
 * parity). Rebinding writes an override layer (defaults never mutate) with
 * leafwing-style conflict reports; scripted injection (UE InjectInputForAction
 * / Godot parse_input_event parity) overrides polls for a frame budget.
 */
export class InputActionMap {
  public actions: Map<string, InputAction> = new Map();
  public overrides: Map<string, ActionBinding[]> = new Map();

  private readonly input: MobileInput;
  private injected: Map<string, InjectedValue> = new Map();
  private padAxes: number[] = [];
  private padButtons: boolean[] = [];

  constructor(options?: InputMapOptions, input?: MobileInput) {
    this.input = input ?? MobileInput.instance;
    if (options?.actions) {
      for (const [name, action] of Object.entries(options.actions)) {
        this.actions.set(name, {
          type: action.type,
          deadzone: action.deadzone ?? 0.15,
          bindings: (action.bindings ?? []).map(b => ({ ...b }))
        });
      }
    }
  }

  public hasAction(name: string): boolean {
    return this.actions.has(name);
  }

  public defineAction(name: string, action: InputAction): void {
    this.actions.set(name, {
      type: action.type,
      deadzone: action.deadzone ?? 0.15,
      bindings: (action.bindings ?? []).map(b => ({ ...b }))
    });
  }

  public removeAction(name: string): boolean {
    this.overrides.delete(name);
    this.injected.delete(name);
    return this.actions.delete(name);
  }

  private bindingsFor(name: string): ActionBinding[] {
    return this.overrides.get(name) ?? this.actions.get(name)?.bindings ?? [];
  }

  // ------------------------------------------------------------- rebinding
  /**
   * Replaces one binding on the override layer (defaults stay pristine).
   * Returns ok:false with the conflicting actions when the new binding is
   * already claimed (leafwing-style clash report; force:true overrides).
   */
  public rebind(
    action: string,
    bindingIndex: number,
    binding: ActionBinding,
    force = false
  ): { ok: boolean; conflicts: string[] } {
    const def = this.actions.get(action);
    if (!def) return { ok: false, conflicts: [] };
    const current = this.bindingsFor(action);
    if (bindingIndex < 0 || bindingIndex >= current.length) {
      return { ok: false, conflicts: [] };
    }
    const conflicts = this.conflictsFor(binding, action);
    if (conflicts.length > 0 && !force) return { ok: false, conflicts };
    const next = current.map(b => ({ ...b }));
    next[bindingIndex] = { ...binding };
    this.overrides.set(action, next);
    return { ok: true, conflicts: [] };
  }

  /** Clears overrides for one action (or all when omitted). */
  public resetOverrides(action?: string): void {
    if (action) this.overrides.delete(action);
    else this.overrides.clear();
  }

  /** Every source+code claimed by 2+ actions (defaults + overrides). */
  public findConflicts(): Array<{ source: string; code: string; actions: string[] }> {
    const claims = new Map<string, Set<string>>();
    for (const name of this.actions.keys()) {
      for (const b of this.bindingsFor(name)) {
        const key = `${b.source}:${b.code.toLowerCase()}`;
        if (!claims.has(key)) claims.set(key, new Set());
        claims.get(key)!.add(name);
      }
    }
    const out: Array<{ source: string; code: string; actions: string[] }> = [];
    for (const [key, names] of claims) {
      if (names.size > 1) {
        const sep = key.indexOf(':');
        out.push({ source: key.slice(0, sep), code: key.slice(sep + 1), actions: [...names].sort() });
      }
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }

  private conflictsFor(binding: ActionBinding, except: string): string[] {
    const key = `${binding.source}:${binding.code.toLowerCase()}`;
    const out: string[] = [];
    for (const name of this.actions.keys()) {
      if (name === except) continue;
      for (const b of this.bindingsFor(name)) {
        if (`${b.source}:${b.code.toLowerCase()}` === key) {
          out.push(name);
          break;
        }
      }
    }
    return out.sort();
  }

  // -------------------------------------------------------------- injection
  /** Scripted override for headless QA (value holds `frames` polls). */
  public inject(name: string, value: boolean | number | { x: number; y: number }, frames = 1): void {
    this.injected.set(name, { value, framesLeft: Math.max(1, Math.floor(frames)) });
  }

  public clearInjected(name?: string): void {
    if (name) this.injected.delete(name);
    else this.injected.clear();
  }

  /** Advances injection lifetimes; call once per simulated frame. */
  public endFrame(): void {
    for (const [name, entry] of [...this.injected]) {
      entry.framesLeft--;
      if (entry.framesLeft <= 0) this.injected.delete(name);
    }
  }

  /** Test/automation hook: synthetic gamepad snapshot (real pads poll live). */
  public setGamepadSnapshot(axes: number[], buttons: boolean[]): void {
    this.padAxes = [...axes];
    this.padButtons = [...buttons];
  }

  // ------------------------------------------------------------------ polls
  public getButton(name: string): boolean {
    const injected = this.injected.get(name);
    if (injected) return injected.value === true || injected.value === 1 || (typeof injected.value === 'number' && injected.value > 0.5);
    const def = this.actions.get(name);
    if (!def) return false;
    const deadzone = def.deadzone ?? 0.15;
    for (const b of this.bindingsFor(name)) {
      if (this.readDigital(b)) return true;
      if (Math.abs(this.readAnalog(b, def.type)) >= deadzone) return true;
    }
    return false;
  }

  public getAxis1(name: string): number {
    const injected = this.injected.get(name);
    if (injected) {
      const v = injected.value;
      return typeof v === 'number' ? v : v === true ? 1 : 0;
    }
    const def = this.actions.get(name);
    if (!def) return 0;
    const deadzone = def.deadzone ?? 0.15;
    let value = 0;
    for (const b of this.bindingsFor(name)) {
      if (this.readDigital(b)) value += (b.output ?? 1) * (b.scale ?? 1);
      else value += this.applyAxialDeadzone(this.readAnalog(b, 'axis1'), deadzone) * (b.scale ?? 1);
    }
    return Math.min(1, Math.max(-1, value));
  }

  public getAxis2(name: string): { x: number; y: number } {
    const injected = this.injected.get(name);
    if (injected) {
      const v = injected.value;
      if (typeof v === 'object') return { x: v.x, y: v.y };
      return { x: 0, y: 0 };
    }
    const def = this.actions.get(name);
    if (!def) return { x: 0, y: 0 };
    const deadzone = def.deadzone ?? 0.15;
    let x = 0;
    let y = 0;
    for (const b of this.bindingsFor(name)) {
      if (this.readDigital(b)) {
        const o = b.output2 ?? [0, 0];
        x += o[0] * (b.scale ?? 1);
        y += o[1] * (b.scale ?? 1);
      } else {
        const v = this.readAnalogVec(b);
        const len = Math.hypot(v.x, v.y);
        if (len >= deadzone) {
          // Radial deadzone with rescale (UE modifier parity).
          const scaled = Math.min(1, (len - deadzone) / (1 - deadzone));
          x += (v.x / len) * scaled * (b.scale ?? 1);
          y += (v.y / len) * scaled * (b.scale ?? 1);
        }
      }
    }
    // Diagonal normalize (Godot get_vector parity).
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  private readDigital(b: ActionBinding): boolean {
    switch (b.source) {
      case 'key':
        return this.input.isKeyDown(b.code);
      case 'button':
        return this.input.getButton(b.code);
      case 'gamepad-button':
        return this.readPadButton(b.code);
      default:
        return false;
    }
  }

  private readAnalog(b: ActionBinding, _type: ActionType): number {
    switch (b.source) {
      case 'stick': {
        const stick = b.code === 'right' ? this.input.rightJoystick : this.input.leftJoystick;
        return b.axis === 'y' ? stick.y : stick.x;
      }
      case 'gamepad-axis': {
        const idx = this.padAxisIndex(b.code);
        return this.padAxes[idx] ?? this.livePadAxes()[idx] ?? 0;
      }
      default:
        return 0;
    }
  }

  private readAnalogVec(b: ActionBinding): { x: number; y: number } {
    if (b.source === 'stick') {
      const stick = b.code === 'right' ? this.input.rightJoystick : this.input.leftJoystick;
      return { x: stick.x, y: stick.y };
    }
    if (b.source === 'gamepad-axis') {
      const idx = this.padAxisIndex(b.code);
      const axes = this.padAxes.length ? this.padAxes : this.livePadAxes();
      // Axis pairs: even index reads (i, i+1) as (x, y).
      const base = idx - (idx % 2);
      return { x: axes[base] ?? 0, y: axes[base + 1] ?? 0 };
    }
    return { x: 0, y: 0 };
  }

  private applyAxialDeadzone(value: number, deadzone: number): number {
    if (Math.abs(value) < deadzone) return 0;
    return Math.min(1, (Math.abs(value) - deadzone) / (1 - deadzone)) * Math.sign(value);
  }

  private readPadButton(code: string): boolean {
    const idx = this.padButtonIndex(code);
    if (this.padButtons[idx] !== undefined) return this.padButtons[idx];
    return this.livePadButtons()[idx] ?? false;
  }

  private padButtonIndex(code: string): number {
    const lower = code.toLowerCase();
    if (lower in PAD_BUTTONS) return PAD_BUTTONS[lower];
    const m = /^pad(\d+)$/.exec(lower);
    return m ? parseInt(m[1], 10) : -1;
  }

  private padAxisIndex(code: string): number {
    const m = /^axis(\d+)$/.exec(code.toLowerCase());
    return m ? parseInt(m[1], 10) : 0;
  }

  private livePadAxes(): number[] {
    try {
      const nav = globalThis as unknown as { navigator?: { getGamepads?: () => ArrayLike<{ axes?: ArrayLike<number>; buttons?: ArrayLike<{ pressed?: boolean }> }> | null } };
      const pads = nav.navigator?.getGamepads?.();
      const pad = pads?.[0];
      if (pad?.axes) return Array.from(pad.axes, Number);
    } catch {
      // No gamepad API (headless/SSR): neutral.
    }
    return [];
  }

  private livePadButtons(): boolean[] {
    try {
      const nav = globalThis as unknown as { navigator?: { getGamepads?: () => ArrayLike<{ axes?: ArrayLike<number>; buttons?: ArrayLike<{ pressed?: boolean }> }> | null } };
      const pads = nav.navigator?.getGamepads?.();
      const pad = pads?.[0];
      if (pad?.buttons) return Array.from(pad.buttons, b => b?.pressed === true);
    } catch {
      // No gamepad API (headless/SSR): neutral.
    }
    return [];
  }

  public toJSON(): Record<string, any> {
    const actions: Record<string, unknown> = {};
    for (const [name, action] of this.actions) {
      actions[name] = {
        type: action.type,
        deadzone: action.deadzone,
        bindings: action.bindings.map(b => ({ ...b }))
      };
    }
    const overrides: Record<string, unknown> = {};
    for (const [name, bindings] of this.overrides) {
      overrides[name] = bindings.map(b => ({ ...b }));
    }
    return { type: 'InputActionMap', actions, overrides };
  }

  public fromJSON(data: Record<string, any>): void {
    this.actions.clear();
    this.overrides.clear();
    this.injected.clear();
    const actions = data.actions;
    if (actions && typeof actions === 'object') {
      for (const [name, action] of Object.entries(actions as Record<string, InputAction>)) {
        this.defineAction(name, action);
      }
    }
    const overrides = data.overrides;
    if (overrides && typeof overrides === 'object') {
      for (const [name, bindings] of Object.entries(overrides as Record<string, ActionBinding[]>)) {
        if (Array.isArray(bindings)) this.overrides.set(name, bindings.map(b => ({ ...b })));
      }
    }
  }
}
