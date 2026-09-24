import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Bot,
  Smartphone,
  Play,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Terminal,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Zap,
  RotateCcw
} from 'lucide-react';

export const ArtemisQADock: React.FC = () => {
  const {
    devices,
    selectedDevice,
    refreshDevices,
    artemisRunning,
    artemisLog,
    runArtemisTask
  } = useStudio();

  const [testPrompt, setTestPrompt] = useState(
    'Play through the arena: move player forward with joystick, jump over obstacles, verify 60 FPS, and verify 0 crash exceptions in Logcat.'
  );

  const activeDev = devices.find(d => d.id === selectedDevice) || devices[0];

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-t border-studio-border">
      {/* Panel Header */}
      <div className="flex items-center justify-between p-3 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-gray-200 uppercase tracking-wide">
            Google Artemis Autonomous Mobile QA
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
            99%+ AndroidWorld SOTA
          </span>
          <button
            onClick={refreshDevices}
            className="p-1 rounded text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-3 divide-x divide-studio-border overflow-hidden">
        {/* Left Column: Device Status & Benchmark Profile */}
        <div className="p-3 space-y-3 bg-zinc-900/40 overflow-y-auto text-xs">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Target Test Device
          </span>

          {activeDev ? (
            <div className="bg-zinc-800/80 border border-studio-border rounded-lg p-3 space-y-2">
              <div className="flex items-center space-x-2 text-white font-medium">
                <Smartphone className="w-4 h-4 text-blue-400" />
                <span>{activeDev.model}</span>
              </div>
              <div className="space-y-1 text-[11px] text-gray-400">
                <div className="flex justify-between">
                  <span>Serial ID:</span>
                  <span className="font-mono text-gray-200">{activeDev.id}</span>
                </div>
                <div className="flex justify-between">
                  <span>System:</span>
                  <span className="text-gray-200">{activeDev.apiLevel || 'Android 14 (API 34)'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Connection:</span>
                  <span className="text-emerald-400 font-medium">ADB Authorized</span>
                </div>
                <div className="flex justify-between">
                  <span>Battery:</span>
                  <span className="text-gray-200">{activeDev.battery || 100}%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-xs py-4 text-center">
              No device connected. Ensure USB debugging is active.
            </div>
          )}

          {/* QA Presets */}
          <div className="space-y-1.5 pt-2">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
              Autonomous QA Presets
            </span>
            <button
              onClick={() => setTestPrompt('Drive player character using virtual joystick, perform 3 jumps, and check physics stability.')}
              className="w-full text-left p-2 rounded bg-zinc-800 hover:bg-zinc-700 border border-studio-border text-gray-300 transition-colors"
            >
              🕹️ Mobile Controls & Joystick Stress Test
            </button>
            <button
              onClick={() => setTestPrompt('Stress-test 3D arena performance: monitor FPS drops under 60fps and detect thermal throttling.')}
              className="w-full text-left p-2 rounded bg-zinc-800 hover:bg-zinc-700 border border-studio-border text-gray-300 transition-colors"
            >
              ⚡ 60 FPS Profiler & VRAM Leak Audit
            </button>
            <button
              onClick={() => setTestPrompt('Trigger collision boundaries across all obstacles and verify player does not clip through ground.')}
              className="w-full text-left p-2 rounded bg-zinc-800 hover:bg-zinc-700 border border-studio-border text-gray-300 transition-colors"
            >
              🛡️ Rapier3D Boundary & Collision Audit
            </button>
          </div>
        </div>

        {/* Middle Column: Test Scenario Runner */}
        <div className="p-3 flex flex-col space-y-3 bg-zinc-900/20 col-span-2 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300">
              Natural Language Autonomous Test Plan
            </label>
            <textarea
              rows={3}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              className="w-full bg-zinc-900 border border-studio-border rounded-lg p-2.5 text-xs text-white placeholder-gray-500 focus:border-emerald-500 outline-none resize-none font-mono"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => runArtemisTask(testPrompt)}
              disabled={artemisRunning}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all active:scale-95"
            >
              {artemisRunning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Artemis Driving Phone...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Autonomous Playtest</span>
                </>
              )}
            </button>

            <span className="text-[11px] text-gray-400 font-mono">
              Pattern: Dynamic-First, Coordinate-Fallback
            </span>
          </div>

          {/* Live Artemis Output / Telemetry Log */}
          <div className="flex-1 bg-black/80 border border-studio-border rounded-lg p-3 overflow-y-auto font-mono text-[11px] space-y-1.5 min-h-[140px]">
            {artemisLog.length === 0 ? (
              <span className="text-gray-600">Artemis agent standing by. Click 'Run Autonomous Playtest' to begin.</span>
            ) : (
              artemisLog.map((line, i) => (
                <div key={i} className="text-emerald-300 leading-relaxed">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
