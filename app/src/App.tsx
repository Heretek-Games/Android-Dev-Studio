import React, { useState } from 'react';
import { StudioProvider } from './state/StudioState';
import { DeviceBar } from './components/DeviceBar';
import { Viewport3D } from './components/Viewport3D';
import { Hierarchy } from './components/Hierarchy';
import { Inspector } from './components/Inspector';
import { EventSheetEditor } from './components/EventSheetEditor';
import { AIHarnessDock } from './components/AIHarnessDock';
import { ArtemisQADock } from './components/ArtemisQADock';
import { AssetBrowser } from './components/AssetBrowser';
import { ConsoleDock } from './components/ConsoleDock';
import { AgentSwarmDock } from './components/AgentSwarmDock';
import { ProfilerDock } from './components/ProfilerDock';
import {
  Box,
  Zap,
  Sparkles,
  Bot,
  Folder,
  Terminal,
  Users,
  Activity
} from 'lucide-react';

const StudioContent: React.FC = () => {
  const [centerTab, setCenterTab] = useState<'viewport' | 'events'>('viewport');
  const [bottomTab, setBottomTab] = useState<'ai' | 'swarm' | 'artemis' | 'profiler' | 'assets' | 'console'>('ai');

  return (
    <div className="flex flex-col h-screen w-screen bg-studio-bg text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Device Bar & Controls */}
      <DeviceBar />

      {/* Main Workspace (Split Grid) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Hierarchy */}
        <div className="w-64 min-w-[200px] max-w-[320px] h-full flex flex-col border-r border-studio-border bg-studio-surface">
          <Hierarchy />
        </div>

        {/* Center: Viewport & Bottom Tabs */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Upper Center: 3D Viewport & Visual Event Sheet tabs */}
          <div className="flex-1 flex flex-col min-h-[300px] overflow-hidden">
            {/* Tab Bar */}
            <div className="h-8 bg-zinc-900 border-b border-studio-border flex items-center px-2 space-x-1">
              <button
                onClick={() => setCenterTab('viewport')}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                  centerTab === 'viewport'
                    ? 'bg-zinc-950 text-blue-400 border-t-2 border-blue-500 font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>3D Scene Viewport</span>
              </button>
              <button
                onClick={() => setCenterTab('events')}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                  centerTab === 'events'
                    ? 'bg-zinc-950 text-amber-400 border-t-2 border-amber-500 font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Visual Event Sheet Editor (GDevelop)</span>
              </button>
            </div>

            {/* Viewport Content */}
            <div className="flex-1 relative overflow-hidden bg-black">
              {centerTab === 'viewport' ? <Viewport3D /> : <EventSheetEditor />}
            </div>
          </div>

          {/* Lower Center: Bottom Dock Tabs */}
          <div className="h-72 min-h-[180px] max-h-[420px] flex flex-col border-t border-studio-border bg-studio-surface">
            {/* Bottom Tab Bar */}
            <div className="h-8 bg-zinc-900 border-b border-studio-border flex items-center justify-between px-2">
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setBottomTab('ai')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'ai'
                      ? 'bg-studio-surface text-purple-400 border-t-2 border-purple-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Studio AI Copilot</span>
                </button>
                <button
                  onClick={() => setBottomTab('swarm')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'swarm'
                      ? 'bg-studio-surface text-indigo-400 border-t-2 border-indigo-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Agent Swarm & Memory</span>
                </button>
                <button
                  onClick={() => setBottomTab('artemis')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'artemis'
                      ? 'bg-studio-surface text-emerald-400 border-t-2 border-emerald-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Google Artemis Mobile QA</span>
                </button>
                <button
                  onClick={() => setBottomTab('profiler')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'profiler'
                      ? 'bg-studio-surface text-blue-400 border-t-2 border-blue-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Mobile Profiler</span>
                </button>
                <button
                  onClick={() => setBottomTab('assets')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'assets'
                      ? 'bg-studio-surface text-amber-400 border-t-2 border-amber-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>Project Assets & CC0 Store</span>
                </button>
                <button
                  onClick={() => setBottomTab('console')}
                  className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    bottomTab === 'console'
                      ? 'bg-studio-surface text-cyan-400 border-t-2 border-cyan-500 font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Console & Logcat</span>
                </button>
              </div>
            </div>

            {/* Active Bottom Tab Body */}
            <div className="flex-1 overflow-hidden">
              {bottomTab === 'ai' && <AIHarnessDock />}
              {bottomTab === 'swarm' && <AgentSwarmDock />}
              {bottomTab === 'artemis' && <ArtemisQADock />}
              {bottomTab === 'profiler' && <ProfilerDock />}
              {bottomTab === 'assets' && <AssetBrowser />}
              {bottomTab === 'console' && <ConsoleDock />}
            </div>
          </div>
        </div>

        {/* Right: Inspector */}
        <div className="w-80 min-w-[260px] max-w-[380px] h-full flex flex-col border-l border-studio-border bg-studio-surface">
          <Inspector />
        </div>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <StudioProvider>
      <StudioContent />
    </StudioProvider>
  );
};

export default App;
