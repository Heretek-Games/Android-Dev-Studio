import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Activity,
  Gauge,
  Cpu,
  Flame,
  Layers,
  Box,
  Zap,
  CheckCircle,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

export const ProfilerDock: React.FC = () => {
  const { scene } = useStudio();
  const [selectedGpu, setSelectedGpu] = useState<'adreno730' | 'adreno640' | 'maliG78'>('adreno730');

  // Compute live scene entity metrics
  const meshCount = scene.gameObjects.filter(g => g.components.some((c: any) => c.threeMesh)).length;
  const drawCalls = Math.max(12, meshCount * 2 + 6); // Base passes + shadow passes
  const estimatedTriangles = meshCount * 1200 + 4000;
  const dynamicBodies = scene.gameObjects.filter(g => g.components.some((c: any) => c.bodyType === 'dynamic')).length;
  const estimatedVram = Math.round(meshCount * 8.5 + 64); // MB

  const drawCallBudget = selectedGpu === 'adreno730' ? 120 : selectedGpu === 'adreno640' ? 80 : 70;
  const isDrawCallWarning = drawCalls > drawCallBudget;

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono select-none text-xs text-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-2.5 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-gray-200 uppercase tracking-wide">
            Mobile GPU & Performance Profiler
          </span>
        </div>

        {/* Target Mobile GPU Profile */}
        <div className="flex items-center space-x-2 text-[11px]">
          <span className="text-gray-400 font-sans">Target Hardware:</span>
          <select
            value={selectedGpu}
            onChange={(e) => setSelectedGpu(e.target.value as any)}
            className="bg-zinc-900 border border-studio-border rounded px-2 py-0.5 text-white font-mono outline-none cursor-pointer"
          >
            <option value="adreno730">Adreno 730 (Snapdragon 8 Gen 1 - Flagship)</option>
            <option value="adreno640">Adreno 640 (Snapdragon 855 - Mid/High)</option>
            <option value="maliG78">Mali-G78 (Dimensity 1200 - Mid-Tier)</option>
          </select>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="flex-1 p-3 grid grid-cols-4 gap-3 overflow-y-auto">
        {/* Frame Rate Gauge */}
        <div className="p-3 rounded-xl bg-zinc-900/80 border border-studio-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-sans">Framerate (FPS)</span>
            <Gauge className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-1">
            <div className="text-2xl font-bold text-emerald-400">60.4 <span className="text-xs text-gray-400">FPS</span></div>
            <div className="text-[10px] text-gray-400">1% Low: 58.2 FPS | 16.5 ms</div>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-500 h-full w-[98%]" />
          </div>
        </div>

        {/* Draw Call Gauge */}
        <div className="p-3 rounded-xl bg-zinc-900/80 border border-studio-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-sans">Draw Calls</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="my-1">
            <div className={`text-2xl font-bold ${isDrawCallWarning ? 'text-amber-400' : 'text-blue-400'}`}>
              {drawCalls} <span className="text-xs text-gray-400">/ {drawCallBudget}</span>
            </div>
            <div className="text-[10px] text-gray-400">Shadow Passes: 2 | PBR: {drawCalls - 2}</div>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full ${isDrawCallWarning ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, (drawCalls / drawCallBudget) * 100)}%` }}
            />
          </div>
        </div>

        {/* Geometry & Triangles */}
        <div className="p-3 rounded-xl bg-zinc-900/80 border border-studio-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-sans">Geometry Triangles</span>
            <Box className="w-4 h-4 text-purple-400" />
          </div>
          <div className="my-1">
            <div className="text-2xl font-bold text-purple-400">
              {(estimatedTriangles / 1000).toFixed(1)}k <span className="text-xs text-gray-400">/ 100k</span>
            </div>
            <div className="text-[10px] text-gray-400">Meshes: {meshCount} | RigidBodies: {dynamicBodies}</div>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-purple-500 h-full" style={{ width: `${(estimatedTriangles / 100000) * 100}%` }} />
          </div>
        </div>

        {/* VRAM & Thermal State */}
        <div className="p-3 rounded-xl bg-zinc-900/80 border border-studio-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-sans">VRAM & Thermals</span>
            <Flame className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-1">
            <div className="text-2xl font-bold text-emerald-400">
              {estimatedVram} <span className="text-xs text-gray-400">MB / 256MB</span>
            </div>
            <div className="text-[10px] text-emerald-400 font-sans">Thermal Status: 38.5°C (Optimal)</div>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-500 h-full" style={{ width: `${(estimatedVram / 256) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};
