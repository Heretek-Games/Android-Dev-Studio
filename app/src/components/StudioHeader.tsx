import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Smartphone,
  RefreshCw,
  Zap,
  Activity,
  LayoutGrid,
  ChevronDown,
  PlusCircle,
  Move,
  RotateCw,
  Scaling,
  Box,
  Layers,
  Sliders,
  Folder,
  Terminal,
  Mountain,
  Film,
  Users,
  Bot,
  Sparkles,
  Check
} from 'lucide-react';
import type { WorkspacePreset } from './DockviewWorkspace';

interface StudioHeaderProps {
  activePreset: WorkspacePreset;
  onSelectPreset: (preset: WorkspacePreset) => void;
  onOpenPanel: (panelId: string, title: string) => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  activePreset,
  onSelectPreset,
  onOpenPanel
}) => {
  const [deployTier, setDeployTier] = useState<1 | 2>(1);
  const {
    isPlaying,
    isPaused,
    startPlayMode,
    pausePlayMode,
    stopPlayMode,
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    deployToDevice,
    gizmoMode,
    setGizmoMode,
    snapping,
    setSnapping,
    scene
  } = useStudio();

  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [showPanelsMenu, setShowPanelsMenu] = useState(false);

  const presets: { id: WorkspacePreset; label: string; desc: string }[] = [
    { id: 'default', label: 'Default Studio Workspace', desc: 'Balanced 3D viewport, store, hierarchy, & inspector' },
    { id: 'level_design', label: 'Open-World Level Design', desc: 'Terrain sculptor, assets, foliage, & lighting' },
    { id: 'visual_scripting', label: 'Visual Scripting & Logic', desc: 'Side-by-side GDevelop event sheets & live preview' },
    { id: 'ai_swarm', label: 'AI Swarm Operations', desc: 'Multi-agent orchestration & project ADR memory' },
    { id: 'mobile_qa', label: 'Mobile Android QA', desc: 'Device frame, Artemis autonomous runner & 60 FPS' }
  ];

  const panels = [
    { id: 'scene_viewport', title: '3D Scene Viewport', icon: Box },
    { id: 'hierarchy', title: 'Scene Hierarchy', icon: Layers },
    { id: 'inspector', title: 'Inspector', icon: Sliders },
    { id: 'asset_browser', title: 'GDevelop 3D Store', icon: Folder },
    { id: 'console', title: 'Console & Logcat', icon: Terminal },
    { id: 'terrain_sculptor', title: 'Terrain Sculptor', icon: Mountain },
    { id: 'animation_studio', title: 'Animation Studio', icon: Film },
    { id: 'event_sheet', title: 'Visual Event Sheet', icon: Zap },
    { id: 'ai_harness', title: 'AI Copilot', icon: Sparkles },
    { id: 'agent_swarm', title: 'Agent Swarm', icon: Users },
    { id: 'artemis_qa', title: 'Artemis Mobile QA', icon: Bot },
    { id: 'profiler', title: 'Mobile Profiler', icon: Activity },
    { id: 'device_mirror', title: 'Device Mirror & Profiler', icon: Smartphone }
  ];

  return (
    <header className="h-10 bg-[#0e1015] border-b border-zinc-800/80 px-3 flex items-center justify-between select-none z-30 shadow-md">
      {/* LEFT: Branding, Workspace Presets & Panels */}
      <div className="flex items-center space-x-2.5">
        {/* Brand Logo */}
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center font-black text-xs text-white shadow-md shadow-blue-500/20">
            H
          </div>
          <span className="font-bold text-xs tracking-wider text-white">HERETEK</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono font-medium border border-blue-500/20">
            3D Android
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        {/* Workspace Preset Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowPresetMenu(!showPresetMenu);
              setShowPanelsMenu(false);
            }}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 rounded text-xs border border-zinc-800 hover:border-zinc-700 transition-colors shadow-sm"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-medium capitalize">{activePreset.replace('_', ' ')}</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>

          {showPresetMenu && (
            <div
              className="absolute left-0 top-full mt-1.5 w-60 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-lg shadow-2xl py-1 z-50 text-xs"
              onMouseLeave={() => setShowPresetMenu(false)}
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-800/80">
                Workspace Presets
              </div>
              {presets.map(p => {
                const isActive = activePreset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelectPreset(p.id);
                      setShowPresetMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-start justify-between hover:bg-zinc-800/80 transition-colors ${
                      isActive ? 'bg-blue-600/15 text-blue-300 font-semibold' : 'text-zinc-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span>{p.label}</span>
                        {isActive && <Check className="w-3 h-3 text-blue-400 inline" />}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-normal mt-0.5">{p.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reopen Panels Menu */}
        <div className="relative">
          <button
            onClick={() => {
              setShowPanelsMenu(!showPanelsMenu);
              setShowPresetMenu(false);
            }}
            className="flex items-center space-x-1 px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded text-xs transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Panels</span>
          </button>

          {showPanelsMenu && (
            <div
              className="absolute left-0 top-full mt-1.5 w-52 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-lg shadow-2xl py-1 z-50 text-xs"
              onMouseLeave={() => setShowPanelsMenu(false)}
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-800/80">
                Studio Panels
              </div>
              {panels.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onOpenPanel(item.id, item.title);
                      setShowPanelsMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center space-x-2 text-zinc-300 hover:text-white transition-colors"
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

      {/* CENTER: Transport Controls & FPS Telemetry */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => { window.location.search = '?play=1'; }}
          title="Play the arena game (menu, waves, HUD, win/lose)"
          className="flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-sm shadow-violet-600/30 transition-all"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Game</span>
        </button>
        <button
          onClick={() => { window.location.search = '?play=driving'; }}
          title="Play the driving slice (avenue sprint, distance HUD)"
          className="flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-sm shadow-sky-600/30 transition-all"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Drive</span>
        </button>
        <div className="flex items-center space-x-1 bg-zinc-900/90 px-1.5 py-0.5 rounded-lg border border-zinc-800 shadow-inner">
          <button
            onClick={isPlaying ? stopPlayMode : startPlayMode}
            title={isPlaying ? "Stop Scene Simulation" : "Play Scene in Mobile Emulation"}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
              isPlaying
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-600/30'
            }`}
          >
            {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'Stop' : 'Play Arena'}</span>
          </button>

          {isPlaying && (
            <button
              onClick={pausePlayMode}
              title={isPaused ? "Resume Simulation" : "Pause Simulation"}
              className={`p-1 rounded text-xs transition-colors ${
                isPaused
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => {
              if (isPlaying) stopPlayMode();
              startPlayMode();
            }}
            title="Reset Scene Physics & Entities"
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <div className="flex items-center space-x-1.5 px-1.5 text-xs text-zinc-400 font-mono">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="font-semibold text-zinc-200">60 FPS</span>
            <span className="text-[10px] text-zinc-500">16.6ms</span>
          </div>
        </div>
      </div>

      {/* RIGHT: Gizmo Tools, Device Selector, Deploy APK & AI Badge */}
      <div className="flex items-center space-x-2 text-xs">
        {/* Transform Gizmo Selector */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5">
          <button
            onClick={() => setGizmoMode('translate')}
            title="Translate (W)"
            className={`p-1 rounded transition-colors ${
              gizmoMode === 'translate' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Move className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setGizmoMode('rotate')}
            title="Rotate (E)"
            className={`p-1 rounded transition-colors ${
              gizmoMode === 'rotate' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setGizmoMode('scale')}
            title="Scale (R)"
            className={`p-1 rounded transition-colors ${
              gizmoMode === 'scale' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Scaling className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Grid Snapping Toggle */}
        <button
          onClick={() => setSnapping(s => !s)}
          title="Toggle Grid Snapping"
          className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors ${
            snapping
              ? 'bg-blue-950/60 border-blue-500/60 text-blue-300'
              : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Snap: {snapping ? '1.0m' : 'Off'}
        </button>

        <div className="h-4 w-px bg-zinc-800" />

        {/* Android Device Selector */}
        <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
          <Smartphone className="w-3.5 h-3.5 text-blue-400" />
          <select
            value={selectedDevice || ''}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="bg-transparent text-xs text-zinc-200 outline-none cursor-pointer pr-1"
          >
            {devices.map(d => (
              <option key={d.id} value={d.id} className="bg-zinc-900 text-zinc-200">
                {d.model} ({d.id})
              </option>
            ))}
            {devices.length === 0 && (
              <option value="" className="bg-zinc-900 text-zinc-400">No device detected</option>
            )}
          </select>
          <button
            onClick={refreshDevices}
            title="Refresh ADB devices"
            className="text-zinc-400 hover:text-white p-0.5 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* Deploy APK */}
        <select
          value={deployTier}
          onChange={(e) => setDeployTier(Number(e.target.value) === 2 ? 2 : 1)}
          title="Packaging tier: Tier 1 WebView container or Tier 2 native Vulkan container"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none cursor-pointer"
        >
          <option value={1} className="bg-zinc-900 text-zinc-200">Tier 1 · WebView</option>
          <option value={2} className="bg-zinc-900 text-zinc-200">Tier 2 · Vulkan</option>
        </select>
        <button
          onClick={() => deployToDevice(deployTier)}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-sm shadow-blue-600/30 transition-all active:scale-95"
          title={deployTier === 2 ? "Export scene and cross-compile the native Vulkan library (arm64-v8a)" : "Build APK and Deploy to connected Android Device via ADB"}
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          <span>Deploy APK</span>
        </button>

        {/* AI Harness Status Pill */}
        <div className="flex items-center space-x-1.5 px-2 py-1 bg-purple-950/40 border border-purple-800/40 rounded text-[11px] text-purple-300 font-mono">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>mimo-v2.6</span>
        </div>
      </div>
    </header>
  );
};
