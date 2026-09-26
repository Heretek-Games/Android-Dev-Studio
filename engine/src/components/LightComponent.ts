import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { registerInspectorSchema } from '../core/InspectorSchema.js';

export type LightType = 'directional' | 'point' | 'ambient' | 'spot';

export interface LightComponentOptions {
  type?: LightType;
  color?: string | number;
  intensity?: number;
  distance?: number;
  castShadow?: boolean;
}

export class LightComponent extends Component {
  public lightType: LightType = 'directional';
  public color: string = '#ffffff';
  public intensity: number = 1.0;
  public distance: number = 0;
  public castShadow: boolean = true;

  public threeLight: THREE.Light | null = null;

  constructor(options?: LightComponentOptions) {
    super();
    if (options) {
      if (options.type) this.lightType = options.type;
      if (options.color !== undefined) this.color = options.color.toString();
      if (options.intensity !== undefined) this.intensity = options.intensity;
      if (options.distance !== undefined) this.distance = options.distance;
      if (options.castShadow !== undefined) this.castShadow = options.castShadow;
    }
  }

  public override awake(): void {
    this.createLight();
  }

  public override start(): void {
    if (this.threeLight && this.gameObject.scene?.threeScene) {
      if (!this.threeLight.parent) {
        this.gameObject.scene.threeScene.add(this.threeLight);
      }
    }
  }

  public override update(_deltaTime: number): void {
    if (!this.threeLight) return;
    const t = this.gameObject.transform;
    this.threeLight.position.copy(t.position);
  }

  public override onDestroy(): void {
    if (this.threeLight) {
      if (this.threeLight.parent) {
        this.threeLight.parent.remove(this.threeLight);
      }
      this.threeLight.dispose();
      this.threeLight = null;
    }
  }

  private createLight(): void {
    if (this.threeLight) {
      this.onDestroy();
    }

    const c = new THREE.Color(this.color);
    switch (this.lightType) {
      case 'ambient':
        this.threeLight = new THREE.AmbientLight(c, this.intensity);
        break;
      case 'point': {
        const point = new THREE.PointLight(c, this.intensity, this.distance);
        point.castShadow = this.castShadow;
        this.threeLight = point;
        break;
      }
      case 'spot': {
        const spot = new THREE.SpotLight(c, this.intensity, this.distance);
        spot.castShadow = this.castShadow;
        this.threeLight = spot;
        break;
      }
      case 'directional':
      default: {
        const dir = new THREE.DirectionalLight(c, this.intensity);
        dir.castShadow = this.castShadow;
        if (dir.shadow) {
          dir.shadow.mapSize.width = 2048;
          dir.shadow.mapSize.height = 2048;
          dir.shadow.camera.near = 0.5;
          dir.shadow.camera.far = 50;
        }
        this.threeLight = dir;
        break;
      }
    }

    const t = this.gameObject.transform;
    this.threeLight.position.copy(t.position);

    if (this.gameObject.scene?.threeScene) {
      this.gameObject.scene.threeScene.add(this.threeLight);
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'LightComponent',
      enabled: this.enabled,
      lightType: this.lightType,
      color: this.color,
      intensity: this.intensity,
      distance: this.distance,
      castShadow: this.castShadow
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.lightType) this.lightType = data.lightType;
    if (data.color) this.color = data.color;
    if (data.intensity !== undefined) this.intensity = data.intensity;
    if (data.distance !== undefined) this.distance = data.distance;
    if (data.castShadow !== undefined) this.castShadow = data.castShadow;
    this.createLight();
  }
}

// Track C.1 reflection spike: explicit type string (minification-safe).
registerInspectorSchema('LightComponent', [
  { key: 'lightType', label: 'Type', kind: 'enum', options: ['directional', 'point', 'ambient', 'spot'] },
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'intensity', label: 'Intensity', kind: 'slider', min: 0, max: 8, step: 0.1 },
  { key: 'distance', label: 'Distance', kind: 'number', min: 0, step: 0.5 },
  { key: 'castShadow', label: 'Cast Shadow', kind: 'boolean' }
]);
