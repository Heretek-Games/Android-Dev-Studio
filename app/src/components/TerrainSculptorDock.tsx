import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Mountain,
  Sliders,
  Layers,
  Compass,
  Play,
  RotateCcw,
  Sparkles,
  Eye,
  CheckCircle,
  Activity,
  Trees,
  CloudSun
} from 'lucide-react';
import { TerrainChunk, GameObject } from '@heretek/engine';

export const TerrainSculptorDock: React.FC = () => {
  const { scene, refreshScene, addLog } = useStudio();

  // Terrain generation parameters
  const [elevationScale, setElevationScale] = useState(12);
  const [octaves, setOctaves] = useState(4);
  const [persistence, setPersistence] = useState(0.45);
  const [lacunarity, setLacunarity] = useState(2.0);
  const [streamDistance, setStreamDistance] = useState(2);
  const [chunkSize, setChunkSize] = useState(32);
  const [chunkResolution, setChunkResolution] = useState(32);
  const [isGenerated, setIsGenerated] = useState(false);

  // Active chunks telemetry
  const [activeChunksCount, setActiveChunksCount] = useState(0);

  const handleGenerateTerrain = () => {
    try {
      // 1. Remove previous chunk if exists
      const existing = scene.findByName('ProceduralTerrainChunk_0_0');
      if (existing) {
        scene.removeGameObject(existing);
      }

      // 2. Create GameObject with TerrainChunk component
      const go = new GameObject('ProceduralTerrainChunk_0_0');
      const chunk = new TerrainChunk({
        chunkX: 0,
        chunkZ: 0,
        size: chunkSize,
        resolution: chunkResolution,
        maxHeight: elevationScale
      });
      go.addComponent(chunk);
      scene.addGameObject(go);

      // Trigger lifecycle
      chunk.awake();
      chunk.start();

      setIsGenerated(true);
      setActiveChunksCount(1);
      refreshScene();
      addLog(
        'info',
        'TerrainSculptor',
        `Generated 3D fractal heightmap chunk (Size: ${chunkSize}m, Elevation: ${elevationScale}m, Resolution: ${chunkResolution}x${chunkResolution}) with 4-layer slope splatting.`
      );
    } catch (err: any) {
      addLog('error', 'TerrainSculptor', `Failed to generate terrain: ${err.message}`);
    }
  };

  const handleClearTerrain = () => {
    const existing = scene.findByName('ProceduralTerrainChunk_0_0');
    if (existing) {
      scene.removeGameObject(existing);
    }
    setIsGenerated(false);
    setActiveChunksCount(0);
    refreshScene();
    addLog('info', 'TerrainSculptor', 'Cleared procedural terrain chunks from scene.');
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-gray-200 select-none overflow-y-auto font-sans p-3 space-y-4">
      {/* Header Banner */}
      <div className="p-3 bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 border border-emerald-500/30 rounded-lg flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Mountain className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-emerald-300">Open-World Fractal Terrain Sculptor</h3>
          </div>
          <p className="text-xs text-zinc-400">
            Procedural multi-octave heightmap generation with GPU slope splatting (Grass, Dirt, Rock, Snow).
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {isGenerated ? (
            <span className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-950/60 border border-emerald-500/40 rounded text-xs text-emerald-300 font-mono">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>1 Active Chunk</span>
            </span>
          ) : (
            <span className="text-xs text-zinc-500 font-mono">No active terrain</span>
          )}
        </div>
      </div>

      {/* Parameter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Heightmap Shaping */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300 border-b border-zinc-800 pb-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span>Elevation & Fractal Noise</span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Elevation Scale</span>
                <span className="font-mono text-zinc-200">{elevationScale}m</span>
              </div>
              <input
                type="range"
                min={2}
                max={40}
                step={1}
                value={elevationScale}
                onChange={e => setElevationScale(Number(e.target.value))}
                className="w-full accent-blue-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Noise Octaves</span>
                <span className="font-mono text-zinc-200">{octaves}</span>
              </div>
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={octaves}
                onChange={e => setOctaves(Number(e.target.value))}
                className="w-full accent-blue-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Persistence (Roughness)</span>
                <span className="font-mono text-zinc-200">{persistence.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={persistence}
                onChange={e => setPersistence(Number(e.target.value))}
                className="w-full accent-blue-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Streaming & Chunk Resolution */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300 border-b border-zinc-800 pb-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span>Chunk Streaming & Topology</span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Chunk Size</span>
                <span className="font-mono text-zinc-200">{chunkSize} × {chunkSize} m</span>
              </div>
              <input
                type="range"
                min={16}
                max={64}
                step={16}
                value={chunkSize}
                onChange={e => setChunkSize(Number(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Mesh Resolution (Triangles)</span>
                <span className="font-mono text-zinc-200">{chunkResolution} × {chunkResolution} ({chunkResolution * chunkResolution * 2} tris)</span>
              </div>
              <input
                type="range"
                min={16}
                max={64}
                step={16}
                value={chunkResolution}
                onChange={e => setChunkResolution(Number(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Stream Radius</span>
                <span className="font-mono text-zinc-200">{streamDistance} Chunks</span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={streamDistance}
                onChange={e => setStreamDistance(Number(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Surface Biome Splatting Legend */}
      <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
        <h4 className="text-xs font-semibold text-zinc-300 mb-2">GPU Slope-Based Splatting Layers</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center space-x-2 p-2 bg-zinc-950 rounded border border-zinc-800">
            <span className="w-3 h-3 rounded bg-emerald-600"></span>
            <div>
              <div className="text-zinc-200 font-medium">Lush Valley Grass</div>
              <div className="text-[10px] text-zinc-500">Slope &lt; 25°</div>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-zinc-950 rounded border border-zinc-800">
            <span className="w-3 h-3 rounded bg-amber-700"></span>
            <div>
              <div className="text-zinc-200 font-medium">Dirt & Pathways</div>
              <div className="text-[10px] text-zinc-500">Slope 25° - 45°</div>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-zinc-950 rounded border border-zinc-800">
            <span className="w-3 h-3 rounded bg-zinc-500"></span>
            <div>
              <div className="text-zinc-200 font-medium">Cliffside Rock</div>
              <div className="text-[10px] text-zinc-500">Slope &gt; 45°</div>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-zinc-950 rounded border border-zinc-800">
            <span className="w-3 h-3 rounded bg-white"></span>
            <div>
              <div className="text-zinc-200 font-medium">Alpine Snow</div>
              <div className="text-[10px] text-zinc-500">Altitude &gt; 70%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleClearTerrain}
          disabled={!isGenerated}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded text-xs transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Clear Terrain</span>
        </button>

        <button
          onClick={handleGenerateTerrain}
          className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Generate Procedural Open World</span>
        </button>
      </div>
    </div>
  );
};
