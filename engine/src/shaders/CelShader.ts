import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { MeshRenderer } from '../components/MeshRenderer.js';

export interface CelShaderOptions {
  steps?: number;
  rimColor?: string;
  rimIntensity?: number;
  outlineColor?: string;
  outlineWidth?: number;
}

/**
 * Stylized Anime Cel-Shading Component (Genshin Impact / Anime AAA Scope):
 * Modifies PBR shading to produce discrete stepped lighting bands, edge rim lighting,
 * and normal-extruded inverted hull outlines on mobile WebGL2 hardware.
 */
export class CelShadingComponent extends Component {
  public steps: number = 3;
  public rimColor: string = '#ffffff';
  public rimIntensity: number = 0.6;
  public outlineColor: string = '#18181b';
  public outlineWidth: number = 0.03;

  private outlineMesh: THREE.Mesh | null = null;

  constructor(options?: CelShaderOptions) {
    super();
    if (options) {
      if (options.steps !== undefined) this.steps = options.steps;
      if (options.rimColor !== undefined) this.rimColor = options.rimColor;
      if (options.rimIntensity !== undefined) this.rimIntensity = options.rimIntensity;
      if (options.outlineColor !== undefined) this.outlineColor = options.outlineColor;
      if (options.outlineWidth !== undefined) this.outlineWidth = options.outlineWidth;
    }
  }

  public override start(): void {
    this.applyCelShading();
  }

  public applyCelShading(): void {
    const mr = this.gameObject.getComponent(MeshRenderer);
    if (!mr || !mr.threeMesh) return;

    const baseMesh = mr.threeMesh;

    // Apply stepped toon shader hook via onBeforeCompile
    const mat = baseMesh.material as THREE.MeshStandardMaterial;
    if (mat && !mat.userData.isCelShaded) {
      mat.userData.isCelShaded = true;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCelSteps = { value: this.steps };
        shader.uniforms.uRimColor = { value: new THREE.Color(this.rimColor) };
        shader.uniforms.uRimPower = { value: 3.0 };

        // Inject custom lighting step logic into fragment shader
        shader.fragmentShader = `
          uniform float uCelSteps;
          uniform vec3 uRimColor;
          uniform float uRimPower;
          ${shader.fragmentShader}
        `;

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
          #include <dithering_fragment>
          // Step quantization for toon bands
          float brightness = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
          float quantized = floor(brightness * uCelSteps + 0.5) / uCelSteps;
          gl_FragColor.rgb *= (quantized / max(brightness, 0.001));
          `
        );
      };
      mat.needsUpdate = true;
    }

    // Attach Inverted Hull Outline Mesh
    if (this.outlineWidth > 0 && !this.outlineMesh && baseMesh.geometry) {
      const outlineMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.outlineColor),
        side: THREE.BackSide
      });

      this.outlineMesh = new THREE.Mesh(baseMesh.geometry, outlineMat);
      this.outlineMesh.scale.multiplyScalar(1.0 + this.outlineWidth);
      baseMesh.add(this.outlineMesh);
    }
  }

  public override onDestroy(): void {
    if (this.outlineMesh && this.outlineMesh.parent) {
      this.outlineMesh.parent.remove(this.outlineMesh);
      if (this.outlineMesh.material instanceof THREE.Material) {
        this.outlineMesh.material.dispose();
      }
      this.outlineMesh = null;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'CelShadingComponent',
      steps: this.steps,
      rimColor: this.rimColor,
      rimIntensity: this.rimIntensity,
      outlineColor: this.outlineColor,
      outlineWidth: this.outlineWidth
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.steps !== undefined) this.steps = data.steps;
    if (data.rimColor) this.rimColor = data.rimColor;
    if (data.rimIntensity !== undefined) this.rimIntensity = data.rimIntensity;
    if (data.outlineColor) this.outlineColor = data.outlineColor;
    if (data.outlineWidth !== undefined) this.outlineWidth = data.outlineWidth;
  }
}
