import { Transform } from './Transform.js';
import { Component } from './Component.js';
import type { Scene } from './Scene.js';

export class GameObject {
  public id: string;
  public name: string;
  public tag: string = 'Untagged';
  public layer: string = 'Default';
  public active: boolean = true;

  public transform: Transform;
  public scene: Scene | null = null;
  public components: Component[] = [];

  constructor(name = 'GameObject', id?: string) {
    this.name = name;
    this.id = id || 'go_' + Math.random().toString(36).substring(2, 9);
    this.transform = new Transform();
  }

  public addComponent<T extends Component>(component: T): T {
    component.gameObject = this;
    this.components.push(component);
    if (this.active && component.enabled) {
      component.awake();
    }
    return component;
  }

  public getComponent<T extends Component>(ctor: new (...args: any[]) => T): T | null {
    for (const c of this.components) {
      if (c instanceof ctor) {
        return c as T;
      }
    }
    return null;
  }

  public getComponents<T extends Component>(ctor: new (...args: any[]) => T): T[] {
    return this.components.filter(c => c instanceof ctor) as T[];
  }

  public removeComponent(component: Component): void {
    const idx = this.components.indexOf(component);
    if (idx !== -1) {
      component.onDestroy();
      this.components.splice(idx, 1);
    }
  }

  public update(deltaTime: number): void {
    if (!this.active) return;
    for (const component of this.components) {
      if (component.enabled) {
        component.update(deltaTime);
      }
    }
  }

  public lateUpdate(deltaTime: number): void {
    if (!this.active) return;
    for (const component of this.components) {
      if (component.enabled) {
        component.lateUpdate(deltaTime);
      }
    }
  }

  public destroy(): void {
    if (this.scene) {
      this.scene.removeGameObject(this);
    }
    for (const c of [...this.components]) {
      c.onDestroy();
    }
    this.components = [];
  }

  public toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      tag: this.tag,
      layer: this.layer,
      active: this.active,
      transform: this.transform.toJSON(),
      components: this.components.map(c => c.toJSON())
    };
  }
}
