import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Component } from '../core/Component.js';

export interface ModelRendererOptions {
  modelUrl?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  defaultAnimation?: string;
  scale?: [number, number, number];
}

/**
 * High-performance 3D Model Renderer for rigged & static glTF/GLB assets.
 * Uses Three.js GLTFLoader with global asset caching and SkeletonUtils cloning
 * to prevent duplicate memory allocations and ensure 60 FPS mobile performance.
 */
export class ModelRenderer extends Component {
  // Global cache for parsed glTF templates to avoid re-parsing identical models
  private static gltfCache: Map<string, Promise<GLTF>> = new Map();

  public modelUrl: string = '';
  public castShadow: boolean = true;
  public receiveShadow: boolean = true;
  public defaultAnimation: string | null = null;
  public scaleMultiplier: [number, number, number] = [1, 1, 1];

  public loadedRoot: THREE.Object3D | null = null;
  public mixer: THREE.AnimationMixer | null = null;
  public animations: Map<string, THREE.AnimationClip> = new Map();
  public activeAction: THREE.AnimationAction | null = null;
  public isLoaded: boolean = false;
  public isLoading: boolean = false;

  constructor(options?: ModelRendererOptions) {
    super();
    if (options) {
      if (options.modelUrl) this.modelUrl = options.modelUrl;
      if (options.castShadow !== undefined) this.castShadow = options.castShadow;
      if (options.receiveShadow !== undefined) this.receiveShadow = options.receiveShadow;
      if (options.defaultAnimation) this.defaultAnimation = options.defaultAnimation;
      if (options.scale) this.scaleMultiplier = options.scale;
    }
  }

  public override awake(): void {
    if (this.modelUrl) {
      this.loadModel(this.modelUrl).catch(console.error);
    }
  }

  public override start(): void {
    if (this.loadedRoot && this.gameObject.scene?.threeScene && !this.loadedRoot.parent) {
      this.gameObject.scene.threeScene.add(this.loadedRoot);
    }
  }

  /**
   * Load and instantiate a glTF/GLB model from URL or local asset path
   */
  public async loadModel(url: string): Promise<THREE.Object3D> {
    this.modelUrl = url;
    this.isLoading = true;

    try {
      let cachedPromise = ModelRenderer.gltfCache.get(url);
      if (!cachedPromise) {
        const loader = new GLTFLoader();
        cachedPromise = new Promise<GLTF>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });
        ModelRenderer.gltfCache.set(url, cachedPromise);
      }

      const gltf = await cachedPromise;

      // Clean up prior model if present
      if (this.loadedRoot) {
        this.onDestroy();
      }

      // Clone scene graph using SkeletonUtils to properly replicate rigged skin bones
      const clonedScene = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
      this.loadedRoot = clonedScene;

      // Apply shadows and link userData
      this.loadedRoot.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = this.castShadow;
          child.receiveShadow = this.receiveShadow;
          child.userData.gameObject = this.gameObject;
        }
      });

      // Scale model
      this.loadedRoot.scale.set(
        this.scaleMultiplier[0],
        this.scaleMultiplier[1],
        this.scaleMultiplier[2]
      );

      // Register animations
      this.animations.clear();
      if (gltf.animations && gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(this.loadedRoot);
        for (const clip of gltf.animations) {
          this.animations.set(clip.name, clip);
        }

        const targetAnim = this.defaultAnimation || gltf.animations[0].name;
        if (targetAnim && this.animations.has(targetAnim)) {
          this.playAnimation(targetAnim);
        }
      }

      // Attach to scene
      if (this.gameObject.scene?.threeScene) {
        this.gameObject.scene.threeScene.add(this.loadedRoot);
      }

      this.isLoaded = true;
      this.syncTransform();
      return this.loadedRoot;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Play an animation with smooth cross-fading
   */
  public playAnimation(name: string, crossFadeDuration: number = 0.2): boolean {
    if (!this.mixer) return false;
    const clip = this.animations.get(name);
    if (!clip) return false;

    const newAction = this.mixer.clipAction(clip);
    if (this.activeAction === newAction) return true;

    newAction.reset();
    if (this.activeAction && crossFadeDuration > 0) {
      newAction.crossFadeFrom(this.activeAction, crossFadeDuration, true);
    }
    newAction.play();
    this.activeAction = newAction;
    return true;
  }

  public stopAnimation(): void {
    if (this.activeAction) {
      this.activeAction.stop();
      this.activeAction = null;
    }
  }

  public getAvailableAnimations(): string[] {
    return Array.from(this.animations.keys());
  }

  public override update(deltaTime: number): void {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
    this.syncTransform();
  }

  public override lateUpdate(_deltaTime: number): void {
    this.syncTransform();
  }

  private syncTransform(): void {
    if (!this.loadedRoot) return;
    const t = this.gameObject.transform;

    if (t.parent) {
      t.updateMatrices();
      this.loadedRoot.position.setFromMatrixPosition(t.worldMatrix);
      this.loadedRoot.quaternion.setFromRotationMatrix(t.worldMatrix);
      this.loadedRoot.scale.setFromMatrixScale(t.worldMatrix);
      this.loadedRoot.scale.multiply(
        new THREE.Vector3(
          this.scaleMultiplier[0],
          this.scaleMultiplier[1],
          this.scaleMultiplier[2]
        )
      );
    } else {
      this.loadedRoot.position.copy(t.position);
      this.loadedRoot.quaternion.copy(t.quaternion);
      this.loadedRoot.scale.set(
        t.scale.x * this.scaleMultiplier[0],
        t.scale.y * this.scaleMultiplier[1],
        t.scale.z * this.scaleMultiplier[2]
      );
    }
  }

  public override onDestroy(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    if (this.loadedRoot) {
      if (this.loadedRoot.parent) {
        this.loadedRoot.parent.remove(this.loadedRoot);
      }
      this.loadedRoot.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.loadedRoot = null;
    }
    this.isLoaded = false;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'ModelRenderer',
      enabled: this.enabled,
      modelUrl: this.modelUrl,
      castShadow: this.castShadow,
      receiveShadow: this.receiveShadow,
      defaultAnimation: this.defaultAnimation,
      scale: this.scaleMultiplier
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.modelUrl) this.modelUrl = data.modelUrl;
    if (data.castShadow !== undefined) this.castShadow = data.castShadow;
    if (data.receiveShadow !== undefined) this.receiveShadow = data.receiveShadow;
    if (data.defaultAnimation) this.defaultAnimation = data.defaultAnimation;
    if (data.scale) this.scaleMultiplier = data.scale;
    if (this.modelUrl) {
      this.loadModel(this.modelUrl).catch(console.error);
    }
  }
}
