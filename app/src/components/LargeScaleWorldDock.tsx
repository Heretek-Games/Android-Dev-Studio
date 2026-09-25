import React, { useState, useEffect } from 'react';
import {
  Globe,
  Layers,
  Compass,
  Coins,
  Radio,
  Eye,
  Activity,
  Play,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { useStudio } from '../state/StudioState';
import {
  SpatialGrid,
  LODManager,
  NavGrid,
  GridPathfinder,
  EconomyTick,
  ALifeSimulator
} from '@heretek/engine';

export const LargeScaleWorldDock: React.FC = () => {
  const { scene, addLog } = useStudio();
  const [activeTab, setActiveTab] = useState<'lod' | 'spatial' | 'pathfinding' | 'economy' | 'alife'>('lod');

  // Subsystem States
  const [cameraDist, setCameraDist] = useState(35);
  const [lodThresholds, setLodThresholds] = useState<number[]>([20, 50, 90]);
  const [lodStats, setLodStats] = useState({
    registered: 15,
    visible: 12,
    culled: 3,
    levelCounts: [5, 4, 3],
    estimatedDrawCalls: 12
  });

  // Spatial Grid State
  const [cellSize, setCellSize] = useState(10);
  const [queryRadius, setQueryRadius] = useState(25);
  const [spatialStats, setSpatialStats] = useState({
    cells: 6,
    entries: 15,
    maxBucketSize: 4
  });

  // NavGrid State
  const [navGridSize] = useState(16);
  const [navPathLength, setNavPathLength] = useState<number | null>(null);
  const [navBlockedCells, setNavBlockedCells] = useState<Set<string>>(new Set(['3,2', '3,3', '3,4', '3,5', '7,7', '7,8', '7,9']));
  const [navPath, setNavPath] = useState<Array<[number, number]>>([]);

  // EconomyTick State
  const [simTime, setSimTime] = useState(0);
  const [resources, setResources] = useState<Record<string, number>>({
    gold: 150,
    iron: 45,
    food: 280,
    energy: 90
  });

  // A-Life State
  const [onlineRadius, setOnlineRadius] = useState(120);
  const [alifeStats, setAlifeStats] = useState({
    total: 35,
    online: 4,
    offline: 31,
    factions: { loner: 18, bandit: 9, military: 8 }
  });

  // Run initial pathfinding calculation
  useEffect(() => {
    calculateNavPath();
  }, [navBlockedCells]);

  const calculateNavPath = () => {
    const grid = new NavGrid(navGridSize, navGridSize);
    navBlockedCells.forEach(cell => {
      const [x, y] = cell.split(',').map(Number);
      grid.setBlocked(x, y, true);
    });

    const finder = new GridPathfinder(grid, { chunkSize: 4, hierarchical: true });
    const path = finder.findPath({ x: 0, y: 0 }, { x: navGridSize - 1, y: navGridSize - 1 });

    if (path) {
      setNavPath(path.map(p => [p.x, p.y]));
      setNavPathLength(path.length);
    } else {
      setNavPath([]);
      setNavPathLength(null);
    }
  };

  const advanceEconomy = (seconds: number) => {
    const tick = new EconomyTick(1.0);
    Object.entries(resources).forEach(([k, v]) => tick.set(k, v));

    tick.addRule({
      id: 'mine',
      intervalSeconds: 2.0,
      effects: [{ resource: 'gold', delta: 4 * seconds }, { resource: 'iron', delta: 2 * seconds }]
    });

    tick.addRule({
      id: 'farms',
      intervalSeconds: 1.0,
      effects: [{ resource: 'food', delta: 5 * seconds }]
    });

    tick.advance(seconds);
    setResources(tick.all());
    setSimTime(prev => prev + seconds);
    addLog('info', 'LargeWorld', `Advanced economy simulation by ${seconds}s (sim time: ${(simTime + seconds).toFixed(1)}s)`);
  };

  const drawCallBudget = 100;
  const drawPercentage = Math.min(100, Math.round((lodStats.estimatedDrawCalls / drawCallBudget) * 100));

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-zinc-200 select-none text-xs font-sans">
      {/* Header Tabs */}
      <div className="flex items-center gap-1 p-2 bg-[#27272a] border-b border-zinc-700/60 overflow-x-auto">
        <button
          onClick={() => setActiveTab('lod')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
            activeTab === 'lod' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>LOD & Draw Budget</span>
        </button>

        <button
          onClick={() => setActiveTab('spatial')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
            activeTab === 'spatial' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Spatial Hash</span>
        </button>

        <button
          onClick={() => setActiveTab('pathfinding')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
            activeTab === 'pathfinding' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Hierarchical A*</span>
        </button>

        <button
          onClick={() => setActiveTab('economy')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
            activeTab === 'economy' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Economy Ticks</span>
        </button>

        <button
          onClick={() => setActiveTab('alife')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
            activeTab === 'alife' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>A-Life Simulation</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {/* Tab 1: LOD & Mobile Draw-Call Budget */}
        {activeTab === 'lod' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Mobile Draw-Call Budget Enforcement
                </span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                  drawPercentage > 80 ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                }`}>
                  {lodStats.estimatedDrawCalls} / {drawCallBudget} Calls ({drawPercentage}%)
                </span>
              </div>

              {/* Budget Progress Bar */}
              <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    drawPercentage > 80 ? 'bg-red-500' : drawPercentage > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${drawPercentage}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">LOD 0 (Near)</div>
                  <div className="text-emerald-400 font-bold text-sm">{lodStats.levelCounts[0] || 0}</div>
                  <div className="text-zinc-500 text-[9px]">&lt; {lodThresholds[0]}m</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">LOD 1 (Mid)</div>
                  <div className="text-blue-400 font-bold text-sm">{lodStats.levelCounts[1] || 0}</div>
                  <div className="text-zinc-500 text-[9px]">&lt; {lodThresholds[1]}m</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">LOD 2 (Far)</div>
                  <div className="text-amber-400 font-bold text-sm">{lodStats.levelCounts[2] || 0}</div>
                  <div className="text-zinc-500 text-[9px]">&lt; {lodThresholds[2]}m</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Culled</div>
                  <div className="text-rose-400 font-bold text-sm">{lodStats.culled}</div>
                  <div className="text-zinc-500 text-[9px]">&gt; {lodThresholds[2]}m</div>
                </div>
              </div>
            </div>

            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <span className="font-semibold text-zinc-100 flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-400" />
                Distance Thresholds (World Units)
              </span>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>LOD 0 / LOD 1 Threshold</span>
                  <span className="font-mono text-zinc-200">{lodThresholds[0]}m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="40"
                  value={lodThresholds[0]}
                  onChange={e => setLodThresholds([Number(e.target.value), lodThresholds[1], lodThresholds[2]])}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>LOD 1 / LOD 2 Threshold</span>
                  <span className="font-mono text-zinc-200">{lodThresholds[1]}m</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="80"
                  value={lodThresholds[1]}
                  onChange={e => setLodThresholds([lodThresholds[0], Number(e.target.value), lodThresholds[2]])}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Culling Distance (Max View Distance)</span>
                  <span className="font-mono text-zinc-200">{lodThresholds[2]}m</span>
                </div>
                <input
                  type="range"
                  min="80"
                  max="160"
                  value={lodThresholds[2]}
                  onChange={e => setLodThresholds([lodThresholds[0], lodThresholds[1], Number(e.target.value)])}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Spatial Hash Grid */}
        {activeTab === 'spatial' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <span className="font-semibold text-zinc-100 flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-400" />
                Uniform 3D Spatial Hash Partitioning (Veloren Pattern)
              </span>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Active Cells</div>
                  <div className="text-purple-400 font-bold text-sm">{spatialStats.cells}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Indexed Entities</div>
                  <div className="text-emerald-400 font-bold text-sm">{scene?.gameObjects.length || spatialStats.entries}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Max Bucket Size</div>
                  <div className="text-blue-400 font-bold text-sm">{spatialStats.maxBucketSize}</div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Spatial Cell Size</span>
                  <span className="font-mono text-zinc-200">{cellSize}m</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={cellSize}
                  onChange={e => setCellSize(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Hierarchical A* Pathfinding */}
        {activeTab === 'pathfinding' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-cyan-400" />
                  Hierarchical A* Navigation Grid (Warzone 2100 Pattern)
                </span>
                <span className="text-[11px] font-mono text-zinc-400">
                  Path Length: {navPathLength ? `${navPathLength} steps` : 'Blocked'}
                </span>
              </div>

              {/* Navigation Grid Canvas Map */}
              <div className="flex justify-center p-2 bg-[#121214] rounded border border-zinc-800/80">
                <div
                  className="grid gap-[2px]"
                  style={{
                    gridTemplateColumns: `repeat(${navGridSize}, 1fr)`,
                    width: '260px',
                    height: '260px'
                  }}
                >
                  {Array.from({ length: navGridSize * navGridSize }).map((_, idx) => {
                    const x = idx % navGridSize;
                    const y = Math.floor(idx / navGridSize);
                    const key = `${x},${y}`;
                    const isStart = x === 0 && y === 0;
                    const isGoal = x === navGridSize - 1 && y === navGridSize - 1;
                    const isBlocked = navBlockedCells.has(key);
                    const isPath = navPath.some(([px, py]) => px === x && py === y);

                    let bg = 'bg-zinc-800/60';
                    if (isStart) bg = 'bg-emerald-500';
                    else if (isGoal) bg = 'bg-blue-500';
                    else if (isBlocked) bg = 'bg-rose-900/80';
                    else if (isPath) bg = 'bg-cyan-400';

                    return (
                      <div
                        key={key}
                        onClick={() => {
                          if (isStart || isGoal) return;
                          setNavBlockedCells(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        className={`rounded-[2px] transition-colors cursor-pointer hover:opacity-80 ${bg}`}
                        title={`(${x}, ${y})`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Start
                  <div className="w-2.5 h-2.5 rounded-sm bg-blue-500 ml-2" /> Goal
                  <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 ml-2" /> Path
                  <div className="w-2.5 h-2.5 rounded-sm bg-rose-900 ml-2" /> Obstacle
                </div>
                <button
                  onClick={() => setNavBlockedCells(new Set())}
                  className="text-zinc-400 hover:text-zinc-200 underline text-[10px]"
                >
                  Clear Obstacles
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Economy Ticks */}
        {activeTab === 'economy' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-amber-400" />
                  Deterministic Fixed-Step Economy (Anno / SS14 Pattern)
                </span>
                <span className="text-[11px] font-mono text-zinc-400">
                  Sim Time: {simTime.toFixed(1)}s
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Gold</div>
                  <div className="text-amber-400 font-bold text-sm">{resources.gold || 0}</div>
                  <div className="text-emerald-500 text-[9px]">+4 / 2s</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Iron</div>
                  <div className="text-zinc-300 font-bold text-sm">{resources.iron || 0}</div>
                  <div className="text-emerald-500 text-[9px]">+2 / 2s</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Food</div>
                  <div className="text-emerald-400 font-bold text-sm">{resources.food || 0}</div>
                  <div className="text-emerald-500 text-[9px]">+5 / 1s</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Energy</div>
                  <div className="text-cyan-400 font-bold text-sm">{resources.energy || 0}</div>
                  <div className="text-zinc-500 text-[9px]">Stable</div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => advanceEconomy(1)}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> +1s Step
                </button>
                <button
                  onClick={() => advanceEconomy(5)}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> +5s Fast
                </button>
                <button
                  onClick={() => advanceEconomy(30)}
                  className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> +30s Batch
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: S.T.A.L.K.E.R. A-Life Simulation */}
        {activeTab === 'alife' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <span className="font-semibold text-zinc-100 flex items-center gap-2">
                <Radio className="w-4 h-4 text-rose-400" />
                Two-Tier A-Life Simulation (S.T.A.L.K.E.R. OpenXRay Architecture)
              </span>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Total Population</div>
                  <div className="text-zinc-200 font-bold text-sm">{alifeStats.total}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Online 3D Active</div>
                  <div className="text-emerald-400 font-bold text-sm">{alifeStats.online}</div>
                  <div className="text-zinc-500 text-[9px]">&lt; {onlineRadius}m bubble</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Offline Sim</div>
                  <div className="text-blue-400 font-bold text-sm">{alifeStats.offline}</div>
                  <div className="text-zinc-500 text-[9px]">Zero GPU cost</div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Online 3D Bubble Radius</span>
                  <span className="font-mono text-zinc-200">{onlineRadius}m</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={onlineRadius}
                  onChange={e => setOnlineRadius(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
              </div>

              <div className="bg-[#18181b] p-2 rounded border border-zinc-800 text-[11px] text-zinc-400">
                <div className="font-medium text-zinc-300 mb-1">Faction Distribution:</div>
                <div className="flex justify-between">
                  <span className="text-blue-400">Loners: {alifeStats.factions.loner}</span>
                  <span className="text-rose-400">Bandits: {alifeStats.factions.bandit}</span>
                  <span className="text-emerald-400">Military: {alifeStats.factions.military}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
