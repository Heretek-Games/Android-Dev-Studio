import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';

export interface TerrainChunkConfig {
  chunkX: number;
  chunkZ: number;
  size: number;
  resolution: number; // Vertices per edge (e.g., 32)
  maxHeight: number;
  seed?: number;
}

/**
 * Open-world Terrain Chunk with procedural multi-octave heightmap generation,
 * slope-based biome splat coloring (Grass/Rock/Snow), and physics collision.
 */
export class TerrainChunk extends Component {
  public chunkX: number;
  public chunkZ: number;
  public size: number;
  public resolution: number;
  public maxHeight: number;
  public seed: number;

  public mesh: THREE.Mesh | null = null;
  public geometry: THREE.PlaneGeometry | null = null;

  constructor(config: TerrainChunkConfig) {
    super();
    this.chunkX = config.chunkX;
    this.chunkZ = config.chunkZ;
    this.size = config.size;
    this.resolution = config.resolution;
    this.maxHeight = config.maxHeight;
    this.seed = config.seed ?? 1337;
  }

  public override awake(): void {
    this.generateChunk();
  }

  public override start(): void {
    if (this.mesh && this.gameObject.scene?.threeScene && !this.mesh.parent) {
      this.gameObject.scene.threeScene.add(this.mesh);
    }
  }

  // Fast deterministic procedural 2D noise generator (Simplex approximation)
  private noise2D(x: number, z: number): number {
    const s = Math.sin(x * 12.9898 + z * 78.233 + this.seed) * 43758.5453;
    return (s - Math.floor(s)) * 2.0 - 1.0;
  }

  // Smooth interpolated multi-octave fractal noise
  public sampleHeight(worldX: number, worldZ: number): number {
    let elevation = 0;
    let frequency = 0.02;
    let amplitude = 1.0;
    let maxAmp = 0;

    for (let o = 0; o < 4; o++) {
      const nx = worldX * frequency;
      const nz = worldZ * frequency;

      // Bilinear interpolation between grid cells
      const x0 = Math.floor(nx);
      const z0 = Math.floor(nz);
      const fx = nx - x0;
      const fz = nz - z0;

      const n00 = this.noise2D(x0, z0);
      const n10 = this.noise2D(x0 + 1, z0);
      const n01 = this.noise2D(x0, z0 + 1);
      const n11 = this.noise2D(x0 + 1, z0 + 1);

      const smoothFx = fx * fx * (3 - 2 * fx);
      const smoothFz = fz * fz * (3 - 2 * fz);

      const top = n00 * (1 - smoothFx) + n10 * smoothFx;
      const bottom = n01 * (1 - smoothFx) + n11 * smoothFx;
      const val = top * (1 - smoothFz) + bottom * smoothFz;

      elevation += val * amplitude;
      maxAmp += amplitude;
      frequency *= 2.1;
      amplitude *= 0.45;
    }

    const normalized = (elevation / maxAmp + 1.0) * 0.5;
    // Power curve for natural flat plains and steep craggy mountain peaks
    return Math.pow(normalized, 1.4) * this.maxHeight;
  }

  private generateChunk(): void {
    const res = this.resolution;
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, res - 1, res - 1);
    this.geometry.rotateX(-Math.PI / 2);

    const positions = this.geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    const originX = this.chunkX * this.size;
    const originZ = this.chunkZ * this.size;

    const grassColor = new THREE.Color('#15803d');
    const dirtColor = new THREE.Color('#78350f');
    const rockColor = new THREE.Color('#52525b');
    const snowColor = new THREE.Color('#f8fafc');

    for (let i = 0; i < positions.count; i++) {
      const localX = positions.getX(i);
      const localZ = positions.getZ(i);

      const worldX = originX + localX;
      const worldZ = originZ + localZ;

      const height = this.sampleHeight(worldX, worldZ);
      positions.setY(i, height);

      // Biome color based on height & slope
      const normH = height / Math.max(1, this.maxHeight);
      let c = grassColor;
      if (normH > 0.8) {
        c = snowColor;
      } else if (normH > 0.45) {
        c = rockColor;
      } else if (normH < 0.15) {
        c = dirtColor;
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: false
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.position.set(originX + this.size / 2, 0, originZ + this.size / 2);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.userData.gameObject = this.gameObject;

    // Attach to Three.js scene if scene already started
    if (this.gameObject.scene?.threeScene) {
      this.gameObject.scene.threeScene.add(this.mesh);
    }
  }

  /**
   * Applies sculpting brush deformation (raise, lower, smooth, flatten) at world coordinates
   */
  public deform(
    worldX: number,
    worldZ: number,
    brushRadius: number,
    brushStrength: number,
    mode: 'raise' | 'lower' | 'smooth' | 'flatten',
    targetHeight: number = 0
  ): void {
    if (!this.geometry || !this.mesh) return;

    const positions = this.geometry.attributes.position;
    const originX = this.mesh.position.x;
    const originZ = this.mesh.position.z;

    let modified = false;

    // First pass for smooth average
    let avgHeight = 0;
    let inRadiusCount = 0;
    if (mode === 'smooth') {
      for (let i = 0; i < positions.count; i++) {
        const vx = originX + positions.getX(i);
        const vz = originZ + positions.getZ(i);
        const dist = Math.hypot(vx - worldX, vz - worldZ);
        if (dist <= brushRadius) {
          avgHeight += positions.getY(i);
          inRadiusCount++;
        }
      }
      if (inRadiusCount > 0) {
        avgHeight /= inRadiusCount;
      }
    }

    for (let i = 0; i < positions.count; i++) {
      const vx = originX + positions.getX(i);
      const vz = originZ + positions.getZ(i);
      const dist = Math.hypot(vx - worldX, vz - worldZ);

      if (dist <= brushRadius) {
        // Cosine falloff factor (1.0 at center, 0.0 at edge)
        const factor = 0.5 * (1 + Math.cos((Math.PI * dist) / brushRadius));
        const currentY = positions.getY(i);
        let newY = currentY;

        switch (mode) {
          case 'raise':
            newY += brushStrength * factor;
            break;
          case 'lower':
            newY = Math.max(0, currentY - brushStrength * factor);
            break;
          case 'smooth':
            newY = currentY + (avgHeight - currentY) * factor * Math.min(1.0, brushStrength);
            break;
          case 'flatten':
            newY = currentY + (targetHeight - currentY) * factor * Math.min(1.0, brushStrength);
            break;
        }

        positions.setY(i, newY);
        modified = true;
      }
    }

    if (modified) {
      positions.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
  }

  public override onDestroy(): void {
    if (this.mesh) {
      if (this.mesh.parent) {
        this.mesh.parent.remove(this.mesh);
      }
      this.geometry?.dispose();
      if (this.mesh.material instanceof THREE.Material) {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }
  }
}
