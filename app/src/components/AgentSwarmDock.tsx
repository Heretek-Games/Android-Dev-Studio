import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Users,
  Compass,
  Code2,
  ShieldCheck,
  Bot,
  Play,
  CheckCircle2,
  Clock,
  Sparkles,
  FileText,
  Layers,
  ArrowRight,
  RefreshCw,
  Send
} from 'lucide-react';

interface SwarmTask {
  id: string;
  role: 'SystemsArchitect' | 'GameplayCoder' | 'CodeReviewer' | 'ArtemisQA';
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

interface AdrRecord {
  id: string;
  title: string;
  rationale: string;
  status: string;
}

export const AgentSwarmDock: React.FC = () => {
  const { addLog, scene, refreshScene } = useStudio();
  const [goalPrompt, setGoalPrompt] = useState('Build Doom-style demon horde arena with plasma rifle weapon controller');
  const [isDispatching, setIsDispatching] = useState(false);
  const [tasks, setTasks] = useState<SwarmTask[]>([
    {
      id: 'task-1',
      role: 'SystemsArchitect',
      title: 'Decompose GDD: Doom Arena & Horde Spawner',
      status: 'completed',
      result: 'ADR-101 created: Quadtree layout and 15m trigger radiuses'
    },
    {
      id: 'task-2',
      role: 'GameplayCoder',
      title: 'Implement WeaponController & Ballistic Raycast',
      status: 'completed',
      result: 'Compiled zero-GC raycast hitscan with recoil recovery'
    },
    {
      id: 'task-3',
      role: 'GameplayCoder',
      title: 'Implement Demon Horde Behavior Tree',
      status: 'completed',
      result: 'Attached Sequence (DistanceCheck -> MoveTowards)'
    },
    {
      id: 'task-4',
      role: 'CodeReviewer',
      title: 'Audit 60 FPS Draw Calls & Memory Leaks',
      status: 'completed',
      result: 'Approved: 38 draw calls, 0 per-frame heap allocations'
    },
    {
      id: 'task-5',
      role: 'ArtemisQA',
      title: 'Google Artemis Autonomous Mobile Validation',
      status: 'completed',
      result: 'Verified 60.4 FPS, 0 Logcat exceptions, 100% success'
    }
  ]);

  const [adrs, setAdrs] = useState<AdrRecord[]>([
    {
      id: 'ADR-001',
      title: 'Zero-GC Per-Frame Heap Allocation Invariant',
      rationale: 'Avoid garbage collection stutters on Android mobile by reusing scratch Vector3/Raycaster instances in update(dt).',
      status: 'accepted'
    },
    {
      id: 'ADR-002',
      title: 'Dual-Tier Engine: WebGL2 Container & Native Vulkan',
      rationale: 'Tier 1 WebGL2 hardware WebView for fast AI development; Tier 2 Filament/Vulkan for 50k+ draw calls.',
      status: 'accepted'
    },
    {
      id: 'ADR-003',
      title: 'Dynamic-First, Coordinate-Fallback QA Locator Pattern',
      rationale: 'Ensure autonomous test resilience against dynamic mobile UI resolutions.',
      status: 'accepted'
    }
  ]);

  const handleDispatchSwarm = async () => {
    if (!goalPrompt.trim() || isDispatching) return;

    setIsDispatching(true);
    addLog('ai', 'AgentSwarm', `Dispatching Autonomous Subagent Swarm for: "${goalPrompt}"`);

    // Reset task sequence for simulation
    const newTasks: SwarmTask[] = [
      { id: 't-1', role: 'SystemsArchitect', title: 'Architectural Decomposition & Scene AST', status: 'in_progress' },
      { id: 't-2', role: 'GameplayCoder', title: 'Compile High-Performance Gameplay Components', status: 'pending' },
      { id: 't-3', role: 'CodeReviewer', title: 'Static Analysis & Zero-GC Profiling Audit', status: 'pending' },
      { id: 't-4', role: 'ArtemisQA', title: 'Google Artemis Autonomous Playtesting on Android', status: 'pending' }
    ];
    setTasks(newTasks);

    // Step 1: Architect
    await new Promise(r => setTimeout(r, 800));
    setTasks(prev => prev.map(t => t.id === 't-1' ? { ...t, status: 'completed', result: 'ADR recorded & Task DAG generated' } : t.id === 't-2' ? { ...t, status: 'in_progress' } : t));
    const newAdrId = `ADR-${Math.floor(100 + Math.random() * 900)}`;
    setAdrs(prev => [
      {
        id: newAdrId,
        title: `Architecture: ${goalPrompt.slice(0, 36)}...`,
        rationale: 'Configured modular ECS hierarchy with mobile PBR material profile and Rapier3D colliders.',
        status: 'accepted'
      },
      ...prev
    ]);
    addLog('ai', 'Architect', `Generated Task DAG and recorded ${newAdrId}`);

    // Step 2: Gameplay Coder
    await new Promise(r => setTimeout(r, 900));
    setTasks(prev => prev.map(t => t.id === 't-2' ? { ...t, status: 'completed', result: 'Synthesized components with 0-allocation loops' } : t.id === 't-3' ? { ...t, status: 'in_progress' } : t));
    addLog('ai', 'Coder', 'Engine systems compiled and attached to active scene graph.');

    // Step 3: Reviewer
    await new Promise(r => setTimeout(r, 700));
    setTasks(prev => prev.map(t => t.id === 't-3' ? { ...t, status: 'completed', result: 'Quality Gate: PASSED (32 draw calls, 0 GC leaks)' } : t.id === 't-4' ? { ...t, status: 'in_progress' } : t));
    addLog('ai', 'Reviewer', 'Audit passed: Memory budget < 180MB, draw calls within 60 FPS mobile limits.');

    // Step 4: Artemis QA
    await new Promise(r => setTimeout(r, 900));
    setTasks(prev => prev.map(t => t.id === 't-4' ? { ...t, status: 'completed', result: 'Verdict: TASK SUCCEEDED (60.4 FPS, 0 exceptions)' } : t));
    addLog('ai', 'ArtemisQA', 'Device playtest complete: Game balance verified, 60 FPS sustained.');

    refreshScene();
    setIsDispatching(false);
  };

  const getRoleBadge = (role: SwarmTask['role']) => {
    switch (role) {
      case 'SystemsArchitect':
        return (
          <span className="flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
            <Compass className="w-3 h-3 text-blue-400" />
            <span>Architect</span>
          </span>
        );
      case 'GameplayCoder':
        return (
          <span className="flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <Code2 className="w-3 h-3 text-emerald-400" />
            <span>Coder</span>
          </span>
        );
      case 'CodeReviewer':
        return (
          <span className="flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <ShieldCheck className="w-3 h-3 text-purple-400" />
            <span>Reviewer</span>
          </span>
        );
      case 'ArtemisQA':
        return (
          <span className="flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Bot className="w-3 h-3 text-amber-400" />
            <span>Artemis QA</span>
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-t border-studio-border text-xs">
      {/* Header */}
      <div className="flex items-center justify-between p-2.5 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
            <Users className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-gray-200 uppercase tracking-wide">
            Autonomous Multi-Agent Swarm & Persistent Memory
          </span>
        </div>
        <div className="flex items-center space-x-2 text-[11px] text-gray-400 font-mono">
          <span>Active Agents: 4 | SQLite Ledger: Online</span>
        </div>
      </div>

      {/* Main Grid: Subagents + Task DAG (Left) | ADR Memory Ledger (Right) */}
      <div className="flex-1 grid grid-cols-3 divide-x divide-studio-border overflow-hidden">
        {/* Left Column: Subagent Swarm Roster & Live Task DAG */}
        <div className="col-span-2 p-3 flex flex-col space-y-3 overflow-y-auto">
          {/* Dispatch Input */}
          <div className="flex items-center space-x-2 bg-zinc-900 border border-studio-border rounded-lg p-1.5 shadow-sm">
            <input
              type="text"
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value)}
              placeholder="Enter AAA game prompt (e.g. 'Build Genshin style cel-shaded hero with elemental attacks')..."
              className="flex-1 bg-transparent px-2.5 py-1 text-xs text-white placeholder-gray-500 outline-none font-mono"
            />
            <button
              onClick={handleDispatchSwarm}
              disabled={isDispatching || !goalPrompt.trim()}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition-all active:scale-95"
            >
              {isDispatching ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Swarm Executing...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Dispatch Swarm</span>
                </>
              )}
            </button>
          </div>

          {/* Subagent Roster Bar */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { role: 'Systems Architect', spec: 'GDD & DAG Planning', icon: Compass, color: 'text-blue-400' },
              { role: 'Gameplay Coder', spec: 'Zero-GC Components', icon: Code2, color: 'text-emerald-400' },
              { role: 'Code Reviewer', spec: 'Static Quality Gate', icon: ShieldCheck, color: 'text-purple-400' },
              { role: 'Artemis QA', spec: '60 FPS Device Profiler', icon: Bot, color: 'text-amber-400' }
            ].map((ag, i) => (
              <div key={i} className="p-2 rounded-lg bg-zinc-900/80 border border-studio-border flex flex-col space-y-1">
                <div className="flex items-center space-x-1.5">
                  <ag.icon className={`w-3.5 h-3.5 ${ag.color}`} />
                  <span className="font-semibold text-gray-200 truncate">{ag.role}</span>
                </div>
                <span className="text-[10px] text-gray-400 truncate">{ag.spec}</span>
                <span className="text-[9px] text-emerald-400 font-mono flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Ready</span>
                </span>
              </div>
            ))}
          </div>

          {/* Task DAG Stream */}
          <div className="space-y-1.5 flex-1">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
              Active Task DAG Pipeline
            </span>
            <div className="space-y-1.5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-2 rounded-lg border flex items-center justify-between transition-colors ${
                    task.status === 'in_progress'
                      ? 'bg-indigo-950/20 border-indigo-500/40 text-white'
                      : task.status === 'completed'
                      ? 'bg-zinc-900/60 border-studio-border text-gray-300'
                      : 'bg-zinc-950/40 border-studio-border/50 text-gray-500'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : task.status === 'in_progress' ? (
                      <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-gray-500 shrink-0" />
                    )}
                    <div>
                      <div className="font-medium text-[11px]">{task.title}</div>
                      {task.result && (
                        <div className="text-[10px] text-emerald-300 font-mono mt-0.5">{task.result}</div>
                      )}
                    </div>
                  </div>
                  {getRoleBadge(task.role)}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Persistent Memory & ADR Ledger */}
        <div className="p-3 flex flex-col space-y-2 bg-zinc-900/30 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
              Persistent Memory (ADRs)
            </span>
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20">
              Cross-Session
            </span>
          </div>

          <div className="space-y-2 flex-1">
            {adrs.map((adr) => (
              <div key={adr.id} className="p-2.5 rounded-lg bg-zinc-900 border border-studio-border space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-blue-400">{adr.id}</span>
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1 rounded">
                    {adr.status}
                  </span>
                </div>
                <div className="font-semibold text-[11px] text-gray-200">{adr.title}</div>
                <p className="text-[10px] text-gray-400 leading-relaxed">{adr.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
