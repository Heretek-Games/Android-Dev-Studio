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

  const joystickOriginRef = useRef<{ x: number; y: number } | null>(null);

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
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (isPlaying) {
        updateCamera();
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

    animate();

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

  // Virtual Joystick Touch / Mouse Handlers
  const handleJoystickStart = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    joystickOriginRef.current = { x: clientX, y: clientY };
    setJoystickActive(true);
    setJoystickPos({ x: 0, y: 0 });
  };

  const handleJoystickMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!joystickActive || !joystickOriginRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const dx = clientX - joystickOriginRef.current.x;
    const dy = clientY - joystickOriginRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 45;

    let nx = dx;
    let ny = dy;
    if (dist > maxDist) {
      nx = (dx / dist) * maxDist;
      ny = (dy / dist) * maxDist;
    }

    setJoystickPos({ x: nx, y: ny });
    MobileInput.instance.setJoystick('left', nx / maxDist, -ny / maxDist);
  };

  const handleJoystickEnd = () => {
    setJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    joystickOriginRef.current = null;
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
            {/* Top Status */}
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-mono text-emerald-400 border border-emerald-500/30 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>LIVE PLAYMODE (WASD / Touch)</span>
            </div>

            {/* Virtual Left Analog Joystick */}
            <div
              className="absolute bottom-8 left-8 w-28 h-28 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center pointer-events-auto cursor-pointer shadow-lg"
              onMouseDown={handleJoystickStart}
              onMouseMove={handleJoystickMove}
              onMouseUp={handleJoystickEnd}
              onTouchStart={handleJoystickStart}
              onTouchMove={handleJoystickMove}
              onTouchEnd={handleJoystickEnd}
            >
              <div
                className="w-12 h-12 rounded-full bg-blue-500/80 border-2 border-white shadow-md shadow-blue-500/50 transition-transform"
                style={{
                  transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`
                }}
              />
            </div>

            {/* Virtual Action Buttons (Right) */}
            <div className="absolute bottom-8 right-8 flex flex-col items-center space-y-3 pointer-events-auto">
              <button
                onMouseDown={() => MobileInput.instance.setButton('jump', true)}
                onMouseUp={() => MobileInput.instance.setButton('jump', false)}
                onTouchStart={() => MobileInput.instance.setButton('jump', true)}
                onTouchEnd={() => MobileInput.instance.setButton('jump', false)}
                className="w-14 h-14 rounded-full bg-amber-500/90 active:bg-amber-400 text-white font-bold text-xs shadow-lg shadow-amber-500/40 border border-amber-300 flex items-center justify-center active:scale-95 transition-all"
              >
                JUMP
              </button>
              <button
                onMouseDown={() => MobileInput.instance.setButton('fire', true)}
                onMouseUp={() => MobileInput.instance.setButton('fire', false)}
                onTouchStart={() => MobileInput.instance.setButton('fire', true)}
                onTouchEnd={() => MobileInput.instance.setButton('fire', false)}
                className="w-12 h-12 rounded-full bg-red-500/90 active:bg-red-400 text-white font-bold text-xs shadow-lg shadow-red-500/40 border border-red-300 flex items-center justify-center active:scale-95 transition-all"
              >
                ACTION
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
