import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStudio } from '../state/StudioState';
import { MobileInput, RigidBody3D } from '@heretek/engine';
import { GDevelopAssetService } from '../services/GDevelopAssetService';
import { GhostPreview, probePlacement, snapToGrid } from '../services/GhostPreview';
import {
  Maximize2,
  Eye,
  Camera,
  Layers,
  Smartphone,
  Move,
  RotateCw,
  Scaling
} from 'lucide-react';

export const Viewport3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const {
    scene,
    selectedGameObject,
    setSelectedId,
    isPlaying,
    refreshScene,
    gizmoMode,
    setGizmoMode,
    snapping,
    setCameraPosition,
    setViewportFps
  } = useStudio();
  const [showDeviceFrame, setShowDeviceFrame] = useState(false);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [actionPulse, setActionPulse] = useState(false);
  const [playerCoords, setPlayerCoords] = useState({ x: '0.0', y: '1.5', z: '0.0' });
  // B.3 ghost placement preview (agent-proposed positions render BEFORE writes)
  const [ghostMode, setGhostMode] = useState(false);
  const [ghostInfo, setGhostInfo] = useState<string | null>(null);
  const ghostModeRef = useRef(false);
  ghostModeRef.current = ghostMode;
  const ghostRef = useRef<GhostPreview | null>(null);
  const snappingRef = useRef(snapping);
  snappingRef.current = snapping;

  const joystickContainerRef = useRef<HTMLDivElement>(null);
  const joystickOriginRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingJoystickRef = useRef(false);

  // Transform Gizmo refs
  const transformControlsRef = useRef<TransformControls | null>(null);
  const selectedGameObjectRef = useRef(selectedGameObject);
  selectedGameObjectRef.current = selectedGameObject;

  // Sync TransformControls mode dynamically
  useEffect(() => {
    if (transformControlsRef.current) {
      transformControlsRef.current.setMode(gizmoMode);
    }
  }, [gizmoMode]);

  // Sync TransformControls snapping dynamically
  useEffect(() => {
    if (transformControlsRef.current) {
      transformControlsRef.current.setTranslationSnap(snapping ? 1.0 : null);
      transformControlsRef.current.setRotationSnap(snapping ? Math.PI / 12 : null);
      transformControlsRef.current.setScaleSnap(snapping ? 0.25 : null);
    }
  }, [snapping]);

  // B.3 ghost preview at a world XZ point (shared by ground clicks and the
  // default preview shown when ghost mode is entered).
  const previewGhostAt = (x: number, z: number) => {
    if (!ghostRef.current) return;
    const p = snappingRef.current ? snapToGrid(x, z) : { x, z };
    const spec = { shape: 'box' as const, size: [1, 1, 1] as [number, number, number], position: [p.x, 1, p.z] as [number, number, number] };
    ghostRef.current.show(spec);
    setGhostInfo('probing…');
    probePlacement(spec).then(
      verdict => {
        ghostRef.current?.setValidity(verdict.valid);
        const first = verdict.defects[0] ?? 'walkable + supported';
        setGhostInfo(`${verdict.valid ? 'VALID' : 'BLOCKED'} @ (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) — ${first}`);
      },
      () => setGhostInfo('probe unavailable (dev server?)')
    );
  };
  const previewGhostAtRef = useRef(previewGhostAt);
  previewGhostAtRef.current = previewGhostAt;

  // Default ghost when ghost mode is entered (same path as ground clicks).
  useEffect(() => {
    if (ghostMode) previewGhostAtRef.current(0, 4);
  }, [ghostMode]);

  // Global keyboard shortcuts (W: translate, E: rotate, R: scale, G: ghost preview)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (isPlaying) return;

      if (e.key === 'w' || e.key === 'W') {
        setGizmoMode('translate');
      } else if (e.key === 'e' || e.key === 'E') {
        setGizmoMode('rotate');
      } else if (e.key === 'r' || e.key === 'R') {
        setGizmoMode('scale');
      } else if (e.key === 'g' || e.key === 'G') {
        setGhostMode(f => {
          if (f) {
            ghostRef.current?.hide();
            setGhostInfo(null);
          }
          return !f;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  // Global pointer release listener
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (isDraggingJoystickRef.current) {
        isDraggingJoystickRef.current = false;
        setJoystickActive(false);
        joystickOriginRef.current = null;
        setJoystickPos({ x: 0, y: 0 });
        MobileInput.instance.setJoystick('left', 0, 0);
      }
    };
    window.addEventListener('pointerup', handleGlobalRelease);
    window.addEventListener('pointercancel', handleGlobalRelease);
    return () => {
      window.removeEventListener('pointerup', handleGlobalRelease);
      window.removeEventListener('pointercancel', handleGlobalRelease);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 15);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Helpers (Grid & Axes)
    const grid = new THREE.GridHelper(30, 30, 0x3b82f6, 0x3f3f46);
    grid.position.y = 0.01;
    scene.threeScene.add(grid);

    // Selection Bounding Box Helper
    const boxHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x60a5fa);
    boxHelper.visible = false;
    scene.threeScene.add(boxHelper);

    // B.3 ghost preview (one translucent mesh, green/red by audit validity)
    ghostRef.current = new GhostPreview(scene.threeScene);

    // TransformControls & 3D Manipulator Gizmo
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControlsRef.current = transformControls;
    transformControls.setMode(gizmoMode);
    const transformHelper = transformControls.getHelper();
    scene.threeScene.add(transformHelper);
    transformHelper.visible = false;

    // Transform proxy synced to selected entity
    const transformProxy = new THREE.Object3D();
    transformProxy.name = '__studio_transform_proxy__';
    scene.threeScene.add(transformProxy);

    let isGizmoDragging = false;
    transformControls.addEventListener('dragging-changed', (event: any) => {
      isGizmoDragging = !!event.value;
    });

    transformControls.addEventListener('objectChange', () => {
      if (selectedGameObjectRef.current) {
        const go = selectedGameObjectRef.current;
        go.transform.position.copy(transformProxy.position);
        go.transform.rotation.copy(transformProxy.rotation);
        go.transform.scale.copy(transformProxy.scale);
        const rb = go.getComponent(RigidBody3D);
        if (rb && (rb as any).body) {
          (rb as any).body.setTranslation(
            { x: transformProxy.position.x, y: transformProxy.position.y, z: transformProxy.position.z },
            true
          );
          const q = transformProxy.quaternion;
          (rb as any).body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        }
      }
    });

    if (selectedGameObject && !isPlaying) {
      transformProxy.position.copy(selectedGameObject.transform.position);
      transformProxy.rotation.copy(selectedGameObject.transform.rotation);
      transformProxy.scale.copy(selectedGameObject.transform.scale);
      transformControls.attach(transformProxy);
      transformHelper.visible = true;
    } else {
      transformControls.detach();
      transformHelper.visible = false;
    }

    // Orbit Controls (Simple custom implementation without external dependency)
    let isDragging = false;
    let isPanning = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let spherical = { radius: 18, phi: Math.PI / 4, theta: Math.PI / 4 };
    let target = new THREE.Vector3(0, 1, 0);

    const updateCamera = () => {
      if (isPlaying) {
        // In Play Mode: Camera smoothly follows player
        const player = scene.findByName('Player Hero');
        if (player) {
          const pp = player.transform.position;
          camera.position.set(pp.x, pp.y + 6, pp.z + 10);
          camera.lookAt(pp.x, pp.y + 1, pp.z);
          return;
        }
      }

      camera.position.x = target.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z = target.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.lookAt(target);
    };

    updateCamera();

    let pointerDownPos = { x: 0, y: 0 };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      if (isGizmoDragging) return;
      if (e.button === 0) isDragging = true;
      if (e.button === 2) isPanning = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isGizmoDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      if (isDragging && !isPlaying) {
        spherical.theta -= dx * 0.006;
        spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.phi - dy * 0.006));
        updateCamera();
      } else if (isPanning && !isPlaying) {
        const panSpeed = 0.015;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        target.addScaledVector(right, -dx * panSpeed);
        target.addScaledVector(forward, dy * panSpeed);
        updateCamera();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      isDragging = false;
      isPanning = false;

      // Click-to-select raycasting: if mouse didn't drag more than 4 pixels
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist < 5 && !isGizmoDragging && !isPlaying && e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);

        // B.3 ghost mode: click previews a placement (grid-snapped) and asks
        // the spatial audit for validity BEFORE anything is written.
        if (ghostModeRef.current && ghostRef.current) {
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const hitPoint = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
            previewGhostAtRef.current(hitPoint.x, hitPoint.z);
          }
          return;
        }

        const validObjects = scene.threeScene.children.filter(
          c => c !== grid && c !== boxHelper && c !== transformHelper && c !== transformProxy && !c.userData?.isGhost
        );
        const intersects = raycaster.intersectObjects(validObjects, true);

        let hitGameObjectId: string | null = null;
        for (const hit of intersects) {
          let curr: THREE.Object3D | null = hit.object;
          while (curr) {
            if (curr.userData?.gameObject?.id) {
              hitGameObjectId = curr.userData.gameObject.id;
              break;
            }
            curr = curr.parent;
          }
          if (hitGameObjectId) break;
        }

        if (hitGameObjectId) {
          setSelectedId(hitGameObjectId);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (isPlaying) return;
      spherical.radius = Math.max(2, Math.min(60, spherical.radius + e.deltaY * 0.02));
      updateCamera();
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    canvas.addEventListener('contextmenu', onContextMenu);

    // Resize Handler
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    // Initialize Mobile Keyboard Input listener
    MobileInput.instance.initListeners(window);

    // Animation Loop
    let animId: number;
    let lastCoordUpdate = 0;
    let lastCamReport = { x: 0, y: 0, z: 0 };
    let lastFpsUpdate = 0;
    let frameCounter = 0;
    const animate = (timestamp: number) => {
      animId = requestAnimationFrame(animate);
      frameCounter++;

      // Report viewport FPS to studio state (2 Hz) for the status bar.
      if (timestamp - lastFpsUpdate > 500) {
        const elapsed = (timestamp - lastFpsUpdate) / 1000;
        if (elapsed > 0 && lastFpsUpdate > 0) {
          setViewportFps(Math.round(frameCounter / elapsed));
        }
        frameCounter = 0;
        lastFpsUpdate = timestamp;
      }

      // Report camera position to studio state (throttled) for LOD/A-Life analysis
      const cam = camera.position;
      if (
        Math.abs(cam.x - lastCamReport.x) > 0.5 ||
        Math.abs(cam.y - lastCamReport.y) > 0.5 ||
        Math.abs(cam.z - lastCamReport.z) > 0.5
      ) {
        lastCamReport = { x: cam.x, y: cam.y, z: cam.z };
        setCameraPosition(cam.x, cam.y, cam.z);
      }

      if (isPlaying) {
        updateCamera();

        // Update player coordinates periodically
        if (timestamp - lastCoordUpdate > 100) {
          lastCoordUpdate = timestamp;
          const player = scene.findByName('Player Hero');
          if (player) {
            const pp = player.transform.position;
            setPlayerCoords({
              x: pp.x.toFixed(1),
              y: pp.y.toFixed(1),
              z: pp.z.toFixed(1)
            });
          }
        }

        // Visually mirror WASD keys on joystick knob when not dragging
        if (!isDraggingJoystickRef.current) {
          const jx = MobileInput.instance.leftJoystick.x;
          const jy = MobileInput.instance.leftJoystick.y;
          setJoystickPos({ x: jx * 32, y: -jy * 32 });
        }
      }

      // Update Selection Box Helper & Transform Proxy
      if (selectedGameObject && !isPlaying) {
        if (!isGizmoDragging) {
          transformProxy.position.copy(selectedGameObject.transform.position);
          transformProxy.rotation.copy(selectedGameObject.transform.rotation);
          transformProxy.scale.copy(selectedGameObject.transform.scale);
        }
        const mr = selectedGameObject.components.find((c: any) => c.threeMesh || c.loadedRoot) as any;
        const targetMesh = mr?.threeMesh || mr?.loadedRoot;
        if (targetMesh) {
          boxHelper.setFromObject(targetMesh);
          boxHelper.visible = true;
        } else {
          boxHelper.setFromObject(transformProxy);
          boxHelper.visible = true;
        }
      } else {
        boxHelper.visible = false;
      }

      renderer.render(scene.threeScene, camera);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
      transformControls.dispose();
      transformControlsRef.current = null;
      ghostRef.current?.dispose();
      ghostRef.current = null;
      scene.threeScene.remove(grid);
      scene.threeScene.remove(boxHelper);
      scene.threeScene.remove(transformHelper);
      scene.threeScene.remove(transformProxy);
    };
  }, [isPlaying, selectedGameObject]);

  // Pointer-Captured Virtual Joystick Handlers
  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!joystickContainerRef.current) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    isDraggingJoystickRef.current = true;
    setJoystickActive(true);

    const rect = joystickContainerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    joystickOriginRef.current = { x: centerX, y: centerY };

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 36;

    let nx = dx;
    let ny = dy;
    if (dist > maxRadius) {
      nx = (dx / dist) * maxRadius;
      ny = (dy / dist) * maxRadius;
    }

    setJoystickPos({ x: nx, y: ny });
    MobileInput.instance.setJoystick('left', nx / maxRadius, -ny / maxRadius);
  };

  const handleJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingJoystickRef.current || !joystickOriginRef.current) return;
    e.preventDefault();

    const dx = e.clientX - joystickOriginRef.current.x;
    const dy = e.clientY - joystickOriginRef.current.y;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 36;

    let nx = dx;
    let ny = dy;
    if (dist > maxRadius) {
      nx = (dx / dist) * maxRadius;
      ny = (dy / dist) * maxRadius;
    }

    setJoystickPos({ x: nx, y: ny });
    MobileInput.instance.setJoystick('left', nx / maxRadius, -ny / maxRadius);
  };

  const handleJoystickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingJoystickRef.current) return;
    e.preventDefault();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}

    isDraggingJoystickRef.current = false;
    setJoystickActive(false);
    joystickOriginRef.current = null;
    setJoystickPos({ x: 0, y: 0 });
    MobileInput.instance.setJoystick('left', 0, 0);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const rawData = e.dataTransfer.getData('application/json');
    if (!rawData) return;
    try {
      const data = JSON.parse(rawData);
      if (data.type === 'gdevelop-asset' && data.asset) {
        let spawnPos: [number, number, number] = [0, 1.5, 0];
        if (cameraRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const hitPoint = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
            spawnPos = [hitPoint.x, 1.5, hitPoint.z];
          }
        }
        await GDevelopAssetService.getInstance().installAssetToScene(data.asset, scene, spawnPos);
        refreshScene();
      }
    } catch (err) {
      console.error('Failed to handle asset drop:', err);
    }
  };

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
      className={`relative w-full h-full bg-zinc-950 overflow-hidden flex items-center justify-center ${
        showDeviceFrame ? 'p-6 bg-zinc-900' : ''
      }`}
    >
      {/* 3D Canvas Viewport */}
      <div
        className={`relative w-full h-full transition-all ${
          showDeviceFrame
            ? 'max-w-[420px] max-h-[880px] rounded-[36px] overflow-hidden border-8 border-zinc-800 shadow-2xl shadow-black ring-1 ring-white/10'
            : ''
        }`}
      >
        <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

        {/* Viewport Overlay Controls (Gizmo modes & camera presets) */}
        {!isPlaying && (
          <div className="absolute top-3 left-3 flex items-center space-x-1 bg-studio-surface/80 backdrop-blur-md border border-studio-border/60 rounded-md p-1 shadow-lg">
            <button
              onClick={() => setGizmoMode('translate')}
              title="Translate (W)"
              className={`p-1.5 rounded text-xs transition-colors ${
                gizmoMode === 'translate' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setGizmoMode('rotate')}
              title="Rotate (E)"
              className={`p-1.5 rounded text-xs transition-colors ${
                gizmoMode === 'rotate' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setGizmoMode('scale')}
              title="Scale (R)"
              className={`p-1.5 rounded text-xs transition-colors ${
                gizmoMode === 'scale' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <Scaling className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-px bg-studio-border mx-0.5" />
            <button
              onClick={() => {
                setGhostMode(f => {
                  if (f) {
                    ghostRef.current?.hide();
                    setGhostInfo(null);
                  }
                  return !f;
                });
              }}
              title="Ghost placement preview (B.3): click ground to audit a 1u box BEFORE writing"
              className={`p-1.5 rounded text-xs transition-colors ${
                ghostMode ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-px bg-studio-border mx-0.5" />
            <button
              onClick={() => setShowDeviceFrame(f => !f)}
              title="Toggle Mobile Device Frame"
              className={`p-1.5 rounded text-xs transition-colors ${
                showDeviceFrame ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* B.3 ghost verdict badge */}
        {!isPlaying && ghostMode && ghostInfo && (
          <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-md text-[11px] font-mono text-zinc-200 border border-white/10 shadow-lg max-w-[420px]">
            {ghostInfo}
          </div>
        )}

        {/* Play Mode Mobile HUD & On-Screen Touch Controls */}
        {isPlaying && (
          <div className="absolute inset-0 pointer-events-none select-none">
            {/* Top Bar HUD */}
            <div className="absolute top-3 inset-x-3 flex items-center justify-between">
              {/* Left Status & Telemetry */}
              <div className="flex items-center space-x-2">
                <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full text-[11px] font-mono text-emerald-400 border border-emerald-500/30 flex items-center space-x-2 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="font-semibold">HERO ARENA LIVE</span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-zinc-300">Pos: ({playerCoords.x}, {playerCoords.y}, {playerCoords.z})</span>
                </div>
              </div>

              {/* Center Health Bar */}
              <div className="hidden sm:flex flex-col items-center bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-xl border border-white/10 shadow-lg">
                <div className="flex items-center justify-between w-36 text-[10px] font-mono text-zinc-300 mb-1">
                  <span>HP</span>
                  <span className="text-emerald-400 font-bold">100 / 100</span>
                </div>
                <div className="w-36 h-2 bg-zinc-800 rounded-full overflow-hidden border border-white/10">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full w-full" />
                </div>
              </div>

              {/* Right Controls Help Pill */}
              <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full text-[11px] font-mono text-zinc-300 border border-white/10 flex items-center space-x-3 shadow-lg">
                <span className="text-blue-400">WASD / Stick: Move</span>
                <span className="text-amber-400">Space: Jump</span>
                <span className="text-red-400">E/F: Action</span>
              </div>
            </div>

            {/* Action Visual Pulse Indicator */}
            {actionPulse && (
              <div className="absolute inset-0 border-4 border-red-500/40 pointer-events-none animate-pulse" />
            )}

            {/* Virtual Left Analog Joystick */}
            <div
              ref={joystickContainerRef}
              className={`absolute bottom-8 left-8 w-32 h-32 rounded-full bg-zinc-900/60 backdrop-blur-md border-2 ${
                joystickActive ? 'border-blue-400 shadow-blue-500/30 ring-4 ring-blue-500/20' : 'border-white/20'
              } flex items-center justify-center pointer-events-auto cursor-pointer shadow-2xl transition-colors touch-none select-none`}
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
            >
              {/* Inner crosshairs / directional ticks */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
                <div className="w-full h-px bg-white" />
                <div className="h-full w-px bg-white absolute" />
              </div>
              <div className="absolute inset-2 rounded-full border border-dashed border-white/15 pointer-events-none" />

              {/* Joystick Movable Knob */}
              <div
                className={`w-14 h-14 rounded-full ${
                  joystickActive
                    ? 'bg-blue-500 shadow-blue-500/60 scale-105'
                    : 'bg-blue-600/90 shadow-blue-500/40'
                } border-2 border-white shadow-xl flex items-center justify-center pointer-events-none transition-transform duration-75`}
                style={{
                  transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`
                }}
              >
                <div className="w-5 h-5 rounded-full bg-white/40 shadow-inner" />
              </div>
            </div>

            {/* Virtual Action Buttons (Right) */}
            <div className="absolute bottom-8 right-8 flex flex-col items-center space-y-3 pointer-events-auto select-none">
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('jump', true);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('jump', false);
                }}
                onPointerLeave={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('jump', false);
                }}
                className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 active:from-amber-500 active:to-amber-300 text-white font-black text-xs shadow-xl shadow-amber-500/40 border-2 border-amber-200 flex flex-col items-center justify-center active:scale-95 transition-all touch-none"
              >
                <span>JUMP</span>
                <span className="text-[9px] text-amber-200 font-mono font-normal">SPACE</span>
              </button>

              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('fire', true);
                  MobileInput.instance.setButton('action', true);
                  setActionPulse(true);
                  setTimeout(() => setActionPulse(false), 250);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('fire', false);
                  MobileInput.instance.setButton('action', false);
                }}
                onPointerLeave={(e) => {
                  e.preventDefault();
                  MobileInput.instance.setButton('fire', false);
                  MobileInput.instance.setButton('action', false);
                }}
                className="w-14 h-14 rounded-full bg-gradient-to-tr from-red-600 to-rose-400 active:from-red-500 active:to-rose-300 text-white font-black text-xs shadow-xl shadow-red-500/40 border-2 border-red-200 flex flex-col items-center justify-center active:scale-95 transition-all touch-none"
              >
                <span>ATTACK</span>
                <span className="text-[9px] text-red-200 font-mono font-normal">E / F</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
