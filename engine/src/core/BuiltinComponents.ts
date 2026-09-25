import { createComponent } from './ComponentRegistry.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { LightComponent } from '../components/LightComponent.js';
import { CameraComponent } from '../components/CameraComponent.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';
import { MobileController } from '../components/MobileController.js';
import { ModelRenderer } from '../components/ModelRenderer.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { EnemyAI } from '../components/EnemyAI.js';
import { AudioSource } from '../components/AudioSource.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { ElementalReactionComponent } from '../combat/ElementalReactionComponent.js';
import { AnimeCelShader } from '../shaders/AnimeCelShader.js';
import { CelShadingComponent } from '../shaders/CelShader.js';
import { EventSheet } from '../events/EventSheet.js';
import { AnimationController } from '../animation/BlendTree.js';
import { BehaviorTreeComponent } from '../ai/BehaviorTree.js';
import { registerComponent } from './ComponentRegistry.js';
import { Tween } from '../behaviors/Tween.js';
import { TopDownMovement } from '../behaviors/TopDownMovement.js';
import { Draggable } from '../behaviors/Draggable.js';
import { DestroyOutsideScreen } from '../behaviors/DestroyOutsideScreen.js';
import { PlatformerCharacter } from '../behaviors/PlatformerCharacter.js';
import { Platform } from '../behaviors/Platform.js';

/**
 * Registers every restorable built-in component by its toJSON type name.
 * Import this module once (engine/index.ts does) before any fromJSON restore.
 * Components without a fromJSON override restore as enabled-flag-only via the
 * base implementation — still registered so restores never silently drop them.
 */
export function registerBuiltinComponents(): void {  registerComponent('MeshRenderer', MeshRenderer);
  registerComponent('LightComponent', LightComponent);
  registerComponent('CameraComponent', CameraComponent);
  registerComponent('RigidBody3D', RigidBody3D);
  registerComponent('Collider3D', Collider3D);
  registerComponent('MobileController', MobileController);
  registerComponent('ModelRenderer', ModelRenderer);
  registerComponent('HealthComponent', HealthComponent);
  registerComponent('EnemyAI', EnemyAI);
  registerComponent('AudioSource', AudioSource);
  registerComponent('WeaponController', WeaponController);
  registerComponent('ElementalReactionComponent', ElementalReactionComponent);
  registerComponent('AnimeCelShader', AnimeCelShader);
  registerComponent('CelShadingComponent', CelShadingComponent);
  registerComponent('EventSheet', EventSheet);
  registerComponent('AnimationController', AnimationController);
  registerComponent('BehaviorTreeComponent', BehaviorTreeComponent);
  registerComponent('Tween', Tween);
  registerComponent('TopDownMovement', TopDownMovement);
  registerComponent('Draggable', Draggable);
  registerComponent('DestroyOutsideScreen', DestroyOutsideScreen);
  registerComponent('PlatformerCharacter', PlatformerCharacter);
  registerComponent('Platform', Platform);
}

// Self-register on import so restores work without a manual init call.
// registerBuiltinComponents() remains public for explicit re-registration
// (e.g. tests resetting module state).
registerBuiltinComponents();
