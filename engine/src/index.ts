// Core ECS & Scene
export * from './core/Transform.js';
export * from './core/Component.js';
export * from './core/ComponentRegistry.js';
export * from './core/BuiltinComponents.js';
export * from './core/HistoryStack.js';
export * from './core/GameObject.js';
export * from './core/Scene.js';
export * from './core/EngineContext.js';
export * from './core/FloatingOrigin.js';

// Components
export * from './components/MeshRenderer.js';
export * from './components/LightComponent.js';
export * from './components/AudioSource.js';
export * from './components/HealthComponent.js';
export * from './components/EnemyAI.js';
export * from './components/CameraComponent.js';
export * from './components/RigidBody3D.js';
export * from './components/Collider3D.js';
export * from './components/MobileController.js';
export * from './audio/AudioManager.js';
export * from './audio/AudioMixer.js';
export * from './game/GameFlow.js';
export * from './game/WaveSpawner.js';
export * from './ui/GameShell.js';
export * from './ui/Localization.js';
export * from './game/DamageRouter.js';
export * from './game/GameSession.js';
export * from './game/GameRuntime.js';
export * from './simulation/Settlement.js';
export * from './game/SaveSystem.js';export * from './audio/AudioBackend.js';
export * from './audio/WebAudioBackend.js';
export * from './components/ModelRenderer.js';

// Events & Scripting
export * from './events/EventSheet.js';
export * from './dialogue/DialogueManager.js';

// Input & Physics
export * from './input/MobileInput.js';
export * from './input/InputActionMap.js';
export * from './physics/PhysicsWorld.js';

// AAA Engine Systems (Genshin, COD Mobile, Doom scope)
export * from './animation/BlendTree.js';
export * from './shaders/CelShader.js';
export * from './shaders/AnimeCelShader.js';
export * from './ai/BehaviorTree.js';
export * from './ai/ALifeSimulator.js';
export * from './weapons/WeaponController.js';
export * from './rendering/InstancedMeshBatcher.js';
export * from './rendering/FoliageInstancer.js';
export * from './rendering/LODManager.js';
export * from './rendering/DecalDispatcher.js';
export * from './rendering/LODManager.js';
export * from './terrain/TerrainChunk.js';
export * from './terrain/WorldStreamer.js';
export * from './terrain/StreamingCells.js';
export * from './terrain/QuadtreeTerrain.js';
export * from './combat/ElementalSystem.js';
export * from './prefabs/Prefab.js';
export * from './behaviors/Tween.js';
export * from './behaviors/TopDownMovement.js';
export * from './behaviors/Draggable.js';
export * from './behaviors/DestroyOutsideScreen.js';
export * from './behaviors/PlatformerCharacter.js';
export * from './behaviors/Platform.js';
export * from './behaviors/Pathfollow.js';
export * from './behaviors/Timer.js';
export * from './behaviors/Spawner.js';
export * from './behaviors/SaveSlot.js';
export * from './particles/ParticleSystem.js';
export * from './animation/AnimFSM.js';
export * from './cinematics/TimelineLite.js';
export * from './combat/ElementalReactionComponent.js';
export * from './vehicles/VehicleController.js';
export * from './ai/TrafficSystem.js';
export * from './spatial/SpatialGrid.js';
export * from './rendering/LODManager.js';
export * from './navigation/GridPathfinder.js';
export * from './simulation/EconomyTick.js';

// Large-Scale Simulation & Spatial Subsystems (Anno, Veloren, SS14, Warzone scope)
export * from './spatial/SpatialGrid.js';
export * from './navigation/GridPathfinder.js';
export * from './simulation/EconomyTick.js';
