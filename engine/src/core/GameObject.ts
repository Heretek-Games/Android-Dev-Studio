import { Transform } from './Transform.js';
import { Component } from './Component.js';
import { createComponent } from './ComponentRegistry.js';
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
  /** Prefab linkage (Track 1.1/1.3): stamped by instantiatePrefab; null = plain object. */
  public prefabId: string | null = null;
  /** Direct base prefab of the variant this instance was stamped from (if any). */
  public prefabBase: string | null = null;

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
    const json: Record<string, any> = {
      id: this.id,
      name: this.name,
      tag: this.tag,
      layer: this.layer,
      active: this.active,
      transform: this.transform.toJSON(),
      components: this.components.map(c => c.toJSON())
    };
    // Linkage omitted when null so plain-object snapshots are byte-identical.
    if (this.prefabId !== null) json['prefabId'] = this.prefabId;
    if (this.prefabBase !== null) json['prefabBase'] = this.prefabBase;
    return json;
  }

  public fromJSON(data: Record<string, any>): void {
    if (typeof data.name === 'string') this.name = data.name;
    if (typeof data.tag === 'string') this.tag = data.tag;
    if (typeof data.layer === 'string') this.layer = data.layer;
    if (typeof data.active === 'boolean') this.active = data.active;
    this.prefabId = typeof data.prefabId === 'string' ? data.prefabId : null;
    this.prefabBase = typeof data.prefabBase === 'string' ? data.prefabBase : null;
    if (data.transform && typeof data.transform === 'object') {
      this.transform.fromJSON(data.transform as { position?: number[]; rotation?: number[]; scale?: number[] });
    }
    for (const c of [...this.components]) {
      this.removeComponent(c);
    }
    const components = Array.isArray(data.components) ? data.components : [];
    for (const compData of components) {
      const type = (compData as Record<string, any>)?.type;
      if (typeof type !== 'string') {
        throw new Error(`GameObject '${this.name}': component entry missing type`);
      }
      const comp = createComponent(type);
      if (!comp) {
        throw new Error(`GameObject '${this.name}': unknown component type '${type}'`);
      }
      this.addComponent(comp);
      comp.fromJSON(compData as Record<string, any>);
    }
  }
}
