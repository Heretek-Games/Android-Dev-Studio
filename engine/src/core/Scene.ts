import * as THREE from 'three';
import { GameObject } from './GameObject.js';

export class Scene {
  public id: string;
  public name: string;
  public threeScene: THREE.Scene;
  public gameObjects: GameObject[] = [];

  constructor(name = 'MainScene', id?: string) {
    this.name = name;
    this.id = id || 'scene_' + Math.random().toString(36).substring(2, 9);
    this.threeScene = new THREE.Scene();
  }

  public addGameObject(go: GameObject): GameObject {
    if (go.scene === this) return go;
    if (go.scene) {
      go.scene.removeGameObject(go);
    }
    go.scene = this;
    this.gameObjects.push(go);

    // Call start lifecycle if not started
    if (go.active) {
      for (const comp of go.components) {
        if (comp.enabled) {
          comp.start();
        }
      }
    }
    return go;
  }

  public removeGameObject(go: GameObject): void {
    const idx = this.gameObjects.indexOf(go);
    if (idx !== -1) {
      this.gameObjects.splice(idx, 1);
      go.scene = null;
    }
  }

  public findByName(name: string): GameObject | null {
    return this.gameObjects.find(g => g.name === name) || null;
  }

  public findById(id: string): GameObject | null {
    return this.gameObjects.find(g => g.id === id) || null;
  }

  public findByTag(tag: string): GameObject[] {
    return this.gameObjects.filter(g => g.tag === tag);
  }

  public update(deltaTime: number): void {
    for (let i = 0; i < this.gameObjects.length; i++) {
      this.gameObjects[i].update(deltaTime);
    }
    for (let i = 0; i < this.gameObjects.length; i++) {
      this.gameObjects[i].lateUpdate(deltaTime);
    }
  }

  public toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      gameObjects: this.gameObjects.map(go => go.toJSON())
    };
  }

  public clear(): void {
    for (const go of [...this.gameObjects]) {
      go.destroy();
    }
    this.gameObjects = [];
    while (this.threeScene.children.length > 0) {
      this.threeScene.remove(this.threeScene.children[0]);
    }
  }
}
