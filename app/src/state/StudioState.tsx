import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { isNativeContainer, nativeDeviceLabel, readNativeDeviceInfo } from '../services/NativeBridge';
import { undoService } from '../services/UndoService';
import {
  Scene,
  GameObject,
  MeshRenderer,
  LightComponent,
  CameraComponent,
  RigidBody3D,
  Collider3D,
  MobileController,
  EventSheet,
  EngineContext,
  PhysicsWorld,
  instantiatePrefab,
  ParticleSystem,
  AnimFSM,
  TimelineLite,
  type PrefabStore
} from '@heretek/engine';

export interface DeviceInfo {
  id: string;
  model: string;
  status: string;
  isEmulator: boolean;
  battery?: number;
  apiLevel?: string;
}

export interface StudioLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'ai';
  source: string;
  message: string;
}

export type GizmoMode = 'translate' | 'rotate' | 'scale';

interface StudioStateContextType {
  scene: Scene;
  engineContext: EngineContext;
  physicsWorld: PhysicsWorld;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedGameObject: GameObject | null;
  isPlaying: boolean;
  isPaused: boolean;
  /** Live viewport camera position (world units), used by LOD/A-Life analysis. */
  cameraPosition: { x: number; y: number; z: number };
  setCameraPosition: (x: number, y: number, z: number) => void;
  startPlayMode: () => void;
  pausePlayMode: () => void;
  stopPlayMode: () => void;
  refreshScene: () => void;
  addPrimitive: (shape: 'box' | 'sphere' | 'cylinder' | 'plane' | 'light' | 'camera') => GameObject;
  deleteSelected: () => void;
  /** Clears prefab linkage on the selected object (baked components stay). */
  detachPrefab: () => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  devices: DeviceInfo[];
  selectedDevice: string | null;
  setSelectedDevice: (id: string) => void;
  refreshDevices: () => Promise<void>;
  logs: StudioLog[];
  addLog: (level: StudioLog['level'], source: string, message: string) => void;
  clearLogs: () => void;
  artemisRunning: boolean;
  artemisLog: string[];
  runArtemisTask: (prompt: string) => Promise<void>;
  deployToDevice: (tier?: 1 | 2) => Promise<void>;
  gizmoMode: GizmoMode;
  setGizmoMode: (mode: GizmoMode) => void;
  snapping: boolean;
  setSnapping: React.Dispatch<React.SetStateAction<boolean>>;
}

const StudioStateContext = createContext<StudioStateContextType | null>(null);

export const StudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scene, setScene] = useState<Scene>(() => new Scene('MainScene'));
  const [engineContext] = useState<EngineContext>(() => new EngineContext());
  const [physicsWorld] = useState<PhysicsWorld>(() => new PhysicsWorld());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [cameraPosition, setCameraPositionState] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 10, z: 15 });

  const setCameraPosition = (x: number, y: number, z: number) => {
    setCameraPositionState(prev =>
      Math.abs(prev.x - x) > 0.2 || Math.abs(prev.y - y) > 0.2 || Math.abs(prev.z - z) > 0.2
        ? { x, y, z }
        : prev
    );
  };
  const [tick, setTick] = useState<number>(0);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [logs, setLogs] = useState<StudioLog[]>([]);
  const [artemisRunning, setArtemisRunning] = useState<boolean>(false);
  const [artemisLog, setArtemisLog] = useState<string[]>([]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [snapping, setSnapping] = useState<boolean>(false);

  const sceneSnapshotRef = useRef<string | null>(null);

  const refreshScene = () => setTick(t => t + 1);

  const addLog = (level: StudioLog['level'], source: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: time,
      level,
      source,
      message
    }]);
  };

  const clearLogs = () => setLogs([]);

  // QA / automation debug hook: exposes live scene introspection for
  // chrome-devtools verification (transform sampling, event inspection, play state).
  useEffect(() => {
    (window as any).__STUDIO_DEBUG__ = {
      objectCount: () => scene.gameObjects.length,
      objectNames: () => scene.gameObjects.map((g: any) => g.name),
      isPlaying: () => isPlaying,
      getTransform: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        return {
          position: [go.transform.position.x, go.transform.position.y, go.transform.position.z],
          rotation: [go.transform.rotation.x, go.transform.rotation.y, go.transform.rotation.z],
          scale: [go.transform.scale.x, go.transform.scale.y, go.transform.scale.z]
        };
      },
      getEvents: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const es = go.getComponent(EventSheet);
        return es ? JSON.parse(JSON.stringify(es.events)) : [];
      },
      getEventTrace: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const es = go.getComponent(EventSheet);
        return es && typeof es.getTrace === 'function'
          ? JSON.parse(JSON.stringify(es.getTrace()))
          : [];
      },
      getParticleState: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const ps = go.components.find((c: any) => c.constructor.name === 'ParticleSystem');
        if (!ps) return null;
        return {
          alive: ps.aliveCount,
          emitting: ps.emitting,
          enabled: ps.enabled,
          active: go.active,
          rate: ps.rate,
          maxParticles: ps.maxParticles,
          frame: engineContext.frameCount
        };
      },
      getComponents: (name: string) => {
        const go: any = scene.findByName(name);
        return go
          ? go.components.map((c: any) => c.toJSON?.().type ?? c.constructor.name)
          : null;
      },
      getPrefabLink: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        return { prefabId: go.prefabId ?? null, prefabBase: go.prefabBase ?? null };
      },
      spawnPrefabProbe: () => {
        const store: PrefabStore = new Map([
          ['probe-crate', {
            id: 'probe-crate',
            template: { shape: 'box', size: [1, 1, 1], color: '#8b5cf6', physics: 'none' }
          }],
          ['probe-crate-heavy', {
            id: 'probe-crate-heavy',
            base: 'probe-crate',
            overrides: { color: '#ef4444' }
          }]
        ]);
        undoService.checkpoint(scene);
        const a = instantiatePrefab(scene, store, 'probe-crate', 'Probe Crate A');
        const b = instantiatePrefab(scene, store, 'probe-crate-heavy', 'Probe Crate B');
        setSelectedId(a.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned prefab probe instances.');
        return [a.name, b.name];
      },
      spawnEventProbe: () => {
        undoService.checkpoint(scene);
        const go = new GameObject('Probe Spinner');
        go.transform.setPosition(0, 3, 0);
        go.addComponent(new MeshRenderer({ shape: 'box', size: [1, 1, 1], color: '#f59e0b' }));
        go.addComponent(new EventSheet([
          {
            id: 'probe-spin',
            name: 'Probe Spin',
            enabled: true,
            conditions: [{ type: 'EveryFrame' }],
            actions: [{ type: 'RotateY', params: { speed: 1 } }]
          },
          {
            id: 'probe-slow',
            name: 'Probe Slow Pulse',
            enabled: true,
            conditions: [{ type: 'Timer', params: { name: 'probe', interval: 5 } }],
            actions: [{ type: 'SetColor', params: { color: '#10b981' } }]
          }
        ]));
        scene.addGameObject(go);
        setSelectedId(go.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned event-trace probe.');
        return go.name;
      },
      spawnParticleProbe: () => {
        undoService.checkpoint(scene);
        const go = new GameObject('Probe Fountain');
        go.transform.setPosition(0, 1, 0);
        go.addComponent(new ParticleSystem({
          rate: 60,
          maxParticles: 300,
          shape: 'sphere',
          shapeSize: [0.5, 0.5, 0.5],
          direction: [0, 1, 0],
          spread: 0.4,
          speedMin: 2,
          speedMax: 5,
          gravity: 5,
          lifetimeMin: 0.8,
          lifetimeMax: 1.6,
          sizeMin: 0.25,
          sizeMax: 0.5,
          startColor: '#ffaa00',
          endColor: '#ef4444',
          seed: 7
        }));
        scene.addGameObject(go);
        setSelectedId(go.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned particle probe.');
        return go.name;
      },
      spawnAnimProbe: () => {
        undoService.checkpoint(scene);
        const mover = new GameObject('Probe Mover');
        mover.transform.setPosition(0, 1, 0);
        scene.addGameObject(mover);
        const dancer = new GameObject('Probe Dancer');
        dancer.transform.setPosition(3, 1, 0);
        dancer.addComponent(new AnimFSM({
          states: {
            Idle: { clip: 'idle', clipLength: 2.0 },
            Run: { clip: 'run', clipLength: 1.0 }
          },
          initial: 'Idle',
          params: { speed: 3 },
          transitions: [
            { from: 'Idle', to: 'Run', conditions: [{ param: 'speed', op: '>', value: 0.5 }] }
          ]
        }));
        scene.addGameObject(dancer);
        const director = new GameObject('Probe Director');
        director.addComponent(new TimelineLite({
          duration: 4,
          tracks: [{
            target: 'Probe Mover',
            clips: [
              { id: 'pm-move', start: 1, dur: 2, type: 'move', data: { to: [6, 1, 0] } },
              { id: 'pm-done', start: 3, type: 'event', data: { name: 'probe-finale' } }
            ]
          }]
        }));
        scene.addGameObject(director);
        setSelectedId(dancer.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned anim/FSM + timeline probe.');
        return ['Probe Mover', 'Probe Dancer', 'Probe Director'];
      },
      getLogs: () => logs.map((l: any) => `${l.level}|${l.source}|${l.message}`)
    };
    return () => {
      delete (window as any).__STUDIO_DEBUG__;
    };
  }, [scene, engineContext, isPlaying, logs]);

  // Undo service: refresh binding + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y shortcuts.
  useEffect(() => {
    undoService.bindRefresh(refreshScene);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redo();
        }
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scene]);

  const isInitializedRef = useRef(false);

  // Initialize Default Starter Scene
  useEffect(() => {
    if (isInitializedRef.current || scene.gameObjects.length > 0) return;
    isInitializedRef.current = true;

    engineContext.setScene(scene);
    physicsWorld.initialize().catch(console.error);

    // Directional Sun Light
    const sun = new GameObject('Directional Sun');
    sun.transform.setPosition(8, 15, 10);
    sun.addComponent(new LightComponent({ type: 'directional', intensity: 2.2, castShadow: true }));
    scene.addGameObject(sun);

    // Ambient Fill Light
    const ambient = new GameObject('Ambient Light');
    ambient.addComponent(new LightComponent({ type: 'ambient', intensity: 0.65 }));
    scene.addGameObject(ambient);

    // Cyan Point Light Accent
    const cyanLight = new GameObject('Cyan Accent Light');
    cyanLight.transform.setPosition(-6, 3.5, -4);
    cyanLight.addComponent(new LightComponent({ type: 'point', intensity: 3.5, color: '#06b6d4' }));
    scene.addGameObject(cyanLight);

    // Ground Arena (30 x 1 x 30)
    const ground = new GameObject('Ground Arena');
    ground.transform.setPosition(0, -0.5, 0);
    ground.addComponent(new MeshRenderer({
      shape: 'box',
      size: [30, 1, 30],
      color: '#18181b',
      roughness: 0.7,
      metalness: 0.3
    }));
    ground.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    ground.addComponent(new Collider3D({ shape: 'box', size: [30, 1, 30] }));
    scene.addGameObject(ground);

    // Perimeter Barrier Walls
    const wallThickness = 1;
    const wallHeight = 2.5;
    const arenaSize = 30;

    const northWall = new GameObject('North Barrier');
    northWall.transform.setPosition(0, wallHeight / 2, -arenaSize / 2);
    northWall.addComponent(new MeshRenderer({ shape: 'box', size: [arenaSize, wallHeight, wallThickness], color: '#3f3f46' }));
    northWall.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    northWall.addComponent(new Collider3D({ shape: 'box', size: [arenaSize, wallHeight, wallThickness] }));
    scene.addGameObject(northWall);

    const southWall = new GameObject('South Barrier');
    southWall.transform.setPosition(0, wallHeight / 2, arenaSize / 2);
    southWall.addComponent(new MeshRenderer({ shape: 'box', size: [arenaSize, wallHeight, wallThickness], color: '#3f3f46' }));
    southWall.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    southWall.addComponent(new Collider3D({ shape: 'box', size: [arenaSize, wallHeight, wallThickness] }));
    scene.addGameObject(southWall);

    const eastWall = new GameObject('East Barrier');
    eastWall.transform.setPosition(arenaSize / 2, wallHeight / 2, 0);
    eastWall.addComponent(new MeshRenderer({ shape: 'box', size: [wallThickness, wallHeight, arenaSize], color: '#3f3f46' }));
    eastWall.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    eastWall.addComponent(new Collider3D({ shape: 'box', size: [wallThickness, wallHeight, arenaSize] }));
    scene.addGameObject(eastWall);

    const westWall = new GameObject('West Barrier');
    westWall.transform.setPosition(-arenaSize / 2, wallHeight / 2, 0);
    westWall.addComponent(new MeshRenderer({ shape: 'box', size: [wallThickness, wallHeight, arenaSize], color: '#3f3f46' }));
    westWall.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    westWall.addComponent(new Collider3D({ shape: 'box', size: [wallThickness, wallHeight, arenaSize] }));
    scene.addGameObject(westWall);

    // Player Hero
    const player = new GameObject('Player Hero');
    player.transform.setPosition(0, 1.5, 0);
    player.addComponent(new MeshRenderer({
      shape: 'capsule',
      size: [1, 2, 1],
      color: '#3b82f6',
      roughness: 0.25,
      metalness: 0.3
    }));
    player.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 2.0, lockRotations: true }));
    player.addComponent(new Collider3D({ shape: 'capsule', size: [1, 2, 1] }));
    player.addComponent(new MobileController({ moveSpeed: 8.0, jumpForce: 8.5 }));
    scene.addGameObject(player);

    // Visor on Player
    const visor = new GameObject('Player Visor');
    visor.transform.setPosition(0, 0.4, -0.45);
    visor.addComponent(new MeshRenderer({
      shape: 'box',
      size: [0.65, 0.2, 0.3],
      color: '#38bdf8',
      roughness: 0.1,
      metalness: 0.8
    }));
    player.transform.addChild(visor.transform);
    scene.addGameObject(visor);

    // Bonus Crates (Stacked physics obstacles)
    const crateA = new GameObject('Bonus Crate A');
    crateA.transform.setPosition(3, 1, -4);
    crateA.addComponent(new MeshRenderer({
      shape: 'box',
      size: [1.6, 1.6, 1.6],
      color: '#f59e0b',
      roughness: 0.35
    }));
    crateA.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 1.5 }));
    crateA.addComponent(new Collider3D({ shape: 'box', size: [1.6, 1.6, 1.6] }));
    scene.addGameObject(crateA);

    const crateB = new GameObject('Bonus Crate B');
    crateB.transform.setPosition(3, 2.7, -4);
    crateB.addComponent(new MeshRenderer({
      shape: 'box',
      size: [1.4, 1.4, 1.4],
      color: '#d97706',
      roughness: 0.35
    }));
    crateB.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 1.0 }));
    crateB.addComponent(new Collider3D({ shape: 'box', size: [1.4, 1.4, 1.4] }));
    scene.addGameObject(crateB);

    // Collectible Gold Coin
    const coin = new GameObject('Gold Coin');
    coin.transform.setPosition(-4, 1.2, -3);
    coin.addComponent(new MeshRenderer({
      shape: 'cylinder',
      size: [1.0, 0.2, 1.0],
      color: '#eab308',
      roughness: 0.2,
      metalness: 0.8
    }));
    coin.addComponent(new EventSheet([
      {
        id: 'spin_coin',
        name: 'Idle Spin',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'RotateY', params: { speed: 2.5 } }]
      }
    ]));
    scene.addGameObject(coin);

    // Monster Minion
    const minion = new GameObject('Monster Minion');
    minion.transform.setPosition(-5, 1.6, 4);
    minion.addComponent(new MeshRenderer({
      shape: 'sphere',
      size: [1.4, 1.4, 1.4],
      color: '#ef4444',
      roughness: 0.3,
      metalness: 0.4
    }));
    minion.addComponent(new EventSheet([
      {
        id: 'spin_minion',
        name: 'Minion Pulse',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'RotateY', params: { speed: 1.2 } }]
      }
    ]));
    scene.addGameObject(minion);

    setSelectedId(player.id);
    refreshScene();
    addLog('info', 'Studio', '🎮 Hero Arena 3D Scene loaded (Single instance, PBR lighting, Physics Barriers).');
    refreshDevices();
  }, []);

  const addPrimitive = (shape: 'box' | 'sphere' | 'cylinder' | 'plane' | 'light' | 'camera'): GameObject => {
    undoService.checkpoint(scene);    let go: GameObject;
    switch (shape) {
      case 'light':
        go = new GameObject('Point Light');
        go.transform.setPosition(0, 3, 0);
        go.addComponent(new LightComponent({ type: 'point', intensity: 3.0 }));
        break;
      case 'camera':
        go = new GameObject('Sub Camera');
        go.transform.setPosition(0, 5, 10);
        go.addComponent(new CameraComponent({ fov: 60 }));
        break;
      case 'plane':
        go = new GameObject('Plane');
        go.transform.setPosition(0, 0, 0);
        go.addComponent(new MeshRenderer({ shape: 'box', size: [5, 0.2, 5], color: '#64748b' }));
        go.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
        go.addComponent(new Collider3D({ shape: 'box', size: [5, 0.2, 5] }));
        break;
      case 'sphere':
        go = new GameObject('Sphere');
        go.transform.setPosition(0, 3, 0);
        go.addComponent(new MeshRenderer({ shape: 'sphere', size: [1.5, 1.5, 1.5], color: '#ec4899' }));
        go.addComponent(new RigidBody3D({ bodyType: 'dynamic' }));
        go.addComponent(new Collider3D({ shape: 'sphere', size: [1.5, 1.5, 1.5] }));
        break;
      case 'cylinder':
        go = new GameObject('Cylinder');
        go.transform.setPosition(0, 2, 0);
        go.addComponent(new MeshRenderer({ shape: 'cylinder', size: [1.2, 2, 1.2], color: '#10b981' }));
        go.addComponent(new RigidBody3D({ bodyType: 'dynamic' }));
        go.addComponent(new Collider3D({ shape: 'cylinder', size: [1.2, 2, 1.2] }));
        break;
      case 'box':
      default:
        go = new GameObject('Box');
        go.transform.setPosition(0, 2, 0);
        go.addComponent(new MeshRenderer({ shape: 'box', size: [1.5, 1.5, 1.5], color: '#8b5cf6' }));
        go.addComponent(new RigidBody3D({ bodyType: 'dynamic' }));
        go.addComponent(new Collider3D({ shape: 'box', size: [1.5, 1.5, 1.5] }));
        break;
    }

    scene.addGameObject(go);
    setSelectedId(go.id);
    refreshScene();
    addLog('info', 'Scene', `Added ${go.name} to hierarchy.`);
    return go;
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const go = scene.findById(selectedId);
    if (go) {
      undoService.checkpoint(scene);
      go.destroy();
      setSelectedId(null);
      refreshScene();
      addLog('info', 'Scene', `Deleted ${go.name}`);
    }
  };

  const detachPrefab = () => {
    if (!selectedId) return;
    const go = scene.findById(selectedId);
    if (go && go.prefabId) {
      undoService.checkpoint(scene);
      const source = go.prefabId;
      go.prefabId = null;
      go.prefabBase = null;
      refreshScene();
      addLog('info', 'Scene', `Detached ${go.name} from prefab '${source}' (components kept).`);
    }
  };

  const undo = () => {
    const ok = undoService.undo(scene);
    if (ok) {
      setSelectedId(null);
      addLog('info', 'Scene', 'Undo applied.');
    }
    return ok;
  };

  const redo = () => {
    const ok = undoService.redo(scene);
    if (ok) {
      setSelectedId(null);
      addLog('info', 'Scene', 'Redo applied.');
    }
    return ok;
  };

  const startPlayMode = () => {
    sceneSnapshotRef.current = JSON.stringify(scene.toJSON());
    setIsPlaying(true);
    setIsPaused(false);

    // Attach physics world to scene so scene.update steps Rapier simulation every frame
    scene.physicsWorld = physicsWorld;

    // Initialize physics for all dynamic & static bodies
    for (const go of scene.gameObjects) {
      const rb = go.getComponent(RigidBody3D);
      const col = go.getComponent(Collider3D);
      if (rb) rb.initPhysics(physicsWorld);
      if (col) col.initPhysics(physicsWorld);
    }

    engineContext.start();
    addLog('info', 'PlayMode', '▶ Play mode started. Physics simulation and Mobile Input active.');
  };

  const pausePlayMode = () => {
    setIsPaused(p => !p);
    if (!isPaused) {
      engineContext.pause();
      addLog('info', 'PlayMode', '⏸ Play mode paused.');
    } else {
      engineContext.resume();
      addLog('info', 'PlayMode', '▶ Play mode resumed.');
    }
  };

  const stopPlayMode = () => {
    engineContext.stop();
    setIsPlaying(false);
    setIsPaused(false);
    scene.physicsWorld = null;

    // Reset player position cleanly
    const player = scene.findByName('Player Hero');
    if (player) {
      const rb = player.getComponent(RigidBody3D);
      if (rb) {
        rb.setPosition(0, 1.5, 0);
      } else {
        player.transform.setPosition(0, 1.5, 0);
      }
    }

    addLog('info', 'PlayMode', '⏹ Play mode stopped.');
    refreshScene();
  };

  const refreshDevices = async () => {
    // Packaged APK: no dev server, so the native bridge is the device context.
    const nativeInfo = readNativeDeviceInfo();
    if (nativeInfo) {
      const device: DeviceInfo = {
        id: 'native-container',
        model: nativeDeviceLabel(nativeInfo),
        status: 'native',
        isEmulator: nativeInfo.model.toLowerCase().includes('sdk') || nativeInfo.device.toLowerCase().includes('emu'),
        apiLevel: String(nativeInfo.sdkInt)
      };
      setDevices([device]);
      setSelectedDevice(device.id);
      addLog(
        'info',
        'Native',
        `Running inside the Android container: ${device.model} · ${nativeInfo.packageName} v${nativeInfo.appVersion}`
      );
      addLog('warn', 'Native', 'Dev-server bridges (/api/devices, /api/deploy, /api/qa, /api/swarm) are unavailable in the packaged build.');
      return;
    }
    try {
      const res = await fetch('/api/devices');
      if (!res.ok) throw new Error(`device bridge HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'device detection failed');

      const detected: DeviceInfo[] = (data.devices || []).map((d: any) => ({
        id: d.id,
        model: d.model,
        status: d.status,
        isEmulator: Boolean(d.isEmulator)
      }));
      setDevices(detected);
      if (detected.length > 0 && !detected.some(d => d.id === selectedDevice)) {
        setSelectedDevice(detected[0].id);
      }
      if (detected.length === 0) {
        setSelectedDevice(null);
        addLog('info', 'ADB', 'No Android devices/emulators attached (adb devices -l returned 0).');
      } else {
        addLog('info', 'ADB', `Detected ${detected.length} device(s): ${detected.map(d => d.model).join(', ')}`);
      }
    } catch (e: any) {
      setDevices([]);
      addLog('warn', 'ADB', `Device bridge unavailable: ${e.message}`);
    }
  };

  const deployToDevice = async (tier: 1 | 2 = 1) => {
    const tierLabel = tier === 2 ? 'Tier 2 native Vulkan' : 'Tier 1 WebView';
    const real = tier === 2; // native library build is the Tier 2 deliverable (no Gradle required)
    addLog('info', 'Deploy', `📦 Packaging ${tierLabel} via apk_builder (${real ? 'real build' : 'dry-run'})${selectedDevice ? ` · device ${selectedDevice}` : ''}…`);
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: selectedDevice, real, tier })
      });
      const data = await res.json();
      const resultMatch = (data.stdout || '').match(/Result: (\{.*\})/);
      if (resultMatch) {
        const result = JSON.parse(resultMatch[1]);
        if (tier === 2) {
          addLog(result.success ? 'info' : 'error', 'Deploy', `Scene exported: ${result.scene_exported} | native library: ${result.native_library || 'not built'}`);
          const counts = result.scene_summary?.counts;
          if (counts) {
            addLog('info', 'Deploy', `scene.native: ${counts.meshes} meshes, ${counts.lights} lights, ${counts.terrainLodLeaves} terrain LOD leaves (draws ${result.scene_summary.drawCalls}/${result.scene_summary.drawBudget})`);
          }
        } else {
          addLog(result.success ? 'info' : 'error', 'Deploy', `Bundle built: ${result.bundle_built} | assets synced: ${result.assets_synced}`);
        }
        if (result.apk_path) addLog('info', 'Deploy', `APK target: ${result.apk_path}`);
        addLog(result.success ? 'info' : 'error', 'Deploy', result.message);
        if (!selectedDevice) {
          addLog('warn', 'Deploy', 'No device attached — packaging verified, on-device deployment skipped.');
        }
      } else if (data.ok) {
        addLog('info', 'Deploy', (data.stdout || 'packaging finished').slice(-300));
      } else {
        addLog('error', 'Deploy', `Packaging failed: ${(data.stderr || data.stdout || 'unknown error').slice(0, 300)}`);
      }
    } catch (e: any) {
      addLog('error', 'Deploy', `Deploy bridge unavailable: ${e.message}`);
    }
  };

  const runArtemisTask = async (prompt: string) => {
    setArtemisRunning(true);
    setArtemisLog([]);
    const append = (msg: string) => {
      setArtemisLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
      addLog('ai', 'Artemis', msg);
    };

    try {
      append('🤖 Dispatching headless QA to the real engine runtime (Rapier3D + EventSheet)...');
      const res = await fetch('/api/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: prompt })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const report = await res.json();
      append(`🎯 Task: "${report.goal || prompt}" — scenario: ${report.scenario || 'active_scene'}`);
      for (const rule of report.rules || []) {
        append(`${rule.pass ? '✅' : '❌'} [rule] ${rule.id}: ${rule.detail}`);
      }
      const m = report.metrics || {};
      append(
        `⚡ Telemetry (headless engine): ${m.simFpsEstimate} sim FPS | frame ${m.avgFrameTimeMs}ms (p95 ${m.p95FrameTimeMs}ms) | draw calls ${m.drawCallEstimate}/100 | heap ${m.memoryHeapMb}MB`
      );
      for (const finding of report.regressions || []) {
        append(`⚠ Regression vs baseline: ${finding}`);
      }
      append(
        `🏁 Verdict: ${report.verdict} — ${report.passed}/${report.total} rules passed (confidence ${(100 * (report.confidence || 0)).toFixed(0)}%)`
      );
      addLog(report.verdict === 'SUCCEEDED' ? 'info' : 'warn', 'Artemis', `QA verdict: ${report.verdict}`);
    } catch (err: any) {
      append(`⚠ QA bridge unavailable (${err.message}). The live runner needs the Vite dev server; offline equivalent: python3 harness/agents/artemis_qa_runner.py --goal "..."`);
      addLog('warn', 'Artemis', `QA bridge error: ${err.message}`);
    } finally {
      setArtemisRunning(false);
    }
  };

  const selectedGameObject = selectedId ? scene.findById(selectedId) : null;

  return (
    <StudioStateContext.Provider
      value={{
        scene,
        engineContext,
        physicsWorld,
        selectedId,
        setSelectedId,
        selectedGameObject,
        isPlaying,
        isPaused,
        cameraPosition,
        setCameraPosition,
        startPlayMode,
        pausePlayMode,
        stopPlayMode,
        refreshScene,
        addPrimitive,
        deleteSelected,
        detachPrefab,
        undo,
        redo,
        canUndo: undoService.canUndo,
        canRedo: undoService.canRedo,
        devices,
        selectedDevice,
        setSelectedDevice,
        refreshDevices,
        logs,
        addLog,
        clearLogs,
        artemisRunning,
        artemisLog,
        runArtemisTask,
        deployToDevice,
        gizmoMode,
        setGizmoMode,
        snapping,
        setSnapping
      }}
    >
      {children}
    </StudioStateContext.Provider>
  );
};

export const useStudio = () => {
  const ctx = useContext(StudioStateContext);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
};
