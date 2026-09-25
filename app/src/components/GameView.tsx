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
  VehicleController,
  RigidBody3D,
  Collider3D,
  GameObject,
  type Scene as EngineScene
} from '@heretek/engine';
import { buildEngineScene } from '../services/HarnessSceneAdapter';
import type { HarnessScene } from '../services/SceneStore';
import fpsArenaSpec from '../../../harness/config/scenarios/fps_arena.json';
import drivingSliceSpec from '../../../harness/config/scenarios/driving_slice.json';

/** `?play=driving` boots the driving slice; anything else boots the arena. */
type GameKind = 'arena' | 'driving';

const gameKindFromUrl = (): GameKind => {
  if (typeof window === 'undefined') return 'arena';
  return new URLSearchParams(window.location.search).get('play') === 'driving' ? 'driving' : 'arena';
};

interface ArenaGameConfig {
  mode?: 'waves' | 'distance';
  playerName?: string;
  targetScore?: number;
  timeLimitSeconds?: number;
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

    const kind = gameKindFromUrl();
    const rawSpec = kind === 'driving' ? drivingSliceSpec : fpsArenaSpec;
    const spec = rawSpec as unknown as HarnessScene;
    const gameConfig = (rawSpec as unknown as { game?: ArenaGameConfig }).game ?? {};
    const playerName = gameConfig.playerName ?? (kind === 'driving' ? 'Player Car' : 'Player Hero');

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
      const vehicle = player.getComponent(VehicleController);
      const playerBody = player.getComponent(RigidBody3D);

      const physicsWorld = new PhysicsWorld();
      await physicsWorld.initialize();
      if (disposed) return; // StrictMode/unmount raced the async boot: abort cleanly
      scene.physicsWorld = physicsWorld;
      // instanceof dispatch: class names are mangled by the production minifier, so
      // `constructor.name` checks silently skip physics initialisation in the APK.
      for (const go of scene.gameObjects) {
        for (const component of go.components) {
          if (component instanceof RigidBody3D || component instanceof Collider3D) {
            (component as unknown as { initPhysics(w: PhysicsWorld): void }).initPhysics(physicsWorld);
          }
        }
      }

      const enemySpec = gameConfig.enemy ?? {};
      const enemyHealth = enemySpec.health ?? { maxHealth: 50, destroyOnDeath: true };

      runtime = new GameRuntime({
        scene,
        mode: kind === 'driving' ? 'distance' : 'waves',
        playerName,
        targetScore: gameConfig.targetScore,
        timeLimitSeconds: gameConfig.timeLimitSeconds,
        totalWaves: gameConfig.totalWaves ?? 2,
        enemiesPerWave: () => gameConfig.enemiesPerWave ?? 1,
        spawnRadius: gameConfig.spawnRadius ?? 8,
        scorePerKill: gameConfig.scorePerKill ?? 100,
        interWaveDelaySeconds: gameConfig.interWaveDelaySeconds ?? 1,
        weapon: kind === 'arena' ? weapon ?? undefined : undefined,
        buildEnemy: kind === 'arena' ? ({ name, position }) => {
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
        } : undefined
      });

      const resetArena = () => {
        for (const name of runtime!.spawner.getSpawnedNames()) {
          scene.findByName(name)?.destroy();
        }
        player.transform.setPosition(PLAYER_START[0], PLAYER_START[1], PLAYER_START[2]);
        player.transform.setRotation(0, 0, 0);
        playerBody?.setPosition(PLAYER_START[0], PLAYER_START[1], PLAYER_START[2]);
        health?.heal(health.maxHealth);
        if (vehicle) {
          vehicle.throttle = 0;
          vehicle.steering = 0;
          vehicle.brake = 0;
        }
      };

      const saveSystem = new SaveSystem();
      const SAVE_SLOT = 'arena';
      runtime.prepare();

      shell = new GameShell({
        flow: runtime.flow,
        session: runtime.session,
        title: kind === 'driving' ? 'Heretek Drive — Avenue Sprint' : 'Heretek Arena — Wave Defense',
        hud:
          kind === 'driving'
            ? { scoreLabel: 'Distance', scoreSuffix: 'm', showWave: false, showKills: false, showHealth: false }
            : undefined,
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
        /** Driving telemetry (vehicle input + solver state). */
        vehicle: () =>
          vehicle
            ? {
                throttle: vehicle.throttle,
                steering: vehicle.steering,
                brake: vehicle.brake,
                grounded: vehicle.wheelStates.some((wheel) => wheel.grounded),
                wheelCount: vehicle.wheelStates.length
              }
            : null,
        /** Physics-body position (independent of the transform sync). */
        bodyPosition: () => {
          const body = playerBody?.rapierBody;
          if (!body) return null;
          const t = body.translation();
          return { x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), z: Number(t.z.toFixed(2)) };
        },
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

      // Driving input: keyboard steering/throttle plus touch steering by screen half.
      const keys = new Set<string>();
      let touchSteer: number | null = null;
      const onGameKeyDown = (event: KeyboardEvent) => keys.add(event.key.toLowerCase());
      const onGameKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
      const onPointer = (event: PointerEvent) => {
        if (kind !== 'driving') return;
        const half = container.clientWidth / 2;
        touchSteer = Math.max(-1, Math.min(1, (event.clientX - container.getBoundingClientRect().left - half) / (half * 0.6)));
      };
      const onPointerUp = () => { touchSteer = null; };
      window.addEventListener('keydown', onGameKeyDown);
      window.addEventListener('keyup', onGameKeyUp);
      container.addEventListener('pointerdown', onPointer);
      container.addEventListener('pointermove', onPointer);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointerleave', onPointerUp);

      const updateDrivingInput = () => {
        if (!vehicle) return;
        const throttleKey = keys.has('w') || keys.has('arrowup');
        const brakeKey = keys.has('s') || keys.has('arrowdown');
        let steer = 0;
        if (keys.has('a') || keys.has('arrowleft')) steer += 1;
        if (keys.has('d') || keys.has('arrowright')) steer -= 1;
        if (steer === 0 && touchSteer !== null && Math.abs(touchSteer) > 0.15) steer = -touchSteer;
        vehicle.steering = steer;
        vehicle.brake = brakeKey ? 1 : 0;
        // Auto-cruise keeps the slice playable on touch-only devices; releasing
        // the throttle keys simply coasts at a moderate speed.
        vehicle.throttle = brakeKey ? 0 : throttleKey ? 1 : 0.6;
      };

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

      // On-device telemetry: mirror key state into logcat through the native bridge
      // (the packaged WebView has no devtools, so this is the only live view).
      const nativeBridge = (window as unknown as { AndroidBridge?: { log?: (tag: string, message: string) => void } })
        .AndroidBridge;
      let lastTelemetryAt = 0;

      renderer.setAnimationLoop(() => {
        if (disposed || !renderer || !context || !runtime || !shell) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        if (runtime.flow.isPlaying()) {
          if (kind === 'driving') {
            updateDrivingInput();
          } else {
            aimAndFire();
          }
          context.step(dt);
        }
        runtime.update(dt);
        shell.update(dt);

        if (nativeBridge?.log && kind === 'driving') {
          const now = performance.now();
          if (now - lastTelemetryAt > 2000) {
            lastTelemetryAt = now;
            const body = playerBody?.rapierBody;
            const t = body?.translation();
            nativeBridge.log(
              'DriveTelemetry',
              JSON.stringify({
                phase: runtime.flow.getPhase(),
                distance: Number(runtime.getTraveledDistance().toFixed(2)),
                throttle: vehicle?.throttle ?? null,
                steering: vehicle?.steering ?? null,
                wheels: vehicle?.wheelStates.length ?? 0,
                grounded: vehicle?.wheelStates.filter((wheel) => wheel.grounded).length ?? 0,
                body: t ? { x: Number(t.x.toFixed(2)), z: Number(t.z.toFixed(2)) } : null
              })
            );
          }
        }

        const p = player.transform.position;
        if (kind === 'driving') {
          camera.position.lerp(new THREE.Vector3(p.x, p.y + 4.5, p.z + 9), 0.18);
          cameraTarget.lerp(new THREE.Vector3(p.x, p.y + 0.8, p.z - 4), 0.25);
        } else {
          camera.position.lerp(new THREE.Vector3(p.x, p.y + 7, p.z + 11), 0.12);
          cameraTarget.lerp(new THREE.Vector3(p.x, p.y + 1, p.z), 0.2);
        }
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
        window.removeEventListener('keydown', onGameKeyDown);
        window.removeEventListener('keyup', onGameKeyUp);
        container.removeEventListener('pointerdown', onPointer);
        container.removeEventListener('pointermove', onPointer);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointerleave', onPointerUp);
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
