import React from 'react';
import { useStudio } from '../state/StudioState';
import {
  Play,
  Pause,
  Square,
  Smartphone,
  RefreshCw,
  Sparkles,
  Bot,
  Zap,
  Activity
} from 'lucide-react';

export const DeviceBar: React.FC = () => {
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
    deployToDevice
  } = useStudio();

  return (
    <header className="h-12 bg-studio-bg border-b border-studio-border px-4 flex items-center justify-between select-none">
      {/* Brand & Project Info */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-md shadow-blue-500/20">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm tracking-wide text-white">Heretek 3D Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono font-medium border border-blue-500/30">
              Android AI
            </span>
          </div>
        </div>
      </div>

      {/* Center Play Controls */}
      <div className="flex items-center space-x-1.5 bg-studio-surface px-2 py-1 rounded-lg border border-studio-border/60 shadow-inner">
        <button
          onClick={isPlaying ? stopPlayMode : startPlayMode}
          title={isPlaying ? "Stop Game Loop" : "Play Scene in Mobile Emulation"}
          className={`flex items-center space-x-1 px-3 py-1 rounded text-xs font-semibold transition-all ${
            isPlaying
              ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
              : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-600/30'
          }`}
        >
          {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>

        {isPlaying && (
          <button
            onClick={pausePlayMode}
            title={isPaused ? "Resume" : "Pause"}
            className={`p-1 rounded text-xs transition-all ${
              isPaused
                ? 'bg-amber-500 text-black font-bold'
                : 'text-gray-300 hover:bg-studio-hover'
            }`}
          >
            <Pause className="w-4 h-4" />
          </button>
        )}

        <div className="h-4 w-px bg-studio-border mx-1" />

        <div className="flex items-center space-x-1 text-xs text-gray-400 px-1 font-mono">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>60 FPS</span>
        </div>
      </div>

      {/* Right Android Device & Deployment Controls */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 bg-studio-surface border border-studio-border rounded-md px-2 py-1">
          <Smartphone className="w-3.5 h-3.5 text-blue-400" />
          <select
            value={selectedDevice || ''}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="bg-transparent text-xs text-gray-200 outline-none cursor-pointer pr-1"
          >
            {devices.map(d => (
              <option key={d.id} value={d.id} className="bg-zinc-800 text-white">
                {d.model} ({d.id})
              </option>
            ))}
            {devices.length === 0 && (
              <option value="" className="bg-zinc-800 text-gray-400">No device detected</option>
            )}
          </select>
          <button
            onClick={refreshDevices}
            title="Refresh ADB devices"
            className="text-gray-400 hover:text-white p-0.5 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <button
          onClick={deployToDevice}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/30 transition-all active:scale-95"
          title="Build APK and Deploy to connected Android Device via ADB"
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          <span>Deploy APK</span>
        </button>

        <div className="flex items-center space-x-1.5 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-md">
          <Bot className="w-3.5 h-3.5 text-purple-400" />
          <span className="font-medium">Artemis QA Ready</span>
        </div>
      </div>
    </header>
  );
};
