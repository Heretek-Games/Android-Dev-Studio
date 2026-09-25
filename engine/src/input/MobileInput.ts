export interface JoystickState {
  x: number; // -1 to 1
  y: number; // -1 to 1
  angle: number; // radians
  distance: number; // 0 to 1
  isActive: boolean;
}

export interface TouchPoint {
  id: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export class MobileInput {
  private static _instance: MobileInput | null = null;

  public static get instance(): MobileInput {
    if (!MobileInput._instance) {
      MobileInput._instance = new MobileInput();
    }
    return MobileInput._instance;
  }

  public leftJoystick: JoystickState = { x: 0, y: 0, angle: 0, distance: 0, isActive: false };
  public rightJoystick: JoystickState = { x: 0, y: 0, angle: 0, distance: 0, isActive: false };

  public buttons: Map<string, boolean> = new Map();
  public touches: Map<number, TouchPoint> = new Map();

  // Desktop keyboard fallback state
  private keysDown: Set<string> = new Set();
  private isListening = false;

  constructor() {
    this.buttons.set('jump', false);
    this.buttons.set('fire', false);
    this.buttons.set('action', false);
  }

  public initListeners(targetElement: HTMLElement | Window = window): void {
    if (this.isListening || typeof window === 'undefined') return;
    this.isListening = true;

    // Desktop keyboard listeners
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.code);
      this.updateKeyboardJoystick();
      if (e.code === 'Space') this.buttons.set('jump', true);
      if (e.code === 'KeyE') this.buttons.set('action', true);
      if (e.code === 'KeyF') this.buttons.set('fire', true);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
      this.updateKeyboardJoystick();
      if (e.code === 'Space') this.buttons.set('jump', false);
      if (e.code === 'KeyE') this.buttons.set('action', false);
      if (e.code === 'KeyF') this.buttons.set('fire', false);
    });

    // Touch event listeners
    const el = targetElement instanceof Window ? document.body : targetElement;
    if (el) {
      el.addEventListener('touchstart', this.handleTouchStart, { passive: false });
      el.addEventListener('touchmove', this.handleTouchMove, { passive: false });
      el.addEventListener('touchend', this.handleTouchEnd, { passive: false });
      el.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
    }
  }

  private updateKeyboardJoystick(): void {
    let jx = 0;
    let jy = 0;

    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) jx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) jx += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) jy += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) jy -= 1;

    // Normalize diagonal
    const len = Math.sqrt(jx * jx + jy * jy);
    if (len > 0) {
      jx /= len;
      jy /= len;
      this.leftJoystick = {
        x: jx,
        y: jy,
        angle: Math.atan2(jy, jx),
        distance: 1.0,
        isActive: true
      };
    } else if (!this.touches.size) {
      this.leftJoystick.x = 0;
      this.leftJoystick.y = 0;
      this.leftJoystick.distance = 0;
      this.leftJoystick.isActive = false;
    }
  }

  public setJoystick(side: 'left' | 'right', x: number, y: number): void {
    const dist = Math.min(Math.sqrt(x * x + y * y), 1.0);
    const target = side === 'left' ? this.leftJoystick : this.rightJoystick;
    target.x = x;
    target.y = y;
    target.distance = dist;
    target.angle = Math.atan2(y, x);
    target.isActive = dist > 0.05;
  }

  public setButton(btn: string, pressed: boolean): void {
    this.buttons.set(btn, pressed);
  }

  public getButton(btn: string): boolean {
    return this.buttons.get(btn) || false;
  }

  /** Physical key state reader (KeyboardEvent.code) for action-map polling. */
  public isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** Scripted key state (headless QA / action-map tests); mirrors setButton. */
  public setKey(code: string, down: boolean): void {
    if (down) this.keysDown.add(code);
    else this.keysDown.delete(code);
    this.updateKeyboardJoystick();
  }

  /** Clears all capture state (test/automation isolation hook). */
  public reset(): void {
    this.keysDown.clear();
    this.buttons.clear();
    this.buttons.set('jump', false);
    this.buttons.set('fire', false);
    this.buttons.set('action', false);
    this.touches.clear();
    this.leftJoystick = { x: 0, y: 0, angle: 0, distance: 0, isActive: false };
    this.rightJoystick = { x: 0, y: 0, angle: 0, distance: 0, isActive: false };
  }

  public getAxis(axis: 'Horizontal' | 'Vertical'): number {
    if (axis === 'Horizontal') return this.leftJoystick.x;
    if (axis === 'Vertical') return this.leftJoystick.y;
    return 0;
  }

  private handleTouchStart = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.touches.set(t.identifier, {
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        currentX: t.clientX,
        currentY: t.clientY
      });
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const entry = this.touches.get(t.identifier);
      if (entry) {
        entry.currentX = t.clientX;
        entry.currentY = t.clientY;
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.touches.delete(t.identifier);
    }
  };
}
