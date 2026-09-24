import type { GameObject } from './GameObject.js';

export abstract class Component {
  public gameObject!: GameObject;
  public enabled: boolean = true;

  public awake(): void {}
  public start(): void {}
  public update(_deltaTime: number): void {}
  public lateUpdate(_deltaTime: number): void {}
  public onCollisionEnter(_other: GameObject): void {}
  public onDestroy(): void {}

  public toJSON(): Record<string, any> {
    return {
      type: this.constructor.name,
      enabled: this.enabled
    };
  }

  public fromJSON(_data: Record<string, any>): void {}
}
