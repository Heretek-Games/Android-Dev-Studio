import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  MeshRenderer,
  LightComponent,
  CameraComponent,
  RigidBody3D,
  Collider3D,
  MobileController,
  EventSheet
} from '@heretek/engine';
import {
  Sliders,
  Box,
  Sun,
  Shield,
  Zap,
  Activity,
  Plus,
  Trash2,
  ChevronDown
} from 'lucide-react';

export const Inspector: React.FC = () => {
  const { selectedGameObject, refreshScene } = useStudio();
  const [showAddComponent, setShowAddComponent] = useState(false);

  if (!selectedGameObject) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-gray-500 text-xs bg-studio-surface border-l border-studio-border">
        <Sliders className="w-8 h-8 mb-2 opacity-40 text-gray-400" />
        <span>No Entity Selected</span>
        <span className="text-[11px] text-gray-600 mt-1">Select an object in the Hierarchy or 3D Viewport to inspect properties.</span>
      </div>
    );
  }

  const go = selectedGameObject;
  const t = go.transform;

  const updatePos = (axis: 'x' | 'y' | 'z', val: number) => {
    t.position[axis] = val;
    t.updateMatrices();
    refreshScene();
  };

  const updateRot = (axis: 'x' | 'y' | 'z', deg: number) => {
    t.rotation[axis] = (deg * Math.PI) / 180;
    t.updateMatrices();
    refreshScene();
  };

  const updateScale = (axis: 'x' | 'y' | 'z', val: number) => {
    t.scale[axis] = val;
    t.updateMatrices();
    refreshScene();
  };

  // Component Finders
  const meshRenderer = go.getComponent(MeshRenderer);
  const lightComp = go.getComponent(LightComponent);
  const rigidBody = go.getComponent(RigidBody3D);
  const collider = go.getComponent(Collider3D);
  const mobileController = go.getComponent(MobileController);
  const eventSheet = go.getComponent(EventSheet);

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-l border-studio-border overflow-y-auto">
      {/* Top Entity Details Header */}
      <div className="p-3 border-b border-studio-border bg-studio-bg/40 space-y-2">
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={go.active}
            onChange={(e) => { go.active = e.target.checked; refreshScene(); }}
            className="rounded border-studio-border text-blue-600 focus:ring-0 cursor-pointer"
          />
          <input
            type="text"
            value={go.name}
            onChange={(e) => { go.name = e.target.value; refreshScene(); }}
            className="flex-1 bg-zinc-900 border border-studio-border rounded px-2 py-1 text-xs text-white font-medium focus:border-blue-500 outline-none"
          />
        </div>
        <div className="flex space-x-2 text-[11px] text-gray-400">
          <span className="bg-zinc-800 px-1.5 py-0.5 rounded border border-studio-border">Tag: {go.tag}</span>
          <span className="bg-zinc-800 px-1.5 py-0.5 rounded border border-studio-border">ID: {go.id}</span>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {/* Transform Component */}
        <div className="bg-zinc-900/60 border border-studio-border/70 rounded-lg p-3 space-y-2.5">
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center space-x-1">
            <span>Transform</span>
          </span>

          {/* Position */}
          <div className="space-y-1">
            <span className="text-[11px] text-gray-400">Position</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-800 rounded border border-studio-border px-1.5 py-0.5">
                  <span className={`text-[10px] font-bold mr-1 ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={Math.round(t.position[axis] * 100) / 100}
                    onChange={(e) => updatePos(axis, parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Rotation */}
          <div className="space-y-1">
            <span className="text-[11px] text-gray-400">Rotation (Deg)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-800 rounded border border-studio-border px-1.5 py-0.5">
                  <span className={`text-[10px] font-bold mr-1 ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="5"
                    value={Math.round((t.rotation[axis] * 180) / Math.PI)}
                    onChange={(e) => updateRot(axis, parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-1">
            <span className="text-[11px] text-gray-400">Scale</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-800 rounded border border-studio-border px-1.5 py-0.5">
                  <span className={`text-[10px] font-bold mr-1 ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={Math.round(t.scale[axis] * 100) / 100}
                    onChange={(e) => updateScale(axis, parseFloat(e.target.value) || 1)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mesh Renderer Component */}
        {meshRenderer && (
          <div className="bg-zinc-900/60 border border-studio-border/70 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Box className="w-3.5 h-3.5" />
                <span>Mesh Renderer</span>
              </span>
              <button
                onClick={() => { go.removeComponent(meshRenderer); refreshScene(); }}
                className="text-gray-400 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Shape</span>
                <span className="font-mono text-gray-200 uppercase bg-zinc-800 px-2 py-0.5 rounded border border-studio-border">
                  {meshRenderer.shape}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-400">Color</span>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="color"
                    value={meshRenderer.color}
                    onChange={(e) => { meshRenderer.setMaterial(e.target.value); refreshScene(); }}
                    className="w-6 h-6 rounded cursor-pointer border border-studio-border bg-transparent"
                  />
                  <span className="font-mono text-[11px] text-gray-300">{meshRenderer.color}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Roughness</span>
                  <span>{meshRenderer.roughness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={meshRenderer.roughness}
                  onChange={(e) => { meshRenderer.setMaterial(undefined, parseFloat(e.target.value)); refreshScene(); }}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Metalness</span>
                  <span>{meshRenderer.metalness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={meshRenderer.metalness}
                  onChange={(e) => { meshRenderer.setMaterial(undefined, undefined, parseFloat(e.target.value)); refreshScene(); }}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* Light Component */}
        {lightComp && (
          <div className="bg-zinc-900/60 border border-studio-border/70 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Sun className="w-3.5 h-3.5" />
                <span>Light</span>
              </span>
              <button
                onClick={() => { go.removeComponent(lightComp); refreshScene(); }}
                className="text-gray-400 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Type</span>
                <span className="capitalize text-gray-200 bg-zinc-800 px-2 py-0.5 rounded border border-studio-border">
                  {lightComp.lightType}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Intensity</span>
                  <span>{lightComp.intensity}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.2"
                  value={lightComp.intensity}
                  onChange={(e) => {
                    lightComp.intensity = parseFloat(e.target.value);
                    if (lightComp.threeLight) lightComp.threeLight.intensity = lightComp.intensity;
                    refreshScene();
                  }}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* RigidBody3D Component */}
        {rigidBody && (
          <div className="bg-zinc-900/60 border border-studio-border/70 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>RigidBody 3D (Physics)</span>
              </span>
              <button
                onClick={() => { go.removeComponent(rigidBody); refreshScene(); }}
                className="text-gray-400 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Body Type</span>
                <select
                  value={rigidBody.bodyType}
                  onChange={(e) => { rigidBody.bodyType = e.target.value as any; refreshScene(); }}
                  className="bg-zinc-800 text-gray-200 border border-studio-border rounded px-2 py-0.5 outline-none cursor-pointer"
                >
                  <option value="dynamic">Dynamic (Affected by Gravity)</option>
                  <option value="fixed">Fixed (Static Ground/Wall)</option>
                  <option value="kinematic">Kinematic (Code Driven)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-400">Mass (kg)</span>
                <input
                  type="number"
                  step="0.5"
                  value={rigidBody.mass}
                  onChange={(e) => { rigidBody.mass = parseFloat(e.target.value) || 1; refreshScene(); }}
                  className="w-20 bg-zinc-800 border border-studio-border rounded px-2 py-0.5 text-right text-white outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Mobile Controller */}
        {mobileController && (
          <div className="bg-zinc-900/60 border border-studio-border/70 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5" />
                <span>Mobile Joystick Controller</span>
              </span>
              <button
                onClick={() => { go.removeComponent(mobileController); refreshScene(); }}
                className="text-gray-400 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Move Speed</span>
                <input
                  type="number"
                  step="0.5"
                  value={mobileController.moveSpeed}
                  onChange={(e) => { mobileController.moveSpeed = parseFloat(e.target.value) || 5; refreshScene(); }}
                  className="w-20 bg-zinc-800 border border-studio-border rounded px-2 py-0.5 text-right text-white outline-none"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Jump Force</span>
                <input
                  type="number"
                  step="0.5"
                  value={mobileController.jumpForce}
                  onChange={(e) => { mobileController.jumpForce = parseFloat(e.target.value) || 5; refreshScene(); }}
                  className="w-20 bg-zinc-800 border border-studio-border rounded px-2 py-0.5 text-right text-white outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Add Component Button */}
        <div className="relative pt-2">
          <button
            onClick={() => setShowAddComponent(!showAddComponent)}
            className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-gray-200 text-xs font-medium border border-studio-border transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Component</span>
          </button>

          {showAddComponent && (
            <div
              className="absolute left-0 right-0 bottom-11 bg-zinc-800 border border-studio-border rounded-lg shadow-xl p-1 z-50 text-xs space-y-0.5"
              onMouseLeave={() => setShowAddComponent(false)}
            >
              {!meshRenderer && (
                <button
                  onClick={() => { go.addComponent(new MeshRenderer({ shape: 'box' })); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-studio-hover text-gray-200"
                >
                  + Mesh Renderer
                </button>
              )}
              {!rigidBody && (
                <button
                  onClick={() => { go.addComponent(new RigidBody3D({ bodyType: 'dynamic' })); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-studio-hover text-gray-200"
                >
                  + RigidBody 3D (Physics)
                </button>
              )}
              {!mobileController && (
                <button
                  onClick={() => { go.addComponent(new MobileController()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-studio-hover text-gray-200"
                >
                  + Mobile Joystick Controller
                </button>
              )}
              {!eventSheet && (
                <button
                  onClick={() => { go.addComponent(new EventSheet()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-studio-hover text-gray-200"
                >
                  + Visual Event Sheet
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
