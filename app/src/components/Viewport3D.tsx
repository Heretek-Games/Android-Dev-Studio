import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStudio } from '../state/StudioState';
import { MobileInput } from '@heretek/engine';
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
  const {
    scene,
    selectedGameObject,
    setSelectedId,
    isPlaying,
    refreshScene
  } = useStudio();

  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [showDeviceFrame, setShowDeviceFrame] = useState(false);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [actionPulse, setActionPulse] = useState(false);
  const [playerCoords, setPlayerCoords] = useState({ x: '0.0', y: '1.5', z: '0.0' });

  const joystickContainerRef = useRef<HTMLDivElement>(null);
  const joystickOriginRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingJoystickRef = useRef(false);

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

    // Helpers (Grid & Axes)
    const grid = new THREE.GridHelper(30, 30, 0x3b82f6, 0x3f3f46);
    grid.position.y = 0.01;
    scene.threeScene.add(grid);

    // Selection Bounding Box Helper
    const boxHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x60a5fa);
    boxHelper.visible = false;
    scene.threeScene.add(boxHelper);

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

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      if (e.button === 0) isDragging = true;
      if (e.button === 2) isPanning = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
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

    const onMouseUp = () => {
      isDragging = false;
      isPanning = false;
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
    const animate = (timestamp: number) => {
      animId = requestAnimationFrame(animate);

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

      // Update Selection Box Helper
      if (selectedGameObject) {
        const mr = selectedGameObject.components.find((c: any) => c.threeMesh) as any;
        if (mr && mr.threeMesh) {
          boxHelper.setFromObject(mr.threeMesh);
          boxHelper.visible = !isPlaying;
        } else {
          boxHelper.visible = false;
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
      scene.threeScene.remove(grid);
      scene.threeScene.remove(boxHelper);
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

  return (
    <div
      ref={containerRef}
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
