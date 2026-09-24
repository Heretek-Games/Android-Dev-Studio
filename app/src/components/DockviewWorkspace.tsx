import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { useStudio } from '../state/StudioState';
import { Viewport3D } from './Viewport3D';
import { Hierarchy } from './Hierarchy';
import { Inspector } from './Inspector';
import { AssetBrowser } from './AssetBrowser';
import { EventSheetEditor } from './EventSheetEditor';
import { AgentSwarmDock } from './AgentSwarmDock';
import { ArtemisQADock } from './ArtemisQADock';
import { ProfilerDock } from './ProfilerDock';
import { ConsoleDock } from './ConsoleDock';
import { TerrainSculptorDock } from './TerrainSculptorDock';
import { AnimationBlendTreeDock } from './AnimationBlendTreeDock';

import {
  Box,
  Layers,
  Sliders,
  Folder,
  Zap,
  Users,
  Bot,
  Activity,
  Terminal,
  Mountain,
  Film,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Move,
  RotateCw,
  Scaling,
  Smartphone,
  LayoutGrid,
  Menu,
  Sparkles,
  ChevronDown,
  PlusCircle,
  Eye
} from 'lucide-react';

// Panel components registry for DockviewReact
const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  scene_viewport: () => <Viewport3D />,
  hierarchy: () => <Hierarchy />,
  inspector: () => <Inspector />,
  asset_browser: () => <AssetBrowser />,
  event_sheet: () => <EventSheetEditor />,
  agent_swarm: () => <AgentSwarmDock />,
  artemis_qa: () => <ArtemisQADock />,
  profiler: () => <ProfilerDock />,
  console: () => <ConsoleDock />,
  terrain_sculptor: () => <TerrainSculptorDock />,
  animation_studio: () => <AnimationBlendTreeDock />
};

export type WorkspacePreset = 'default' | 'level_design' | 'visual_scripting' | 'ai_swarm' | 'mobile_qa';

export const DockviewWorkspace: React.FC = () => {
  const { isPlaying, startPlayMode, stopPlayMode, addLog } = useStudio();
  const apiRef = useRef<DockviewApi | null>(null);
  const [activePreset, setActivePreset] = useState<WorkspacePreset>('default');
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [showAddPanelMenu, setShowAddPanelMenu] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [snapping, setSnapping] = useState(false);

  // Apply workspace layout presets
  const applyPreset = useCallback((preset: WorkspacePreset, api: DockviewApi) => {
    api.clear();

    if (preset === 'default') {
      // 1. Center Viewport
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Scene Viewport',
        renderer: 'always'
      });

      // 2. Terrain Sculptor tabbed with Viewport
      api.addPanel({
        id: 'terrain_sculptor',
        component: 'terrain_sculptor',
        title: 'Terrain Sculptor',
        position: { referencePanel: 'scene_viewport', direction: 'within' }
      });

      // 3. Hierarchy on Left
      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Scene Hierarchy',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      // 4. Inspector on Right
      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: { referencePanel: 'scene_viewport', direction: 'right' }
      });

      // 5. Asset Store at bottom
      api.addPanel({
        id: 'asset_browser',
        component: 'asset_browser',
        title: 'GDevelop 3D Store',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      // 6. Tabs in bottom panel
      api.addPanel({
        id: 'event_sheet',
        component: 'event_sheet',
        title: 'Visual Event Sheet',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'animation_studio',
        component: 'animation_studio',
        title: 'Animation Studio',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'agent_swarm',
        component: 'agent_swarm',
        title: 'Agent Swarm',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Artemis Mobile QA',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: 'Mobile Profiler',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console & Logcat',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });
    } else if (preset === 'level_design') {
      // Level Design & World preset: Large Viewport, Terrain Sculptor on side, Asset store on bottom
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Scene Viewport',
        renderer: 'always'
      });

      api.addPanel({
        id: 'terrain_sculptor',
        component: 'terrain_sculptor',
        title: 'Terrain Sculptor',
        position: { referencePanel: 'scene_viewport', direction: 'right' }
      });

      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Hierarchy',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      api.addPanel({
        id: 'asset_browser',
        component: 'asset_browser',
        title: 'GDevelop 3D Assets',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: { referencePanel: 'terrain_sculptor', direction: 'below' }
      });
    } else if (preset === 'visual_scripting') {
      // Visual Scripting preset: Event Sheet & Viewport side-by-side
      api.addPanel({
        id: 'event_sheet',
        component: 'event_sheet',
        title: 'Visual Event Sheet Editor'
      });

      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Live Preview',
        renderer: 'always',
        position: { referencePanel: 'event_sheet', direction: 'right' }
      });

      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Hierarchy',
        position: { referencePanel: 'event_sheet', direction: 'left' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console & Logcat',
        position: { referencePanel: 'event_sheet', direction: 'below' }
      });
    } else if (preset === 'ai_swarm') {
      // AI Swarm Operations preset: Agent Swarm dock front and center
      api.addPanel({
        id: 'agent_swarm',
        component: 'agent_swarm',
        title: 'Autonomous Agent Swarm & Memory'
      });

      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Viewport',
        renderer: 'always',
        position: { referencePanel: 'agent_swarm', direction: 'right' }
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Artemis QA Telemetry',
        position: { referencePanel: 'agent_swarm', direction: 'below' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: 'Mobile Profiler',
        position: { referencePanel: 'artemis_qa', direction: 'within' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console Logs',
        position: { referencePanel: 'artemis_qa', direction: 'within' }
      });
    } else if (preset === 'mobile_qa') {
      // Mobile Android QA preset: Device Viewport with Artemis QA and Profiler
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: 'Android Game View',
        renderer: 'always'
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Google Artemis Mobile QA',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: '60 FPS Profiler & Memory',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Android Logcat',
        position: { referencePanel: 'profiler', direction: 'within' }
      });
    }

    setActivePreset(preset);
    addLog('info', 'StudioWorkspace', `Applied layout preset: "${preset}".`);
  }, [addLog]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    applyPreset('default', event.api);
  }, [applyPreset]);

  const handleOpenPanel = (panelId: string, title: string) => {
    if (!apiRef.current) return;
    const existing = apiRef.current.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
    } else {
      apiRef.current.addPanel({
        id: panelId,
        component: panelId,
        title,
        position: { direction: 'within', referencePanel: 'scene_viewport' }
      });
    }
    setShowAddPanelMenu(false);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Professional Studio Toolbar */}
      <header className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 z-20">
        {/* Left: Branding & Presets */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-xs text-white shadow">
              H
            </div>
            <span className="font-bold text-xs tracking-wider text-white">HERETEK 3D STUDIO</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 rounded border border-zinc-700">AAA</span>
          </div>

          <div className="h-4 w-px bg-zinc-700" />

          {/* Preset Layout Selector */}
          <div className="relative">
            <button
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              className="flex items-center space-x-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 rounded text-xs border border-zinc-700 hover:border-zinc-600 transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-blue-400" />
              <span className="capitalize">{activePreset.replace('_', ' ')}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {showLayoutMenu && (
              <div className="absolute left-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-750 rounded-lg shadow-2xl py-1 z-50 text-xs">
                {[
                  { id: 'default', label: 'Default Studio Workspace', desc: 'Balanced 3D viewport, store, hierarchy, & inspector' },
                  { id: 'level_design', label: 'Open-World Level Design', desc: 'Focused on terrain sculptor, assets, & lighting' },
                  { id: 'visual_scripting', label: 'Visual Scripting & Logic', desc: 'Side-by-side GDevelop event sheets & preview' },
                  { id: 'ai_swarm', label: 'AI Swarm Operations', desc: 'Multi-agent orchestration & project memory' },
                  { id: 'mobile_qa', label: 'Mobile Android QA', desc: 'Device frame, Artemis autonomous runner & 60 FPS' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (apiRef.current) applyPreset(p.id as WorkspacePreset, apiRef.current);
                      setShowLayoutMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors ${
                      activePreset === p.id ? 'bg-blue-600/20 text-blue-300 font-semibold' : 'text-zinc-300'
                    }`}
                  >
                    <div>{p.label}</div>
                    <div className="text-[10px] text-zinc-500 font-normal">{p.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add / Reopen Panel Menu */}
          <div className="relative">
            <button
              onClick={() => setShowAddPanelMenu(!showAddPanelMenu)}
              className="flex items-center space-x-1 px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded text-xs transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Panels</span>
            </button>

            {showAddPanelMenu && (
              <div className="absolute left-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-750 rounded-lg shadow-2xl py-1 z-50 text-xs">
                {[
                  { id: 'scene_viewport', title: '3D Scene Viewport', icon: Box },
                  { id: 'hierarchy', title: 'Scene Hierarchy', icon: Layers },
                  { id: 'inspector', title: 'Inspector', icon: Sliders },
                  { id: 'asset_browser', title: 'GDevelop 3D Store', icon: Folder },
                  { id: 'terrain_sculptor', title: 'Terrain Sculptor', icon: Mountain },
                  { id: 'animation_studio', title: 'Animation Studio', icon: Film },
                  { id: 'event_sheet', title: 'Visual Event Sheet', icon: Zap },
                  { id: 'agent_swarm', title: 'Agent Swarm', icon: Users },
                  { id: 'artemis_qa', title: 'Artemis QA', icon: Bot },
                  { id: 'profiler', title: 'Mobile Profiler', icon: Activity },
                  { id: 'console', title: 'Console & Logcat', icon: Terminal }
                ].map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleOpenPanel(item.id, item.title)}
                      className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center space-x-2 text-zinc-300 hover:text-white"
                    >
                      <Icon className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{item.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Center: Play / Pause Simulation Controls */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 shadow-inner">
            <button
              onClick={isPlaying ? stopPlayMode : startPlayMode}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                isPlaying
                  ? 'bg-amber-600 text-white shadow-md animate-pulse'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause Mode' : 'Play Arena'}</span>
            </button>

            <button
              onClick={() => {
                if (isPlaying) stopPlayMode();
                startPlayMode();
              }}
              title="Reset Scene & Physics"
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded ml-1 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Quick Tools (Gizmos, Snapping, AI status) */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
            <button
              onClick={() => setGizmoMode('translate')}
              title="Translate (W)"
              className={`p-1 rounded ${gizmoMode === 'translate' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <Move className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setGizmoMode('rotate')}
              title="Rotate (E)"
              className={`p-1 rounded ${gizmoMode === 'rotate' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setGizmoMode('scale')}
              title="Scale (R)"
              className={`p-1 rounded ${gizmoMode === 'scale' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <Scaling className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setSnapping(!snapping)}
            className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors ${
              snapping ? 'bg-blue-950/60 border-blue-500 text-blue-300' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Snap: {snapping ? '1.0m' : 'Off'}
          </button>

          <div className="h-4 w-px bg-zinc-700" />

          {/* AI Harness Status Badge */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-purple-950/40 border border-purple-800/40 rounded text-[11px] text-purple-300 font-mono">
            <Sparkles className="w-3 h-3 text-purple-400 animate-spin" />
            <span>mimo-v2.6-flash</span>
          </div>
        </div>
      </header>

      {/* Dockview Multi-Window Workspace Container */}
      <main className="flex-1 w-full h-full dockview-theme-dark relative overflow-hidden">
        <DockviewReact
          components={components}
          onReady={onReady}
        />
      </main>
    </div>
  );
};
