import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { isNativeContainer, nativeDeviceLabel, readNativeDeviceInfo } from '../services/NativeBridge';
import { undoService } from '../services/UndoService';
import { sceneStore } from '../services/SceneStore';
import { buildEngineScene } from '../services/HarnessSceneAdapter';
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
  InputActionMap,
  AudioManager,
  NullAudioBackend,
  AudioMixer,
  NavGrid,
  NavAgent,
  LightProbeVolume,
  ColorGrade,
  CineCamera,
  TFIntegrator,
  probeTransformFeedback,
  Destructible,
  getDestructionPool,
  Telemetry,
  CrashReportCollector,
  RemoteConfig,
  FakeStoreBackend,
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
  /** Live viewport FPS (rounded, throttled at the source). 0 = unknown. */
  viewportFps: number;
  setViewportFps: (fps: number) => void;
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
  /** Transient toast (auto-dismisses; optional action button). */
  toast: StudioToast | null;
  showToast: (msg: string, action?: ToastAction) => void;
  dismissToast: () => void;
  /** Reload the engine scene from the canonical store (external changes). */
  reloadFromCanonical: () => Promise<boolean>;
  /** Canonical rev seen by the poller; null when a dirty tree holds a newer external rev. */
  pendingExternalRev: number | null;
  dismissExternal: () => void;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface StudioToast {
  msg: string;
  action?: ToastAction;
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
  const [viewportFps, setViewportFps] = useState<number>(0);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [logs, setLogs] = useState<StudioLog[]>([]);
  const [artemisRunning, setArtemisRunning] = useState<boolean>(false);
  const [artemisLog, setArtemisLog] = useState<string[]>([]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [snapping, setSnapping] = useState<boolean>(false);

  const sceneSnapshotRef = useRef<string | null>(null);
  const isPlayingRef = useRef<boolean>(false);

  // Destruction pool steps with the play loop (no-op when not playing).
  useEffect(() => {
    return engineContext.onTick((dt: number) => {
      if (isPlayingRef.current) getDestructionPool().update(dt);
    });
  }, [engineContext]);

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
      getNavState: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const agent = go.components.find((c: any) => c.constructor.name === 'NavAgent');
        if (!agent) return null;
        return {
          arrived: agent.arrived,
          distToGoal: Number(agent.distanceToGoal().toFixed(2)),
          waypointsLeft: agent.path.length,
          traversing: agent.traversing
        };
      },
      spawnNavProbe: () => {
        undoService.checkpoint(scene);
        const grid = new NavGrid(24, 24);
        const mkAgent = (name: string, sx: number, sz: number, gx: number, gz: number) => {
          const go = new GameObject(name);
          go.transform.setPosition(sx, 0, sz);
          const agent = go.addComponent(new NavAgent({ grid, speed: 3 }));
          scene.addGameObject(go);
          agent.setDestination(gx, gz);
          return agent;
        };
        const a = mkAgent('Probe Nav A', 2, 12, 21, 12);
        const b = mkAgent('Probe Nav B', 21, 12, 2, 12);
        for (const agent of [a, b]) {
          agent.setNeighborSampler(() => {
            const out: Array<{ x: number; z: number }> = [];
            for (const other of [a, b]) {
              if (other === agent) continue;
              const p = other.gameObject.transform.position;
              out.push({ x: p.x, z: p.z });
            }
            return out;
          });
        }
        setSelectedId(a.gameObject.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned nav crossing probe.');
        return ['Probe Nav A', 'Probe Nav B'];
      },
      getCineState: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const cine = go.components.find((c: any) => c.constructor.name === 'CineCamera');
        if (!cine) return null;
        const p = go.transform.position;
        return {
          shot: cine.activeShotId,
          trauma: Number(cine.trauma.toFixed(3)),
          cuts: cine.cutsTaken,
          lastCut: cine.lastCutShot,
          pos: [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))]
        };
      },
      spawnCineProbe: () => {
        undoService.checkpoint(scene);
        const cam = new GameObject('Probe Cine Cam');
        cam.transform.setPosition(0, 2, 8);
        cam.addComponent(new CameraComponent({ fov: 60 }));
        cam.addComponent(new CineCamera());
        scene.addGameObject(cam);
        const director = new GameObject('Probe Cine Director');
        director.addComponent(new TimelineLite({
          duration: 6,
          tracks: [{
            target: 'Probe Cine Cam',
            clips: [
              { id: 'probe-wide', start: 0, dur: 2, type: 'camera', data: { shot: 'wide', to: [0, 2, 8], cut: true } },
              { id: 'probe-push', start: 2, dur: 2, type: 'camera', data: { shot: 'push', to: [0, 1, 3], blend: 1.0, shake: { trauma: 1, decay: 1.5 } } },
              { id: 'probe-settle', start: 4, dur: 2, type: 'camera', data: { shot: 'settle', to: [0, 1, 3] } }
            ]
          }]
        }));
        scene.addGameObject(director);
        setSelectedId(cam.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned cinematic camera probe.');
        return ['Probe Cine Cam', 'Probe Cine Director'];
      },
      getDestructionState: (name: string) => {
        const go: any = scene.findByName(name);
        if (!go) return null;
        const d = go.components.find((c: any) => c.constructor.name === 'Destructible');
        if (!d) return null;
        const pool = getDestructionPool();
        return {
          fractured: d.fractured,
          fractures: d.fractureCount,
          live: pool.liveShards,
          merged: pool.mergedShards
        };
      },
      probeOperate: () => {
        // Operate stack through the real bundled engine: events (PII drop +
        // kids gate), scrubbed crash capture, staged remote config + cohort.
        const tele = new Telemetry({ enabled: true, build: 'probe' });
        tele.record('level_complete', { score: 900 });
        tele.record('signup', { email: 'a@b.com', nick: 'hero' });
        const kids = new Telemetry({ enabled: true, kidsMode: true });
        const kidsKept = kids.record('level_complete', { score: 1 });
        const kidsErr = kids.record('error', { code: 7 });
        const crashes = new CrashReportCollector({ enabled: true });
        crashes.leaveBreadcrumb('scene: probe');
        const report = crashes.captureException(
          new Error('boom at /home/john/studio/main.js')
        );
        const rc = new RemoteConfig({ defaults: { doubleXp: false }, build: 12 });
        const before = rc.getBool('doubleXp');
        const staged = rc.fetch(() => ({ doubleXp: true }));
        return staged.then((ok: boolean) => ({
          events: tele.countOf('level_complete'),
          piiDropped: tele.droppedPii,
          kidsKept,
          kidsErr,
          kidsDropped: kids.droppedKids,
          crashMsg: report ? report.message : null,
          crashClean: report ? !report.stack?.includes('/home/john') : false,
          flagBefore: before,
          fetched: ok,
          staged: rc.hasStaged,
          flagAfter: (rc.activate(), rc.getBool('doubleXp')),
          cohort: rc.gated('doubleXp', 50)
        }));
      },
      probeStore: () => {
        // Store flows through the real bundled FakeBackend (async).
        const store = new FakeStoreBackend({
          catalog: [
            { sku: 'coins100', kind: 'consumable', title: '100 Coins', priceMicros: 990000, currency: 'USD' },
            { sku: 'pro', kind: 'non_consumable', title: 'Pro', priceMicros: 4990000, currency: 'USD' }
          ],
          seed: 7
        });
        return (async () => {
          await store.signIn(true);
          const bought = await store.purchase('coins100');
          const acked = await store.acknowledge(bought.orderId);
          const consumed = await store.consume(bought.orderId);
          const reconsumed = await store.consume(bought.orderId);
          const pro = await store.purchase('pro');
          const restored = await store.restorePurchases();
          await store.cloudPut('save1', '{"level":3}');
          return {
            granted: bought.state,
            acked,
            consumed,
            reconsumed,
            proKept: restored.some(r => r.sku === 'pro'),
            cloud: await store.cloudGet('save1'),
            ledger: store.ledgerSize
          };
        })();
      },
      spawnWreckProbe: () => {
        undoService.checkpoint(scene);
        const crate = new GameObject('Probe Crate');
        crate.transform.setPosition(0, 3, 0);
        crate.addComponent(new MeshRenderer({ shape: 'box', size: [2, 2, 2], color: '#a16207' }));
        crate.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 2 }));
        crate.addComponent(new Collider3D({ shape: 'box', size: [2, 2, 2] }));
        crate.addComponent(new Destructible({ impulseThreshold: 5, dustBurst: 8 }));
        scene.addGameObject(crate);
        const ball = new GameObject('Probe Wrecker');
        ball.transform.setPosition(0, 10, 0);
        ball.addComponent(new MeshRenderer({ shape: 'sphere', size: [1, 1, 1], color: '#ef4444' }));
        ball.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 12 }));
        ball.addComponent(new Collider3D({ shape: 'sphere', size: [1, 1, 1] }));
        scene.addGameObject(ball);
        setSelectedId(crate.id);
        refreshScene();
        addLog('info', 'Scene', 'Spawned wrecking-ball probe.');
        return ['Probe Crate', 'Probe Wrecker'];
      },
      probeLightRig: () => {
        // Read-only rig audit over the live scene: bake one probe from the
        // real lights, sample every mesh, grade one LUT lookup.
        const toLinear = (hex: string): [number, number, number] => {
          const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
          if (!m) return [1, 1, 1];
          const v = parseInt(m[1], 16);
          return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
        };
        const lights: Array<{ kind: 'directional' | 'point' | 'ambient'; color: [number, number, number]; intensity: number; direction?: [number, number, number]; position?: [number, number, number] }> = [];
        const meshPoints: Array<[number, number, number]> = [];
        for (const go of scene.gameObjects) {
          const comps: any[] = go.components;
          for (const comp of comps) {
            const name = comp.constructor.name;
            if (name === 'LightComponent') {
              const color = toLinear(comp.color);
              const intensity = comp.intensity ?? 1;
              if (comp.lightType === 'ambient') lights.push({ kind: 'ambient', color, intensity });
              else if (comp.lightType === 'directional') {
                const p = go.transform.position;
                const len = Math.hypot(p.x, p.y, p.z) || 1;
                lights.push({ kind: 'directional', color, intensity, direction: [p.x / len, p.y / len, p.z / len] });
              } else {
                const p = go.transform.position;
                lights.push({ kind: 'point', color, intensity, position: [p.x, p.y, p.z] });
              }
            } else if (name === 'MeshRenderer' || name === 'ModelRenderer') {
              const p = go.transform.position;
              meshPoints.push([p.x, p.y, p.z]);
            }
          }
        }
        const volume = new LightProbeVolume({ probes: [{ position: [0, 3, 0], radius: 25 }] });
        volume.bake(lights);
        const hero = meshPoints[0] ?? [0, 0, 0];
        const sample = volume.sample(hero[0], hero[1], hero[2]);
        const grade = new ColorGrade({ size: 8, preset: 'sunset', amount: 0.6 });
        return {
          lights: lights.length,
          meshes: meshPoints.length,
          sample: { color: sample.color.map(v => Number(v.toFixed(4))), covered: sample.covered },
          coverage: Number(volume.coverage(meshPoints).toFixed(3)),
          graded: grade.grade(0.9, 0.5, 0.2).map(v => Number(v.toFixed(4)))
        };
      },
      probeTFParticles: () => {
        // Live transform-feedback self-test on a scratch WebGL2 context:
        // compiles the integrator, runs one pass, compares vs CPU Euler.
        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl2');
          const probe = probeTransformFeedback(gl);
          if (!probe.supported || !gl) {
            return { supported: false, pass: false, reason: probe.reason };
          }
          const tf = new TFIntegrator(gl);
          const result = tf.selfTest();
          tf.dispose();
          const lose = gl.getError();
          return {
            supported: true,
            pass: result.pass && lose === gl.NO_ERROR,
            maxError: result.maxError,
            detail: result.detail,
            glError: lose
          };
        } catch (error) {
          return { supported: false, pass: false, reason: String(error) };
        }
      },
      probeInputMap: () => {
        // End-to-end through the real capture path: synthetic key events on
        // window flow through MobileInput listeners into a fresh action map.
        const map = new InputActionMap({
          actions: {
            jump: { type: 'button', bindings: [{ source: 'key', code: 'Space' }] },
            move: {
              type: 'axis2',
              bindings: [
                { source: 'key', code: 'KeyW', output2: [0, 1] },
                { source: 'key', code: 'KeyS', output2: [0, -1] },
                { source: 'key', code: 'KeyA', output2: [-1, 0] },
                { source: 'key', code: 'KeyD', output2: [1, 0] }
              ]
            }
          }
        });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
        const move = map.getAxis2('move');
        const jumpBefore = map.getButton('jump');
        map.inject('jump', true, 1);
        const jumpDuring = map.getButton('jump');
        map.endFrame();
        const jumpAfter = map.getButton('jump');
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
        const moveAfter = map.getAxis2('move');
        return { move, jumpBefore, jumpDuring, jumpAfter, moveAfter };
      },
      probeAudioMixer: () => {
        // Mixer math through the real bundled engine: two looping voices,
        // dialogue ducks music, 2s of stepped fades.
        const manager = new AudioManager(new NullAudioBackend());
        manager.registerClip('probe-song');
        manager.registerClip('probe-voice');
        const mixer = new AudioMixer({
          buses: { music: { gainDb: -6 }, dialogue: {} },
          duckRules: [{ trigger: 'dialogue', target: 'music', depthDb: -12, attack: 0.05, release: 0.3 }]
        });
        manager.setMixer(mixer);
        manager.play('probe-song', { bus: 'music', loop: true });
        manager.play('probe-voice', { bus: 'dialogue', loop: true });
        for (let i = 0; i < 120; i++) manager.update(1 / 60);
        return {
          music: Number(mixer.voiceGain('music', 1).toFixed(4)),
          dialogue: Number(mixer.voiceGain('dialogue', 1).toFixed(4)),
          audibility: mixer.getAudibility('music'),
          voices: manager.getVoiceCount()
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

  // Track D.2 toast + external-change sync (Godot scan pattern, adapted).
  const [toast, setToast] = useState<StudioToast | null>(null);
  const [pendingExternalRev, setPendingExternalRev] = useState<number | null>(null);
  const knownRev = useRef<number | null>(null);
  const extRevRef = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string, action?: ToastAction) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ msg, action });
    toastTimer.current = window.setTimeout(() => setToast(null), 9000);
  };
  const dismissToast = () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(null);
  };

  const reloadFromCanonical = async (): Promise<boolean> => {
    try {
      const spec = await sceneStore.fetchScene();
      const prevName = selectedGameObject?.name ?? null;
      const next = buildEngineScene(spec);
      engineContext.setScene(next);
      setScene(next);
      undoService.clear();
      setSelectedId(
        prevName && next.gameObjects.some(g => g.name === prevName)
          ? next.gameObjects.find(g => g.name === prevName)!.id
          : null
      );
      refreshScene();
      if (typeof spec.rev === 'number') knownRev.current = spec.rev;
      setPendingExternalRev(null);
      showToast('Scene reloaded from canonical store.');
      return true;
    } catch (err) {
      showToast(`Reload failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  const dismissExternal = () => {
    // Keep local edits: adopt the external rev so the poller stops nagging.
    if (pendingExternalRev !== null) knownRev.current = pendingExternalRev;
    extRevRef.current = pendingExternalRev;
    setPendingExternalRev(null);
    dismissToast();
  };
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const reloadRef = useRef(reloadFromCanonical);
  reloadRef.current = reloadFromCanonical;

  // Poll the canonical revision (3 s, paused in play mode): clean trees
  // auto-refresh with a toast; dirty trees get Reload/Keep instead of a
  // silent overwrite (non-clobber invariant).
  useEffect(() => {
    if (isPlaying) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/scene?rev=1');
        if (!res.ok) return;
        const data = await res.json();
        const rev = typeof data.rev === 'number' ? data.rev : 0;
        if (knownRev.current === null) {
          knownRev.current = rev;
          return;
        }
        if (rev === knownRev.current || rev === extRevRef.current) return;
        if (undoService.canUndo) {
          extRevRef.current = rev;
          setPendingExternalRev(rev);
          showToastRef.current(
            `Scene changed externally (rev ${rev}) — your edits are preserved.`,
            { label: 'Reload', run: () => reloadRef.current() }
          );
        } else {
          knownRev.current = rev;
          reloadRef.current().catch(() => {});
        }
      } catch {
        // Dev-server bridge absent (packaged build): stay quiet.
      }
    };
    const id = window.setInterval(poll, 3000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

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
    isPlayingRef.current = true;

    // Attach physics world to scene so scene.update steps Rapier simulation every frame
    scene.physicsWorld = physicsWorld;

    // Initialize physics for all dynamic & static bodies
    for (const go of scene.gameObjects) {
      const rb = go.getComponent(RigidBody3D);
      const col = go.getComponent(Collider3D);
      if (rb) rb.initPhysics(physicsWorld);
      if (col) col.initPhysics(physicsWorld);
    }

    // Destruction pool rides the play loop (contact dispatch + shard budgets).
    getDestructionPool().attachWorld(physicsWorld);

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
    isPlayingRef.current = false;
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
        viewportFps,
        setViewportFps,
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
        setSnapping,
        toast,
        showToast,
        dismissToast,
        reloadFromCanonical,
        pendingExternalRev,
        dismissExternal
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
