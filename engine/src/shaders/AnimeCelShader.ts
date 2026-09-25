import * as THREE from 'three';
import { Component } from '../core/Component.js';

export interface AnimeCelShaderOptions {
  baseColor?: string;
  shadowColor?: string;
  rimColor?: string;
  outlineColor?: string;
  outlineThickness?: number;
  rimPower?: number;
  lightDirection?: THREE.Vector3;
  /** Probe-baked bounce tint added to the diffuse (Track 2.1). Default black. */
  ambient?: [number, number, number];
}

/**
 * Genshin Impact Style Anime Cel-Shader Pipeline.
 * Features 2-band stepped diffuse shading, sharp specular highlights,
 * Fresnel edge rim illumination, and inverted-hull dark outlines.
 */
export class AnimeCelShader extends Component {
  public baseColor: THREE.Color;
  public shadowColor: THREE.Color;
  public rimColor: THREE.Color;
  public outlineColor: THREE.Color;
  public outlineThickness: number;
  public rimPower: number;
  public lightDirection: THREE.Vector3;
  public ambient: THREE.Color;

  public customMaterial: THREE.ShaderMaterial | null = null;
  public outlineMesh: THREE.Mesh | null = null;

  constructor(options?: AnimeCelShaderOptions) {
    super();
    this.baseColor = new THREE.Color(options?.baseColor ?? '#38bdf8');
    this.shadowColor = new THREE.Color(options?.shadowColor ?? '#1e3a8a');
    this.rimColor = new THREE.Color(options?.rimColor ?? '#ffffff');
    this.outlineColor = new THREE.Color(options?.outlineColor ?? '#0f172a');
    this.outlineThickness = options?.outlineThickness ?? 0.035;
    this.rimPower = options?.rimPower ?? 3.5;
    this.lightDirection = options?.lightDirection ?? new THREE.Vector3(0.5, 1.0, 0.75).normalize();
    const ambient = options?.ambient ?? [0, 0, 0];
    this.ambient = new THREE.Color(ambient[0], ambient[1], ambient[2]);
  }

  public override start(): void {
    this.applyShader();
  }

  public applyShader(): void {
    if (!this.gameObject) return; // safe to call before attachment
    const mr = this.gameObject.components.find((c: any) => c.threeMesh) as any;
    if (!mr || !mr.threeMesh) return;

    const baseMesh = mr.threeMesh as THREE.Mesh;

    // 1. Create Anime Cel Shader Material
    this.customMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBaseColor: { value: this.baseColor },
        uShadowColor: { value: this.shadowColor },
        uRimColor: { value: this.rimColor },
        uRimPower: { value: this.rimPower },
        uLightDir: { value: this.lightDirection },
        uAmbient: { value: this.ambient }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uBaseColor;
        uniform vec3 uShadowColor;
        uniform vec3 uRimColor;
        uniform float uRimPower;
        uniform vec3 uLightDir;
        uniform vec3 uAmbient;

        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          // Diffuse lighting
          float nDotL = dot(vNormal, normalize(uLightDir));
          
          // Stepped 2-band toon ramp
          float diffuseFactor = smoothstep(0.05, 0.1, nDotL);
          vec3 diffuse = mix(uShadowColor, uBaseColor, diffuseFactor) + uAmbient;

          // Fresnel Rim Light
          float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
          float rimFactor = pow(rim, uRimPower) * diffuseFactor;
          vec3 finalColor = diffuse + uRimColor * rimFactor;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    baseMesh.material = this.customMaterial;

    // 2. Create Inverted-Hull Outline Mesh
    if (this.outlineThickness > 0 && !this.outlineMesh) {
      const outlineMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uOutlineColor: { value: this.outlineColor },
          uThickness: { value: this.outlineThickness }
        },
        vertexShader: `
          uniform float uThickness;
          void main() {
            vec3 extruded = position + normal * uThickness;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(extruded, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uOutlineColor;
          void main() {
            gl_FragColor = vec4(uOutlineColor, 1.0);
          }
        `,
        side: THREE.BackSide
      });

      this.outlineMesh = new THREE.Mesh(baseMesh.geometry, outlineMaterial);
      baseMesh.add(this.outlineMesh);
    }
  }

  public override onDestroy(): void {
    if (this.customMaterial) {
      this.customMaterial.dispose();
      this.customMaterial = null;
    }
    if (this.outlineMesh) {
      if (this.outlineMesh.parent) {
        this.outlineMesh.parent.remove(this.outlineMesh);
      }
      if (this.outlineMesh.material instanceof THREE.Material) {
        this.outlineMesh.material.dispose();
      }
      this.outlineMesh = null;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'AnimeCelShader',
      enabled: this.enabled,
      baseColor: '#' + this.baseColor.getHexString(),
      shadowColor: '#' + this.shadowColor.getHexString(),
      rimColor: '#' + this.rimColor.getHexString(),
      outlineColor: '#' + this.outlineColor.getHexString(),
      outlineThickness: this.outlineThickness,
      rimPower: this.rimPower,
      ambient: [this.ambient.r, this.ambient.g, this.ambient.b]
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (typeof data.baseColor === 'string') this.baseColor.set(data.baseColor);
    if (typeof data.shadowColor === 'string') this.shadowColor.set(data.shadowColor);
    if (typeof data.rimColor === 'string') this.rimColor.set(data.rimColor);
    if (typeof data.outlineColor === 'string') this.outlineColor.set(data.outlineColor);
    if (data.outlineThickness !== undefined) this.outlineThickness = data.outlineThickness;
    if (data.rimPower !== undefined) this.rimPower = data.rimPower;
    if (Array.isArray(data.ambient) && data.ambient.length >= 3) {
      this.ambient.setRGB(Number(data.ambient[0]) || 0, Number(data.ambient[1]) || 0, Number(data.ambient[2]) || 0);
    }
  }
}
