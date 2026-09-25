/**
 * GameView — the fullscreen playable arena (menu → gameplay → win/lose → restart).
 *
 * Boots the engine scene from the SAME `fps_arena` scenario spec the headless QA
 * runs, wires the real `GameRuntime` (waves, weapon hit routing, damage, win/lose),
 * renders with a dedicated three.js renderer, and mounts the `GameShell` HUD.
 *
 * The player auto-aims at the nearest enemy and fires while playing, which keeps
 * the slice playable on touch-only devices without a second joystick.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  EngineContext,
  PhysicsWorld,
  GameRuntime,
  GameShell,
  SaveSystem,
  WeaponController,
  HealthComponent,
  MeshRenderer,
  EnemyAI,
  GameObject,
  type Scene as EngineScene
} from '@heretek/engine';
import { buildEngineScene } from '../services/HarnessSceneAdapter';
import type { HarnessScene } from '../services/SceneStore';
import fpsArenaSpec from '../../../harness/config/scenarios/fps_arena.json';

interface ArenaGameConfig {
  playerName?: string;
  totalWaves?: number;
  enemiesPerWave?: number;
  spawnRadius?: number;
  scorePerKill?: number;
  interWaveDelaySeconds?: number;
  enemy?: {
    shape?: string;
    size?: number[];
    color?: string;
    y?: number;
    health?: { maxHealth?: number; destroyOnDeath?: boolean };
    ai?: { moveSpeed?: number; attackRange?: number; attackDamage?: number; attackIntervalSeconds?: number };
  };
}

const PLAYER_START: [number, number, number] = [0, 1.5, 0];

export const GameView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const spec = fpsArenaSpec as unknown as HarnessScene;
    const gameConfig = (fpsArenaSpec as unknown as { game?: ArenaGameConfig }).game ?? {};
    const playerName = gameConfig.playerName ?? 'Player Hero';

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let shell: GameShell | null = null;
    let runtime: GameRuntime | null = null;
    let context: EngineContext | null = null;

    const boot = async () => {
      const scene = buildEngineScene(spec) as EngineScene;
      const player = scene.findByName(playerName);
      if (!player) throw new Error(`GameView: player "${playerName}" missing from the scenario spec`);
      const health = player.getComponent(HealthComponent);
      const weapon = player.getComponent(WeaponController);

      const physicsWorld = new PhysicsWorld();
      await physicsWorld.initialize();
      if (disposed) return; // StrictMode/unmount raced the async boot: abort cleanly
      scene.physicsWorld = physicsWorld;
      for (const go of scene.gameObjects) {
        for (const component of go.components) {
          const name = component.constructor.name;
          if (name === 'RigidBody3D' || name === 'Collider3D') {
            (component as unknown as { initPhysics(w: PhysicsWorld): void }).initPhysics(physicsWorld);
          }
        }
      }

      const enemySpec = gameConfig.enemy ?? {};
      const enemyHealth = enemySpec.health ?? { maxHealth: 50, destroyOnDeath: true };

      runtime = new GameRuntime({
        scene,
        playerName,
        totalWaves: gameConfig.totalWaves ?? 2,
        enemiesPerWave: () => gameConfig.enemiesPerWave ?? 1,
        spawnRadius: gameConfig.spawnRadius ?? 8,
        scorePerKill: gameConfig.scorePerKill ?? 100,
        interWaveDelaySeconds: gameConfig.interWaveDelaySeconds ?? 1,
        weapon: weapon ?? undefined,
        buildEnemy: ({ name, position }) => {
          const enemy = new GameObject(name);
          enemy.transform.setPosition(position[0], position[1] + (enemySpec.y ?? 0.8), position[2]);
          enemy.addComponent(
            new MeshRenderer({
              shape: (enemySpec.shape as 'box') ?? 'box',
              size: (enemySpec.size as [number, number, number]) ?? [1, 1.5, 1],
              color: enemySpec.color ?? '#ef4444',
              roughness: 0.5
            })
          );
          enemy.addComponent(new HealthComponent(enemyHealth));
          enemy.addComponent(new EnemyAI({ targetName: playerName, ...(enemySpec.ai ?? {}) }));
          scene.addGameObject(enemy);
          return enemy;
        }
      });

      const resetArena = () => {
        for (const name of runtime!.spawner.getSpawnedNames()) {
          scene.findByName(name)?.destroy();
        }
        player.transform.setPosition(PLAYER_START[0], PLAYER_START[1], PLAYER_START[2]);
        health?.heal(health.maxHealth);
      };

      const saveSystem = new SaveSystem();
      const SAVE_SLOT = 'arena';
      runtime.prepare();

      shell = new GameShell({
        flow: runtime.flow,
        session: runtime.session,
        title: 'Heretek Arena — Wave Defense',
        root: container,
        getHealthFraction: () => (health ? health.healthFraction : 1),
        onStart: () => {
          resetArena();
          runtime!.start();
        },
        onRestart: () => {
          resetArena();
          runtime!.restart();
        },
        onQuit: () => {
          runtime!.stop();
          resetArena();
        },
        hasSave: () => saveSystem.load(SAVE_SLOT) !== null,
        onSave: () => {
          saveSystem.save(SAVE_SLOT, runtime!.session.snapshot());
        },
        onLoad: () => {
          const envelope = saveSystem.load(SAVE_SLOT);
          if (!envelope) return;
          resetArena();
          runtime!.session.restore(envelope.session);
          if (runtime!.flow.getPhase() === 'menu') {
            runtime!.flow.transition('start');
          }
          runtime!.spawner.start();
        }
      });
      shell.mount();

      // Debug/QA surface (mirrors the studio's __STUDIO_DEBUG__ pattern).
      (window as unknown as Record<string, unknown>).__GAME_DEBUG__ = {
        phase: () => runtime!.flow.getPhase(),
        score: () => runtime!.session.getScore(),
        kills: () => runtime!.session.getKills(),
        wave: () => runtime!.spawner.getWave(),
        aliveEnemies: () => runtime!.spawner.getAliveCount(),
        weapon: () =>
          weapon
            ? { ammo: weapon.currentAmmo, reloading: weapon.isReloading, damage: weapon.damage, canFire: weapon.canFire() }
            : null,
        player: () => {
          const p = player.transform.position;
          const r = player.transform.rotation;
          return { x: p.x, y: p.y, z: p.z, pitch: r.x, yaw: r.y };
        },
        enemies: () =>
          runtime!.spawner.getSpawnedNames().map((name) => {
            const e = scene.findByName(name);
            return e ? { name, x: e.transform.position.x, y: e.transform.position.y, z: e.transform.position.z } : { name, dead: true };
          }),
        /** Raw handles for deep diagnostics (tests/agents). */
        _raw: () => ({ scene, player, weapon, flow: runtime!.flow, runtime: runtime! }),
        /** Fire one shot and return the raw HitResult (raycast diagnostics). */
        fire: () => (weapon ? weapon.fire() : null),
        /** Render-scene child transforms (raycast target diagnostics). */
        sceneProbe: () =>
          (scene.threeScene?.children ?? []).map((child) => ({
            name: child.userData?.gameObject?.name ?? child.name ?? child.type,
            type: child.type,
            position: child.position.toArray().map((v) => Number(v.toFixed(3))),
            visible: child.visible
          })),
        /** Scene graph size + mesh names in the render scene (raycast target list). */
        renderScene: () => ({
          objects: scene.gameObjects.length,
          threeChildren: scene.threeScene?.children.length ?? 0,
          named: (scene.threeScene?.children ?? []).map((child) => child.userData?.gameObject?.name ?? child.name ?? child.type)
        })
      };

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      container.prepend(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 300);
      const cameraTarget = new THREE.Vector3();

      context = new EngineContext();
      context.setScene(scene);

      const clock = new THREE.Clock();
      const aimAndFire = () => {
        if (!weapon || !runtime) return;
        let nearest: GameObject | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const name of runtime.spawner.getSpawnedNames()) {
          const enemy = scene.findByName(name);
          if (!enemy) continue;
          const distance = player.transform.position.distanceTo(enemy.transform.position);
          if (distance < best) {
            best = distance;
            nearest = enemy;
          }
        }
        if (!nearest) return;
        const p = player.transform.position;
        const e = nearest.transform.position;
        const dx = e.x - p.x;
        const dy = e.y - (p.y + 0.8);
        const dz = e.z - p.z;
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        player.transform.setRotation(pitch, yaw, 0);
        weapon.fire();
      };

      renderer.setAnimationLoop(() => {
        if (disposed || !renderer || !context || !runtime || !shell) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        if (runtime.flow.isPlaying()) {
          context.step(dt);
          aimAndFire();
        }
        runtime.update(dt);
        shell.update(dt);

        const p = player.transform.position;
        camera.position.lerp(new THREE.Vector3(p.x, p.y + 7, p.z + 11), 0.12);
        cameraTarget.lerp(new THREE.Vector3(p.x, p.y + 1, p.z), 0.2);
        camera.lookAt(cameraTarget);
        renderer.render(scene.threeScene, camera);
      });

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        if (runtime!.flow.isPlaying()) runtime!.flow.transition('pause');
        else if (runtime!.flow.getPhase() === 'paused') runtime!.flow.transition('resume');
      };
      window.addEventListener('keydown', onKeyDown);

      const onResize = () => {
        if (!renderer) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKeyDown);
      };
    };

    const teardown = () => {
      renderer?.setAnimationLoop(null);
      runtime?.stop();
      shell?.destroy();
      renderer?.dispose();
      if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
      renderer = null;
      runtime = null;
      shell = null;
      context = null;
    };

    const bootPromise = boot();
    return () => {
      disposed = true;
      // If the async boot is still in flight, tear its resources down when it lands.
      void bootPromise.then(() => teardown()).catch(() => teardown());
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="fixed inset-0 bg-black overflow-hidden" data-game-view="true" />;
};

export default GameView;
