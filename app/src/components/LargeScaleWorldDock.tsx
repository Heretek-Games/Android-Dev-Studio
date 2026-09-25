import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe,
  Layers,
  Compass,
  Coins,
  Radio,
  Eye,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Save,
  AlertTriangle,
  CheckCircle2,
  Database,
  Mountain
} from 'lucide-react';
import { useStudio } from '../state/StudioState';
import { sceneStore, type HarnessScene } from '../services/SceneStore';
import {
  buildEngineScene,
  estimateDrawCalls,
  sceneBounds,
  obstacleFootprints
} from '../services/HarnessSceneAdapter';
import {
  LODManager,
  SpatialGrid,
  NavGrid,
  GridPathfinder,
  EconomyTick,
  ALifeSimulator,
  HierarchicalStreamingCells,
  QuadtreeTerrain,
  type StreamingStats,
  type QuadtreeStats
} from '@heretek/engine';

const DRAW_BUDGET = 100;
const DEFAULT_LOD_THRESHOLDS = [20, 50, 90];
const DEFAULT_ECONOMY_RULES = [
  { id: 'gold_mine', intervalSeconds: 2.0, effects: [{ resource: 'gold', delta: 4 }] },
  { id: 'iron_smelter', intervalSeconds: 2.0, effects: [{ resource: 'iron', delta: 2 }] },
  { id: 'farm', intervalSeconds: 1.0, effects: [{ resource: 'food', delta: 5 }] },
  { id: 'reactor', intervalSeconds: 3.0, effects: [{ resource: 'energy', delta: 3 }] }
];
const FACTION_CYCLE = ['loner', 'bandit', 'military'];
const HOSTILES: Record<string, string[]> = {
  loner: ['bandit'],
  bandit: ['loner', 'military'],
  military: ['bandit']
};

export const LargeScaleWorldDock: React.FC = () => {
  const { cameraPosition, addLog } = useStudio();
  const [activeTab, setActiveTab] = useState<'lod' | 'spatial' | 'pathfinding' | 'economy' | 'alife' | 'streaming' | 'quadtree'>('lod');

  // ---- Canonical harness scene -------------------------------------------
  const [harnessScene, setHarnessScene] = useState<HarnessScene | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [lastSaveNote, setLastSaveNote] = useState<string | null>(null);

  const refreshScene = useCallback(async () => {
    try {
      const scene = await sceneStore.fetchScene();
      setHarnessScene(scene);
      setSceneError(null);
    } catch (err: any) {
      setSceneError(err.message);
    }
  }, []);

  useEffect(() => {
    refreshScene();
    return sceneStore.subscribe(scene => setHarnessScene(scene));
  }, [refreshScene]);

  // Real engine scene built from the canonical spec
  const engineScene = useMemo(
    () => (harnessScene ? buildEngineScene(harnessScene) : null),
    [harnessScene]
  );

  const budget = useMemo(
    () => (harnessScene ? estimateDrawCalls(harnessScene) : { drawCalls: 0, batched: 0 }),
    [harnessScene]
  );

  const saveToScene = useCallback(
    async (mutator: (scene: HarnessScene) => void, note: string) => {
      const result = await sceneStore.mutate(mutator);
      if (result.ok) {
        setLastSaveNote(note);
        addLog('info', 'LargeWorld', note);
      } else {
        setLastSaveNote(`Rejected by invariant gate: ${result.error}`);
        addLog('warn', 'LargeWorld', `Scene mutation rejected: ${result.error}`);
      }
      return result.ok;
    },
    [addLog]
  );

  // =========================================================================
  // LOD & Draw Budget — real LODManager over the canonical scene
  // =========================================================================
  const [lodThresholds, setLodThresholds] = useState<number[]>(() => {
    const cfg = (harnessScene as any)?.lodDefaults;
    return Array.isArray(cfg) && cfg.length === 3 ? cfg : DEFAULT_LOD_THRESHOLDS;
  });
  const [lodEnforced, setLodEnforced] = useState(false);
  const [lodStats, setLodStats] = useState<{
    registered: number;
    visible: number;
    culled: number;
    levelCounts: number[];
    estimatedDrawCalls: number;
  } | null>(null);
  const lodManagerRef = useRef<LODManager | null>(null);

  useEffect(() => {
    const cfg = (harnessScene as any)?.lodDefaults;
    if (Array.isArray(cfg) && cfg.length === 3) setLodThresholds(cfg);
  }, [harnessScene]);

  useEffect(() => {
    if (!engineScene || !harnessScene) return;
    const manager = new LODManager();
    for (const go of engineScene.gameObjects) {
      const spec = harnessScene.gameObjects.find(o => o.name === go.name);
      const distances = (spec as any)?.lod?.distances ?? lodThresholds;
      manager.register(go, distances);
    }
    manager.setCameraPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const stats = manager.update();
    lodManagerRef.current = manager;
    setLodStats(stats);
  }, [engineScene, harnessScene, lodThresholds, cameraPosition]);

  const saveLodConfig = () =>
    saveToScene(scene => {
      scene.lodDefaults = lodThresholds;
      for (const obj of scene.gameObjects || []) {
        if ((obj.kind || 'mesh') === 'mesh') {
          obj.lod = { distances: lodThresholds };
        }
      }
    }, `LOD thresholds [${lodThresholds.join(', ')}] saved to scene + per-entity config`);

  // =========================================================================
  // Spatial Hash — real SpatialGrid over scene positions
  // =========================================================================
  const [cellSize, setCellSize] = useState<number>(() => (harnessScene as any)?.spatialGrid?.cellSize ?? 10);
  const [spatialStats, setSpatialStats] = useState<{ cells: number; entries: number; maxBucketSize: number } | null>(null);
  const spatialGridRef = useRef<SpatialGrid | null>(null);
  const [queryCenterName, setQueryCenterName] = useState<string>('');
  const [queryRadius, setQueryRadius] = useState(25);
  const [queryResults, setQueryResults] = useState<Array<{ name: string; distance: number }> | null>(null);

  useEffect(() => {
    if (!harnessScene) return;
    const grid = new SpatialGrid(cellSize);
    for (const obj of harnessScene.gameObjects || []) {
      if (obj.kind === 'light') continue;
      const [x, y, z] = obj.position || [0, 0, 0];
      grid.insert(obj.name, x, y, z, obj);
    }
    spatialGridRef.current = grid;
    setSpatialStats(grid.stats());
    setQueryResults(null);
  }, [harnessScene, cellSize]);

  const runRadiusQuery = () => {
    const grid = spatialGridRef.current;
    if (!grid) return;
    const centerObj = harnessScene?.gameObjects.find(o => o.name === queryCenterName);
    const center = centerObj?.position ?? [cameraPosition.x, cameraPosition.y, cameraPosition.z];
    const [cx, cy, cz] = center;
    const hits = grid
      .queryRadius(cx, cy, cz, queryRadius)
      .map(e => {
        const dx = e.x - cx;
        const dy = e.y - cy;
        const dz = e.z - cz;
        return { name: e.id, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) };
      })
      .sort((a, b) => a.distance - b.distance);
    setQueryResults(hits);
    addLog('info', 'SpatialGrid', `Radius query ${queryRadius}m around ${centerObj ? `"${queryCenterName}"` : 'camera'}: ${hits.length} entities`);
  };

  const saveSpatialConfig = () =>
    saveToScene(scene => {
      scene.spatialGrid = { cellSize, indexedObjects: (scene.gameObjects || []).length };
    }, `Spatial grid config (cell=${cellSize}m) saved to scene`);

  // =========================================================================
  // Hierarchical A* — grid derived from real scene bounds + obstacles
  // =========================================================================
  const NAV_CELL = 1; // world units per nav cell
  const navGeometry = useMemo(() => {
    if (!harnessScene) return null;
    const bounds = sceneBounds(harnessScene);
    const minX = Math.floor(bounds.minX) - 2;
    const minZ = Math.floor(bounds.minZ) - 2;
    const width = Math.min(160, Math.ceil(bounds.maxX - bounds.minX) + 4);
    const height = Math.min(160, Math.ceil(bounds.maxZ - bounds.minZ) + 4);
    return { minX, minZ, width, height };
  }, [harnessScene]);

  const [customBlocked, setCustomBlocked] = useState<Set<string>>(new Set());
  const [pathStartName, setPathStartName] = useState('');
  const [pathGoalName, setPathGoalName] = useState('');
  const [navResult, setNavResult] = useState<{
    pathLength: number | null;
    nodesExpanded: number;
    coarseNodes: number;
    usedHierarchy: boolean;
  } | null>(null);
  const [lastPath, setLastPath] = useState<Array<{ x: number; y: number }>>([]);

  const worldToCell = useCallback(
    (pos: number[] | undefined) => {
      if (!navGeometry) return { x: 0, y: 0 };
      const [wx, , wz] = pos || [0, 0, 0];
      return {
        x: Math.max(0, Math.min(navGeometry.width - 1, Math.round(wx - navGeometry.minX))),
        y: Math.max(0, Math.min(navGeometry.height - 1, Math.round(wz - navGeometry.minZ)))
      };
    },
    [navGeometry]
  );

  const buildNavGrid = useCallback(() => {
    if (!navGeometry || !harnessScene) return null;
    const grid = new NavGrid(navGeometry.width, navGeometry.height);
    // Fixed obstacle footprints -> blocked cells (with a safety margin)
    for (const fp of obstacleFootprints(harnessScene)) {
      const cx = Math.round(fp.x - navGeometry.minX);
      const cz = Math.round(fp.z - navGeometry.minZ);
      const hx = Math.ceil(fp.halfX / NAV_CELL) + 1;
      const hz = Math.ceil(fp.halfZ / NAV_CELL) + 1;
      for (let dy = -hz; dy <= hz; dy++) {
        for (let dx = -hx; dx <= hx; dx++) {
          grid.setBlocked(cx + dx, cz + dy, true);
        }
      }
    }
    // User-toggled cells
    for (const key of customBlocked) {
      const [x, y] = key.split(',').map(Number);
      grid.setBlocked(x, y, true);
    }
    return grid;
  }, [navGeometry, harnessScene, customBlocked]);

  const computePath = useCallback(() => {
    const grid = buildNavGrid();
    if (!grid || !navGeometry) return;
    const startObj = harnessScene?.gameObjects.find(o => o.name === pathStartName);
    const goalObj = harnessScene?.gameObjects.find(o => o.name === pathGoalName);
    if (!startObj || !goalObj) {
      setNavResult(null);
      return;
    }
    const start = worldToCell(startObj.position);
    const goal = worldToCell(goalObj.position);
    const finder = new GridPathfinder(grid, { chunkSize: 8, hierarchical: true });
    const t0 = performance.now();
    const path = finder.findPath(start, goal);
    const elapsedMs = performance.now() - t0;
    setLastPath(path || []);
    setNavResult({
      pathLength: path ? path.length : null,
      nodesExpanded: finder.lastStats.nodesExpanded,
      coarseNodes: finder.lastStats.coarseNodesExpanded,
      usedHierarchy: finder.lastStats.usedHierarchy
    });
    addLog(
      path ? 'info' : 'warn',
      'Pathfinding',
      path
        ? `Path ${path.length} steps (${elapsedMs.toFixed(1)}ms, ${finder.lastStats.nodesExpanded} nodes, ${finder.lastStats.usedHierarchy ? 'hierarchical' : 'flat'})`
        : `No path from "${pathStartName}" to "${pathGoalName}" (${elapsedMs.toFixed(1)}ms, ${finder.lastStats.nodesExpanded} nodes expanded)`
    );
  }, [buildNavGrid, navGeometry, harnessScene, pathStartName, pathGoalName, worldToCell, addLog]);

  useEffect(() => {
    if (pathStartName && pathGoalName) computePath();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathStartName, pathGoalName, customBlocked, harnessScene]);

  const spawnPathMarkers = () => {
    const path = lastPath;
    if (!navGeometry || path.length === 0) return;
    const stride = Math.max(1, Math.floor(path.length / 24));
    const markers = [] as Array<{ name: string; x: number; z: number }>;
    for (let i = 0; i < path.length; i += stride) {
      markers.push({
        name: `PathNode ${markers.length + 1}`,
        x: path[i].x + navGeometry.minX,
        z: path[i].y + navGeometry.minZ
      });
    }
    saveToScene(scene => {
      scene.gameObjects = (scene.gameObjects || []).filter((o: any) => !String(o.name).startsWith('PathNode '));
      for (const m of markers) {
        scene.gameObjects.push({
          name: m.name,
          shape: 'box',
          size: [0.4, 0.15, 0.4],
          position: [m.x, 0.1, m.z],
          color: '#22d3ee',
          physics: 'none'
        });
      }
    }, `Spawned ${markers.length} path markers into the canonical scene`);
  };

  // Downsampled preview grid
  const navPreview = useMemo(() => {
    if (!navGeometry) return null;
    const cols = Math.min(48, navGeometry.width);
    const rows = Math.min(48, navGeometry.height);
    const sx = navGeometry.width / cols;
    const sy = navGeometry.height / rows;
    const grid = buildNavGrid();
    if (!grid) return null;
    const pathCells = new Set(lastPath.map(p => `${p.x},${p.y}`));
    const start = worldToCell(harnessScene?.gameObjects.find(o => o.name === pathStartName)?.position);
    const goal = worldToCell(harnessScene?.gameObjects.find(o => o.name === pathGoalName)?.position);
    const view: Array<Array<'open' | 'blocked' | 'path' | 'start' | 'goal'>> = [];
    for (let r = 0; r < rows; r++) {
      const row: Array<'open' | 'blocked' | 'path' | 'start' | 'goal'> = [];
      for (let c = 0; c < cols; c++) {
        const cellX = Math.floor(c * sx);
        const cellY = Math.floor(r * sy);
        if (cellX === start.x && cellY === start.y) row.push('start');
        else if (cellX === goal.x && cellY === goal.y) row.push('goal');
        else if (pathCells.has(`${cellX},${cellY}`)) row.push('path');
        else if (grid.isBlocked(cellX, cellY)) row.push('blocked');
        else row.push('open');
      }
      view.push(row);
    }
    return view;
  }, [navGeometry, buildNavGrid, harnessScene, pathStartName, pathGoalName, lastPath]);

  // =========================================================================
  // Economy — one persistent deterministic EconomyTick
  // =========================================================================
  const economyRef = useRef<EconomyTick | null>(null);
  const [economyResources, setEconomyResources] = useState<Record<string, number>>({});
  const [economySimTime, setEconomySimTime] = useState(0);
  const [economyRunning, setEconomyRunning] = useState(false);

  useEffect(() => {
    if (!harnessScene || economyRef.current) return;
    const tick = new EconomyTick(1.0);
    const saved = (harnessScene as any).economy;
    const startResources = saved?.resources ?? { gold: 150, iron: 45, food: 280, energy: 90 };
    for (const [k, v] of Object.entries(startResources)) tick.set(k, Number(v));
    for (const rule of DEFAULT_ECONOMY_RULES) tick.addRule(rule);
    economyRef.current = tick;
    setEconomyResources(tick.all());
    setEconomySimTime(tick.getSimTime());
  }, [harnessScene]);

  const advanceEconomy = useCallback(
    (seconds: number) => {
      const tick = economyRef.current;
      if (!tick) return;
      tick.advance(seconds);
      setEconomyResources(tick.all());
      setEconomySimTime(tick.getSimTime());
    },
    []
  );

  useEffect(() => {
    if (!economyRunning) return;
    const interval = setInterval(() => advanceEconomy(0.25), 250);
    return () => clearInterval(interval);
  }, [economyRunning, advanceEconomy]);

  const saveEconomyState = () =>
    saveToScene(scene => {
      const tick = economyRef.current;
      scene.economy = {
        resources: tick ? tick.all() : economyResources,
        simTime: tick ? tick.getSimTime() : economySimTime,
        rules: DEFAULT_ECONOMY_RULES
      };
    }, `Economy state saved (sim time ${economySimTime.toFixed(1)}s)`);

  // =========================================================================
  // A-Life — real two-tier simulator bound to the canonical scene
  // =========================================================================
  const [alifePopulation, setAlifePopulation] = useState<number>(() => (harnessScene as any)?.alife?.population ?? 35);
  const [onlineRadius, setOnlineRadius] = useState<number>(() => (harnessScene as any)?.alife?.onlineRadius ?? 120);
  const [alifeRunning, setAlifeRunning] = useState(false);
  const [alifeStats, setAlifeStats] = useState<{
    total: number;
    online: number;
    offline: number;
    factions: Record<string, number>;
    onlineNames: string[];
  } | null>(null);
  const alifeRef = useRef<ALifeSimulator | null>(null);

  const rebuildAlife = useCallback(() => {
    if (!harnessScene) return;
    const sim = new ALifeSimulator({ onlineRadius, hysteresisFactor: 1.25, offlineTickSeconds: 3.0 });
    const bounds = sceneBounds(harnessScene);
    const side = Math.max(2, Math.ceil(Math.sqrt(alifePopulation)));
    for (let i = 0; i < alifePopulation; i++) {
      const gx = i % side;
      const gz = Math.floor(i / side);
      const fx = bounds.minX + ((gx + 0.5) / side) * (bounds.maxX - bounds.minX);
      const fz = bounds.minZ + ((gz + 0.5) / side) * (bounds.maxZ - bounds.minZ);
      const faction = FACTION_CYCLE[i % FACTION_CYCLE.length];
      sim.registerAgent({
        id: `alife_${i}`,
        name: `${faction[0].toUpperCase()}${faction.slice(1)} ${i + 1}`,
        faction,
        health: 100,
        maxHealth: 100,
        position: { x: fx, y: 1.0, z: fz },
        goal: i % 3 === 0 ? 'patrol' : i % 3 === 1 ? 'trade' : 'scavenge',
        speed: 2 + (i % 3),
        inventory: {},
        hostileFactions: HOSTILES[faction] || []
      });
    }
    alifeRef.current = sim;
    const stats = sim.getStats();
    setAlifeStats({
      total: stats.totalAgents,
      online: stats.onlineCount,
      offline: stats.offlineCount,
      factions: stats.factionCounts,
      onlineNames: sim.getAllAgents().filter(a => a.isOnline).map(a => a.name)
    });
    addLog('info', 'ALife', `Registered ${alifePopulation} agents (online bubble ${onlineRadius}m, offline tick 3s)`);
  }, [harnessScene, alifePopulation, onlineRadius, addLog]);

  useEffect(() => {
    if (harnessScene) rebuildAlife();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessScene, alifePopulation, onlineRadius]);

  useEffect(() => {
    if (!alifeRunning || !alifeRef.current || !engineScene) return;
    const interval = setInterval(() => {
      const sim = alifeRef.current;
      if (!sim) return;
      sim.update(
        { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
        0.3,
        engineScene
      );
      const stats = sim.getStats();
      setAlifeStats({
        total: stats.totalAgents,
        online: stats.onlineCount,
        offline: stats.offlineCount,
        factions: stats.factionCounts,
        onlineNames: sim.getAllAgents().filter(a => a.isOnline).map(a => a.name)
      });
    }, 300);
    return () => clearInterval(interval);
  }, [alifeRunning, engineScene, cameraPosition]);

  const saveAlifeConfig = () =>
    saveToScene(scene => {
      scene.alife = {
        population: alifePopulation,
        onlineRadius,
        factions: alifeStats?.factions ?? {}
      };
    }, `A-Life config saved (${alifePopulation} agents, ${onlineRadius}m bubble)`);

  // =========================================================================
  // Streaming Cells — hierarchical urban clustering + budget-aware draw distance
  // =========================================================================
  const [streamingBudget, setStreamingBudget] = useState<number>(
    () => (harnessScene as any)?.streaming?.drawBudget ?? 100
  );
  const [streamingStats, setStreamingStats] = useState<StreamingStats | null>(null);
  const streamingRef = useRef<HierarchicalStreamingCells | null>(null);

  useEffect(() => {
    if (!harnessScene || !engineScene) return;
    const cells = new HierarchicalStreamingCells({ drawBudget: streamingBudget, scene: engineScene });
    for (const obj of harnessScene.gameObjects || []) {
      if (obj.kind === 'light') continue;
      const go = engineScene.findByName(obj.name);
      const [x, y, z] = obj.position || [0, 0, 0];
      cells.registerAsset({ id: obj.name, x, y, z, gameObjectId: go?.id });
    }
    cells.setFocus(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    streamingRef.current = cells;
    setStreamingStats(cells.update());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessScene, engineScene, streamingBudget]);

  useEffect(() => {
    const cells = streamingRef.current;
    if (!cells) return;
    cells.setFocus(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    setStreamingStats(cells.update());
  }, [cameraPosition]);

  const saveStreamingConfig = () =>
    saveToScene(scene => {
      scene.streaming = {
        drawBudget: streamingBudget,
        levels: streamingRef.current?.levels ?? []
      };
    }, `Streaming config saved (budget ${streamingBudget} draws)`);

  // =========================================================================
  // Terrain LOD — real QuadtreeTerrain focused on the live camera
  // =========================================================================
  const [quadtreeDepth, setQuadtreeDepth] = useState<number>(
    () => (harnessScene as any)?.quadtree?.maxDepth ?? 3
  );
  const [quadtreeStats, setQuadtreeStats] = useState<QuadtreeStats | null>(null);
  const quadtreeRef = useRef<QuadtreeTerrain | null>(null);

  useEffect(() => {
    const terrain = new QuadtreeTerrain({ maxDepth: quadtreeDepth, frameBudget: 64 });
    terrain.setLoader(() => {}); // sync loader: leaves become ready immediately
    terrain.setFocus(cameraPosition.x, cameraPosition.z);
    quadtreeRef.current = terrain;
    setQuadtreeStats(terrain.update());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessScene, quadtreeDepth]);

  useEffect(() => {
    const terrain = quadtreeRef.current;
    if (!terrain) return;
    terrain.setFocus(cameraPosition.x, cameraPosition.z);
    setQuadtreeStats(terrain.update());
  }, [cameraPosition]);

  // Drain the budgeted load queue while the tab is visible (the engine
  // processes at most `frameBudget` nodes per update call).
  useEffect(() => {
    if (activeTab !== 'quadtree') return;
    const interval = setInterval(() => {
      const terrain = quadtreeRef.current;
      if (!terrain) return;
      setQuadtreeStats(terrain.update());
    }, 200);
    return () => clearInterval(interval);
  }, [activeTab]);

  const saveQuadtreeConfig = () =>
    saveToScene(scene => {
      scene.quadtree = {
        maxDepth: quadtreeDepth,
        focus: [cameraPosition.x, cameraPosition.z]
      };
    }, `Terrain LOD config saved (depth ${quadtreeDepth})`);

  const meshObjects = (harnessScene?.gameObjects || []).filter(o => o.kind !== 'light');

  // =========================================================================
  // Render
  // =========================================================================
  const drawPercentage = Math.min(100, Math.round((budget.drawCalls / DRAW_BUDGET) * 100));

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-zinc-200 select-none text-xs font-sans">
      {/* Header: tabs + canonical scene status */}
      <div className="flex items-center gap-1 p-2 bg-[#27272a] border-b border-zinc-700/60 overflow-x-auto">
        {(
          [
            ['lod', 'LOD & Draw Budget', Layers, 'text-emerald-400'],
            ['spatial', 'Spatial Hash', Globe, 'text-purple-400'],
            ['pathfinding', 'Hierarchical A*', Compass, 'text-cyan-400'],
            ['economy', 'Economy Ticks', Coins, 'text-amber-400'],
            ['alife', 'A-Life Simulation', Radio, 'text-rose-400'],
            ['streaming', 'Streaming Cells', Globe, 'text-sky-400'],
            ['quadtree', 'Terrain LOD', Mountain, 'text-lime-400']
          ] as const
        ).map(([id, label, Icon, color]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-all ${
              activeTab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${activeTab === id ? 'text-white' : color}`} />
            <span>{label}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pr-1">
          <Database className="w-3 h-3 text-zinc-500" />
          <span className="text-[10px] text-zinc-500 font-mono">harness/scenes/active_scene.json</span>
          <button
            onClick={refreshScene}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
            title="Reload canonical scene"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {(sceneError || lastSaveNote) && (
        <div
          className={`px-3 py-1.5 text-[11px] border-b ${
            sceneError
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {sceneError ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
            <span>{sceneError || lastSaveNote}</span>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {/* ============ LOD ============ */}
        {activeTab === 'lod' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Mobile Draw-Call Budget Enforcement
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lodEnforced}
                      onChange={e => {
                        setLodEnforced(e.target.checked);
                        addLog(
                          'info',
                          'LOD',
                          e.target.checked
                            ? `LOD culling enforced — objects beyond ${lodThresholds[2]}m deactivated`
                            : 'LOD culling disabled — all canonical-scene objects active'
                        );
                      }}
                      className="accent-emerald-500"
                    />
                    Apply culling
                  </label>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                      drawPercentage > 80 ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {budget.drawCalls} / {DRAW_BUDGET} Calls ({drawPercentage}%)
                  </span>
                </div>
              </div>
              <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    drawPercentage > 80 ? 'bg-red-500' : drawPercentage > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${drawPercentage}%` }}
                />
              </div>
              <div className="text-[10px] text-zinc-500">
                {budget.batched} batched instance groups excluded · camera ({cameraPosition.x.toFixed(1)},{' '}
                {cameraPosition.y.toFixed(1)}, {cameraPosition.z.toFixed(1)})
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                {[0, 1, 2].map(level => (
                  <div key={level} className="bg-[#18181b] p-2 rounded border border-zinc-800">
                    <div className="text-zinc-400 text-[10px]">LOD {level}</div>
                    <div className="text-emerald-400 font-bold text-sm">{lodStats?.levelCounts[level] ?? 0}</div>
                    <div className="text-zinc-500 text-[9px]">&lt; {lodThresholds[level]}m</div>
                  </div>
                ))}
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Culled</div>
                  <div className="text-rose-400 font-bold text-sm">{lodStats?.culled ?? 0}</div>
                  <div className="text-zinc-500 text-[9px]">&gt; {lodThresholds[2]}m</div>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500">
                Live evaluation via LODManager · {lodStats?.registered ?? 0} registered ·{' '}
                {lodStats?.visible ?? 0} visible · {lodStats?.estimatedDrawCalls ?? 0} draw estimate
              </div>
            </div>

            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" />
                  Distance Thresholds (World Units)
                </span>
                <button
                  onClick={saveLodConfig}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium"
                >
                  <Save className="w-3 h-3" /> Save to Scene
                </button>
              </div>
              {[
                ['LOD 0 / LOD 1 Threshold', 0, 10, 40],
                ['LOD 1 / LOD 2 Threshold', 1, 30, 80],
                ['Culling Distance (Max View Distance)', 2, 30, 220]
              ].map(([label, idx, min, max]) => (
                <div key={label as string} className="space-y-2">
                  <div className="flex justify-between items-center text-zinc-400">
                    <span>{label}</span>
                    <span className="font-mono text-zinc-200">{lodThresholds[idx as number]}m</span>
                  </div>
                  <input
                    type="range"
                    min={min as number}
                    max={max as number}
                    value={lodThresholds[idx as number]}
                    onChange={e => {
                      const next = [...lodThresholds];
                      next[idx as number] = Number(e.target.value);
                      setLodThresholds(next);
                    }}
                    className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============ SPATIAL ============ */}
        {activeTab === 'spatial' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-purple-400" />
                  Uniform 3D Spatial Hash (live index over canonical scene)
                </span>
                <button
                  onClick={saveSpatialConfig}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-medium"
                >
                  <Save className="w-3 h-3" /> Save Config
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Active Cells</div>
                  <div className="text-purple-400 font-bold text-sm">{spatialStats?.cells ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Indexed Entities</div>
                  <div className="text-emerald-400 font-bold text-sm">{spatialStats?.entries ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Max Bucket Size</div>
                  <div className="text-blue-400 font-bold text-sm">{spatialStats?.maxBucketSize ?? 0}</div>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Spatial Cell Size</span>
                  <span className="font-mono text-zinc-200">{cellSize}m</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={30}
                  value={cellSize}
                  onChange={e => setCellSize(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            </div>

            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <span className="font-semibold text-zinc-100">Proximity Query</span>
              <div className="flex items-center gap-2">
                <select
                  value={queryCenterName}
                  onChange={e => setQueryCenterName(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                >
                  <option value="">Camera position</option>
                  {meshObjects.map(o => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={queryRadius}
                  min={1}
                  max={100}
                  onChange={e => setQueryRadius(Number(e.target.value))}
                  className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                />
                <span className="text-zinc-500">m</span>
                <button
                  onClick={runRadiusQuery}
                  className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-medium"
                >
                  Query
                </button>
              </div>
              {queryResults && (
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  <div className="text-[10px] text-zinc-500">{queryResults.length} entities within radius</div>
                  {queryResults.map(r => (
                    <div key={r.name} className="flex justify-between bg-[#18181b] border border-zinc-800 rounded px-2 py-1">
                      <span className="text-zinc-300">{r.name}</span>
                      <span className="font-mono text-zinc-500">{r.distance.toFixed(2)}m</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ PATHFINDING ============ */}
        {activeTab === 'pathfinding' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-cyan-400" />
                  Hierarchical A* over scene bounds ({navGeometry?.width ?? 0}×{navGeometry?.height ?? 0} cells, 1m
                  resolution)
                </span>
                <span className="text-[11px] font-mono text-zinc-400">
                  {navResult ? (navResult.pathLength ? `${navResult.pathLength} steps` : 'No path') : '—'}
                </span>
              </div>

              {navPreview && (
                <div className="flex justify-center p-2 bg-[#121214] rounded border border-zinc-800/80">
                  <div
                    className="grid gap-[1px]"
                    style={{ gridTemplateColumns: `repeat(${navPreview[0].length}, 1fr)`, width: '300px' }}
                  >
                    {navPreview.flatMap((row, r) =>
                      row.map((cell, c) => (
                        <div
                          key={`${r}-${c}`}
                          className={`aspect-square rounded-[1px] ${
                            cell === 'start'
                              ? 'bg-emerald-500'
                              : cell === 'goal'
                                ? 'bg-blue-500'
                                : cell === 'path'
                                  ? 'bg-cyan-400'
                                  : cell === 'blocked'
                                    ? 'bg-rose-900/80'
                                    : 'bg-zinc-800/50'
                          }`}
                          title={`cell (${Math.floor((c * (navGeometry?.width ?? 1)) / row.length)}, ${Math.floor(
                            (r * (navGeometry?.height ?? 1)) / navPreview.length
                          )})`}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={pathStartName}
                  onChange={e => setPathStartName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                >
                  <option value="">Start entity…</option>
                  {meshObjects.map(o => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <select
                  value={pathGoalName}
                  onChange={e => setPathGoalName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                >
                  <option value="">Goal entity…</option>
                  {meshObjects.map(o => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={computePath}
                  disabled={!pathStartName || !pathGoalName}
                  className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-medium"
                >
                  Recompute Path
                </button>
              </div>

              {navResult && (
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                    <div className="text-zinc-400">Fine nodes expanded</div>
                    <div className="text-cyan-300 font-bold text-sm">{navResult.nodesExpanded}</div>
                  </div>
                  <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                    <div className="text-zinc-400">Coarse nodes expanded</div>
                    <div className="text-cyan-300 font-bold text-sm">{navResult.coarseNodes}</div>
                  </div>
                  <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                    <div className="text-zinc-400">Strategy</div>
                    <div className="text-cyan-300 font-bold text-sm">
                      {navResult.usedHierarchy ? 'Hierarchical' : 'Flat A*'}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Start
                  <div className="w-2.5 h-2.5 rounded-sm bg-blue-500 ml-2" /> Goal
                  <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 ml-2" /> Path
                  <div className="w-2.5 h-2.5 rounded-sm bg-rose-900 ml-2" /> Blocked
                </div>
                <button
                  onClick={spawnPathMarkers}
                  disabled={!navResult?.pathLength}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[11px] font-medium"
                >
                  <Save className="w-3 h-3" /> Spawn Path Markers to Scene
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============ ECONOMY ============ */}
        {activeTab === 'economy' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-amber-400" />
                  Deterministic Fixed-Step Economy (persistent tick, 1s steps)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400">Sim Time: {economySimTime.toFixed(1)}s</span>
                  <button
                    onClick={saveEconomyState}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium"
                  >
                    <Save className="w-3 h-3" /> Save State
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                {DEFAULT_ECONOMY_RULES.map(rule => {
                  const resource = rule.effects[0].resource;
                  return (
                    <div key={rule.id} className="bg-[#18181b] p-2 rounded border border-zinc-800">
                      <div className="text-zinc-400 text-[10px] capitalize">{resource}</div>
                      <div className="text-amber-300 font-bold text-sm">{economyResources[resource] ?? 0}</div>
                      <div className="text-emerald-500 text-[9px]">
                        +{rule.effects[0].delta} / {rule.intervalSeconds}s
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => advanceEconomy(1)}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> +1s Step
                </button>
                <button
                  onClick={() => advanceEconomy(30)}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> +30s Batch
                </button>
                <button
                  onClick={() => setEconomyRunning(r => !r)}
                  className={`flex-1 py-1.5 rounded font-medium flex items-center justify-center gap-1 ${
                    economyRunning ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {economyRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {economyRunning ? 'Pause Real-Time' : 'Real-Time Advance'}
                </button>
              </div>
              <div className="text-[10px] text-zinc-500">
                Fixed-step accumulator: resource totals are deterministic for any frame cadence. State hydrates from
                and persists to the canonical scene.
              </div>
            </div>
          </div>
        )}

        {/* ============ A-LIFE ============ */}
        {activeTab === 'alife' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-rose-400" />
                  Two-Tier A-Life Simulation (online bubble ↔ offline sector sim)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveAlifeConfig}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium"
                  >
                    <Save className="w-3 h-3" /> Save Config
                  </button>
                  <button
                    onClick={() => setAlifeRunning(r => !r)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-white text-[11px] font-medium ${
                      alifeRunning ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
                    }`}
                  >
                    {alifeRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {alifeRunning ? 'Pause Sim' : 'Run Sim'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Total Population</div>
                  <div className="text-zinc-200 font-bold text-sm">{alifeStats?.total ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Online 3D Active</div>
                  <div className="text-emerald-400 font-bold text-sm">{alifeStats?.online ?? 0}</div>
                  <div className="text-zinc-500 text-[9px]">&lt; {onlineRadius}m bubble</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400 text-[10px]">Offline Sim</div>
                  <div className="text-blue-400 font-bold text-sm">{alifeStats?.offline ?? 0}</div>
                  <div className="text-zinc-500 text-[9px]">zero GPU cost</div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Population</span>
                  <span className="font-mono text-zinc-200">{alifePopulation} agents</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  value={alifePopulation}
                  onChange={e => setAlifePopulation(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Online 3D Bubble Radius</span>
                  <span className="font-mono text-zinc-200">{onlineRadius}m</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={onlineRadius}
                  onChange={e => setOnlineRadius(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
              </div>

              <div className="bg-[#18181b] p-2 rounded border border-zinc-800 text-[11px]">
                <div className="font-medium text-zinc-300 mb-1">Faction Distribution (live):</div>
                <div className="flex gap-4">
                  {FACTION_CYCLE.map(f => (
                    <span key={f} className="text-zinc-400">
                      {f}: <span className="text-zinc-200 font-mono">{alifeStats?.factions?.[f] ?? 0}</span>
                    </span>
                  ))}
                </div>
              </div>

              {alifeStats && alifeStats.onlineNames.length > 0 && (
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800 text-[10px] text-zinc-400 max-h-24 overflow-y-auto">
                  <div className="font-medium text-zinc-300 mb-1">Online entities (promoted to real GameObjects):</div>
                  {alifeStats.onlineNames.map(n => (
                    <div key={n} className="text-emerald-400">
                      ● {n}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-zinc-500">
                Player position = live viewport camera. Move the camera near agents and run the sim to watch
                promotions/demotions happen in the derived scene.
              </div>
            </div>
          </div>
        )}

        {/* ============ STREAMING CELLS ============ */}
        {activeTab === 'streaming' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-sky-400" />
                  Hierarchical Streaming Cells (district → block → chunk)
                </span>
                <div className="flex items-center gap-2">
                  {streamingStats?.budgetTrimmed && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Budget trimmed — outer rings culled
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                      (streamingStats?.estimatedDrawCalls ?? 0) > streamingBudget
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {streamingStats?.estimatedDrawCalls ?? 0} / {streamingBudget} draws
                  </span>
                  <button
                    onClick={saveStreamingConfig}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium"
                  >
                    <Save className="w-3 h-3" /> Save Config
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {(streamingRef.current?.levels ?? []).slice(0, 3).map((level, idx) => (
                  <div key={level.name} className="bg-[#18181b] p-2 rounded border border-zinc-800">
                    <div className="text-zinc-400 text-[10px] capitalize">{level.name} ({level.cellSize}m)</div>
                    <div className="text-sky-300 font-bold text-sm">
                      {streamingStats?.activeCellsByLevel?.[idx] ?? 0} active
                    </div>
                    <div className="text-zinc-500 text-[9px]">
                      ring {level.ringRadius}m · {level.drawsPerCell} draws/cell
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Active Assets</div>
                  <div className="text-emerald-400 font-bold text-sm">{streamingStats?.activeAssets ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Culled Assets</div>
                  <div className="text-rose-400 font-bold text-sm">{streamingStats?.culledAssets ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Total Cells</div>
                  <div className="text-zinc-200 font-bold text-sm">{streamingStats?.totalCells ?? 0}</div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Draw-Call Budget</span>
                  <span className="font-mono text-zinc-200">{streamingBudget} draws</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={streamingBudget}
                  onChange={e => setStreamingBudget(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
              </div>

              <div className="text-[10px] text-zinc-500">
                Focus = live viewport camera ({cameraPosition.x.toFixed(1)}, {cameraPosition.y.toFixed(1)},{' '}
                {cameraPosition.z.toFixed(1)}). Ring radii shrink automatically when the active set would exceed
                the budget (persistent trim scale — no boundary thrash) and recover with headroom. Scene-bound
                assets toggle their GameObject visibility on stream in/out in the derived scene; config persists
                to the canonical scene for agents and QA.
              </div>
            </div>
          </div>
        )}

        {/* ============ TERRAIN LOD ============ */}
        {activeTab === 'quadtree' && (
          <div className="space-y-4">
            <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Mountain className="w-4 h-4 text-lime-400" />
                  Quadtree Terrain LOD (focus-driven subdivision + async loading)
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-lime-500/15 text-lime-300 border border-lime-500/30">
                    {quadtreeStats?.leaves ?? 0} leaves · max depth {quadtreeStats?.maxDepthReached ?? 0}
                  </span>
                  <button
                    onClick={saveQuadtreeConfig}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-lime-600 hover:bg-lime-500 text-white text-[11px] font-medium"
                  >
                    <Save className="w-3 h-3" /> Save Config
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Leaves</div>
                  <div className="text-lime-300 font-bold text-sm">{quadtreeStats?.leaves ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Ready</div>
                  <div className="text-emerald-400 font-bold text-sm">{quadtreeStats?.ready ?? 0}</div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Loading / Queued</div>
                  <div className="text-amber-400 font-bold text-sm">
                    {quadtreeStats?.loading ?? 0} / {quadtreeStats?.queued ?? 0}
                  </div>
                </div>
                <div className="bg-[#18181b] p-2 rounded border border-zinc-800">
                  <div className="text-zinc-400">Nodes</div>
                  <div className="text-zinc-200 font-bold text-sm">{quadtreeStats?.totalNodes ?? 0}</div>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Maximum Depth</span>
                  <span className="font-mono text-zinc-200">{quadtreeDepth}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={quadtreeDepth}
                  onChange={e => setQuadtreeDepth(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-lime-500"
                />
              </div>

              <div className="bg-[#18181b] p-2 rounded border border-zinc-800 text-[10px] text-zinc-400">
                <div className="font-medium text-zinc-300 mb-1">Leaf distribution by LOD level:</div>
                <div className="flex gap-3 flex-wrap font-mono">
                  {(quadtreeStats?.lodCounts ?? []).map((count, lod) =>
                    count > 0 ? (
                      <span key={lod}>
                        LOD {lod}: <span className="text-lime-300">{count}</span>
                      </span>
                    ) : null
                  )}
                </div>
              </div>

              <div className="text-[10px] text-zinc-500">
                Focus = live viewport camera ({cameraPosition.x.toFixed(1)}, {cameraPosition.z.toFixed(1)}). Nodes
                subdivide toward the camera and merge behind it with hysteresis; every leaf blends continuously
                (1 at the split radius → 0 at 1.25×) so LOD transitions never pop. The native Tier 2 container
                exports the same subdivision as `terrain_lod` records for GPU terrain streaming.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
