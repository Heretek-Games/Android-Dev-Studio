import * as THREE from 'three';
import { GameObject } from './GameObject.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.js';

/** Named geography (Track B.2): first-class places shared by briefs, dialogue,
 * quests, and agents. Pure data — no game logic lives here. */
export interface ScenePlace {
  name: string;
  position: [number, number, number];
  radius?: number;
}

export class Scene {
  public id: string;
  public name: string;
  public threeScene: THREE.Scene;
  public gameObjects: GameObject[] = [];
  public physicsWorld: PhysicsWorld | null = null;
  /** Named places (set via setPlaces; validated finite positions). */
  public places: ScenePlace[] = [];

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

  /** Replace the named-place table (drops malformed entries, keeps finite ones). */
  public setPlaces(places: ScenePlace[] | undefined | null): void {
    if (!Array.isArray(places)) {
      this.places = [];
      return;
    }
    const seen = new Set<string>();
    this.places = [];
    for (const p of places) {
      if (!p || typeof p.name !== 'string' || !p.name) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      const pos = p.position;
      if (!Array.isArray(pos) || pos.length !== 3) continue;
      const xyz = [Number(pos[0]), Number(pos[1]), Number(pos[2])];
      if (!xyz.every(Number.isFinite)) continue;
      this.places.push({
        name: p.name,
        position: [xyz[0], xyz[1], xyz[2]],
        radius: Number.isFinite(p.radius) && (p.radius as number) > 0 ? p.radius : 1
      });
    }
  }

  public findPlace(name: string): ScenePlace | null {
    return this.places.find(p => p.name === name) || null;
  }

  /** Resolve a target name to a world position: live object first, named
   * place second (actors beat geography). Returns null when unknown. */
  public resolveTargetPosition(name: string): THREE.Vector3 | null {
    const go = this.findByName(name);
    if (go) return go.transform.position.clone();
    const place = this.findPlace(name);
    if (place) return new THREE.Vector3(place.position[0], place.position[1], place.position[2]);
    return null;
  }

  public update(deltaTime: number): void {
    for (let i = 0; i < this.gameObjects.length; i++) {
      this.gameObjects[i].update(deltaTime);
    }
    if (this.physicsWorld && this.physicsWorld.isReady) {
      this.physicsWorld.step(deltaTime);
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

  /**
   * Restores the scene from a toJSON snapshot (undo/redo, play-mode restore).
   * Clears current objects first; unknown component types throw rather than
   * silently dropping behavior.
   */
  public fromJSON(data: Record<string, any>): void {
    this.clear();
    if (typeof data.name === 'string') this.name = data.name;
    const objects = Array.isArray(data.gameObjects) ? data.gameObjects : [];
    for (const goData of objects) {
      const go = new GameObject(
        typeof (goData as Record<string, any>).name === 'string'
          ? (goData as Record<string, any>).name as string
          : 'Restored Object',
        typeof (goData as Record<string, any>).id === 'string'
          ? (goData as Record<string, any>).id as string
          : undefined
      );
      go.fromJSON(goData as Record<string, any>);
      this.addGameObject(go);
    }
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
