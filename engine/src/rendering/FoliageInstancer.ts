import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { InstancedMeshBatcher } from './InstancedMeshBatcher.js';
import { TerrainChunk } from '../terrain/TerrainChunk.js';

export interface FoliageConfig {
  count?: number;
  radius?: number;
  windSpeed?: number;
  windStrength?: number;
  grassColor?: string;
  flowerColor?: string;
}

/**
 * High-performance Foliage & Vegetation Instancer.
 * Populates thousands of procedural wind-animated grass blades and shrubs
 * across terrain chunks in a single GPU draw call using InstancedMeshBatcher.
 */
export class FoliageInstancer extends Component {
  public count: number;
  public radius: number;
  public windSpeed: number;
  public windStrength: number;
  public grassColor: string;
  public flowerColor: string;

  public batcher: InstancedMeshBatcher | null = null;
  private timeUniform: { value: number } = { value: 0 };

  constructor(config?: FoliageConfig) {
    super();
    this.count = config?.count ?? 2500;
    this.radius = config?.radius ?? 24;
    this.windSpeed = config?.windSpeed ?? 3.5;
    this.windStrength = config?.windStrength ?? 0.15;
    this.grassColor = config?.grassColor ?? '#22c55e';
    this.flowerColor = config?.flowerColor ?? '#ec4899';
  }

  public override awake(): void {
    this.generateFoliageMesh();
  }

  public override start(): void {
    if (this.batcher?.instancedMesh && this.gameObject.scene?.threeScene) {
      if (!this.batcher.instancedMesh.parent) {
        this.gameObject.scene.threeScene.add(this.batcher.instancedMesh);
      }
    }
  }

  public override update(deltaTime: number): void {
    this.timeUniform.value += deltaTime * this.windSpeed;
  }

  /**
   * Generates low-poly crossed quad grass geometry with vertex wind shader
   */
  public generateFoliageMesh(): void {
    // Crossed-plane grass tuft geometry (2 intersecting quads)
    const geom = new THREE.PlaneGeometry(0.4, 0.9, 1, 2);
    geom.translate(0, 0.45, 0); // Origin at base

    // Custom Wind Shader Material
    const mat = new THREE.MeshStandardMaterial({
      color: this.grassColor,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.uWindStrength = { value: this.windStrength };

      // Inject wind displacement into vertex shader
      shader.vertexShader = `
        uniform float uTime;
        uniform float uWindStrength;
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        // Displace top vertices with sinusoidal wind sway
        float heightFactor = clamp(position.y / 0.9, 0.0, 1.0);
        float sway = sin(uTime + transformed.x * 2.0 + transformed.z * 1.5) * uWindStrength * heightFactor;
        transformed.x += sway;
        transformed.z += sway * 0.5;
        `
      );
    };

    this.batcher = new InstancedMeshBatcher(
      geom,
      mat,
      this.count,
      false,
      true
    );

    // Populate instances across terrain or ground radius
    const terrain = this.gameObject.scene?.gameObjects
      .map(g => g.getComponent(TerrainChunk))
      .find(t => t !== null);

    const grassThreeColor = new THREE.Color(this.grassColor);
    const flowerThreeColor = new THREE.Color(this.flowerColor);

    for (let i = 0; i < this.count; i++) {
      // Polar scatter within radius
      const r = Math.sqrt(Math.random()) * this.radius;
      const theta = Math.random() * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;

      // Sample height from terrain if available
      const y = terrain ? terrain.sampleHeight(x, z) : 0;

      const yaw = Math.random() * Math.PI * 2;
      const s = 0.7 + Math.random() * 0.6;
      const c = Math.random() > 0.92 ? flowerThreeColor : grassThreeColor;

      this.batcher.addInstance({
        position: new THREE.Vector3(x, y, z),
        rotation: new THREE.Euler(0, yaw, 0),
        scale: new THREE.Vector3(s, s * (0.8 + Math.random() * 0.4), s),
        color: c
      });
    }
  }

  public override onDestroy(): void {
    if (this.batcher?.instancedMesh) {
      this.gameObject.scene?.threeScene?.remove(this.batcher.instancedMesh);
      this.batcher.instancedMesh.geometry.dispose();
    }
  }
}
