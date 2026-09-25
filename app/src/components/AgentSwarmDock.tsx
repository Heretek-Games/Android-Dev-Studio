import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Bot,
  Users,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ClipboardList,
  CircleDashed,
  FileText,
  Activity,
  ShieldCheck
} from 'lucide-react';

interface SwarmLogEntry {
  task_id: string;
  role: string;
  title: string;
  result: {
    status?: string;
    details?: string;
    todo?: string;
    adr_id?: string;
    verdict?: string;
    passed_rules?: string;
    telemetry?: Record<string, unknown>;
    regressions?: string[];
    violations_count?: number;
    is_valid?: boolean;
    draw_calls?: number;
    sim_fps?: number;
    heap_mb?: number;
    [key: string]: unknown;
  };
}

interface AdrRecord {
  id: string;
  title: string;
  rationale: string;
  status: string;
  tags?: string[];
  created_at?: number;
}

interface QaBenchmark {
  id: number;
  verdict: string;
  fps_average: number;
  draw_calls: number;
  heap_mb: number;
  goal: string;
  created_at: number;
}

interface SwarmResponse {
  ok: boolean;
  error?: string;
  prompt?: string;
  log?: SwarmLogEntry[];
  adrs?: AdrRecord[];
  latest_qa?: QaBenchmark[];
}

const ROSTER: Array<{ role: string; label: string; desc: string }> = [
  { role: 'SystemsArchitect', label: 'Systems Architect', desc: 'GDD & DAG Planning' },
  { role: 'WorldDesigner', label: 'World Designer', desc: 'Terrain & Streaming' },
  { role: 'ShaderDev', label: 'Shader & Tech Artist', desc: 'Cel Shading & Outlines' },
  { role: 'GameplayCoder', label: 'Gameplay Coder', desc: 'Components & Controllers' },
  { role: 'InvariantAuditor', label: 'Invariant Auditor', desc: 'Zero-Mistake Gate' },
  { role: 'ArtemisQA', label: 'Artemis QA', desc: 'Headless Sim & Baselines' },
  { role: 'CodeReviewer', label: 'Code Reviewer', desc: 'Final Sign-off' }
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    success: {
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'done'
    },
    passed: {
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'passed'
    },
    approved: {
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icon: <ShieldCheck className="w-3 h-3" />,
      label: 'approved'
    },
    skipped: {
      cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-600/40',
      icon: <CircleDashed className="w-3 h-3" />,
      label: 'TODO — not implemented'
    },
    regressed: {
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'regressed'
    },
    flagged: {
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'flagged'
    },
    failed: {
      cls: 'bg-red-500/15 text-red-300 border-red-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'failed'
    },
    violations_detected: {
      cls: 'bg-red-500/15 text-red-300 border-red-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'violations'
    },
    error: {
      cls: 'bg-red-500/15 text-red-300 border-red-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'error'
    }
  };
  const cfg = map[status] || map.error;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

export const AgentSwarmDock: React.FC = () => {
  const { addLog } = useStudio();
  const [goalPrompt, setGoalPrompt] = useState('Build Doom-style demon horde arena with plasma rifle weapon controller');
  const [isDispatching, setIsDispatching] = useState(false);
  const [response, setResponse] = useState<SwarmResponse | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const handleDispatchSwarm = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt || goalPrompt;
    if (!activePrompt.trim() || isDispatching) return;
    if (overridePrompt) setGoalPrompt(overridePrompt);

    setIsDispatching(true);
    setDispatchError(null);
    addLog('ai', 'AgentSwarm', `Dispatching real orchestrator pipeline for: "${activePrompt}"`);

    try {
      const res = await fetch('/api/swarm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: activePrompt })
      });
      const data: SwarmResponse = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResponse(data);
      const skipped = (data.log || []).filter(l => l.result?.status === 'skipped').length;
      addLog(
        'ai',
        'AgentSwarm',
        `Pipeline finished: ${data.log?.length || 0} tasks (${skipped} TODO-skips), ${data.adrs?.length || 0} ADRs in memory`
      );
    } catch (err: any) {
      setDispatchError(err.message);
      addLog('error', 'AgentSwarm', `Swarm dispatch failed: ${err.message}`);
    } finally {
      setIsDispatching(false);
    }
  };

  const logs = response?.log || [];
  const roleStatus = (role: string): string | null => {
    const entry = logs.find(l => l.role === role);
    return entry?.result?.status ?? null;
  };
  const taskIcon = (status?: string) => {
    if (status === 'success' || status === 'passed' || status === 'approved')
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (status === 'skipped') return <CircleDashed className="w-4 h-4 text-zinc-500 shrink-0" />;
    if (status === 'error' || status === 'failed' || status === 'violations_detected')
      return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />;
    return <Clock className="w-4 h-4 text-amber-400 shrink-0" />;
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-zinc-200 select-none text-xs font-sans">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800 bg-[#202023]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
            <Users className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-zinc-100 uppercase tracking-wide">
            Autonomous Multi-Agent Swarm &amp; Persistent Memory
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
          <Bot className="w-3 h-3 text-purple-400" />
          <span>Real orchestrator · SQLite ledger</span>
        </div>
      </div>

      {/* Prompt + dispatch */}
      <div className="flex items-center gap-2 p-3 border-b border-zinc-800 bg-[#1c1c1f]">
        <input
          value={goalPrompt}
          onChange={e => setGoalPrompt(e.target.value)}
          placeholder="Enter AAA game prompt (e.g. 'Build Genshin style cel-shaded hero')…"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-2 text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-500"
        />
        <button
          onClick={() => handleDispatchSwarm()}
          disabled={isDispatching}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold"
        >
          <Play className="w-3.5 h-3.5" />
          {isDispatching ? 'Running pipeline…' : 'Dispatch Swarm'}
        </button>
      </div>

      {(dispatchError || response) && (
        <div
          className={`px-3 py-1.5 text-[11px] border-b ${
            dispatchError
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {dispatchError
            ? `Dispatch failed: ${dispatchError}`
            : `Pipeline complete — ${logs.length} tasks executed through the real orchestrator`}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: roster + task DAG */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 border-r border-zinc-800">
          {/* Roster with real statuses */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Subagent Roster</div>
            <div className="grid grid-cols-4 gap-2">
              {ROSTER.map(r => {
                const status = roleStatus(r.role);
                return (
                  <div key={r.role} className="bg-[#202023] border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
                    <div className="font-semibold text-zinc-200 text-[11px]">{r.label}</div>
                    <div className="text-[10px] text-zinc-500">{r.desc}</div>
                    {status ? (
                      <StatusBadge status={status} />
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-700 text-[10px] text-zinc-500">
                        idle
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Task DAG pipeline (real results) */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Active Task DAG Pipeline</div>
            {logs.length === 0 ? (
              <div className="bg-[#202023] border border-dashed border-zinc-700 rounded-lg p-6 text-center text-zinc-500">
                <ClipboardList className="w-5 h-5 mx-auto mb-2 text-zinc-600" />
                No pipeline results yet. Dispatch the swarm to run the real Architect → Invariant Audit → Artemis QA →
                Review chain.
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map(entry => (
                  <div key={entry.task_id} className="bg-[#202023] border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        {taskIcon(entry.result?.status)}
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-200 truncate">{entry.title}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5 break-words">
                            {entry.result?.details || entry.result?.todo || '—'}
                          </div>
                          {entry.result?.status === 'skipped' && entry.result?.todo && (
                            <div className="text-[10px] text-amber-400/90 mt-1">TODO: {entry.result.todo}</div>
                          )}
                          {entry.result?.regressions && entry.result.regressions.length > 0 && (
                            <div className="text-[10px] text-amber-300 mt-1">
                              {entry.result.regressions.map((r: string) => (
                                <div key={r}>⚠ {r}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-zinc-500 font-mono">{entry.role}</span>
                        {entry.result?.status && <StatusBadge status={entry.result.status} />}
                      </div>
                    </div>
                    {entry.result?.telemetry && (
                      <div className="mt-2 pt-2 border-t border-zinc-800/70 flex gap-4 text-[10px] text-zinc-400 font-mono">
                        <span>
                          simFPS: {String((entry.result.telemetry as any).simFpsEstimate ?? '—')}
                        </span>
                        <span>draws: {String((entry.result.telemetry as any).drawCallEstimate ?? '—')}</span>
                        <span>heap: {String((entry.result.telemetry as any).memoryHeapMb ?? '—')}MB</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: persistent memory */}
        <div className="w-80 overflow-y-auto p-3 space-y-3 bg-[#1b1b1e]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Persistent Memory (ADRs)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-300 bg-purple-500/10">
              SQLite
            </span>
          </div>
          {(response?.adrs || []).length === 0 ? (
            <div className="bg-[#202023] border border-dashed border-zinc-700 rounded-lg p-4 text-center text-zinc-500">
              <FileText className="w-4 h-4 mx-auto mb-1.5 text-zinc-600" />
              No ADRs recorded yet.
            </div>
          ) : (
            (response?.adrs || []).slice(0, 8).map(adr => (
              <div key={adr.id} className="bg-[#202023] border border-zinc-800 rounded-lg p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-purple-300 truncate">{adr.id}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {adr.status}
                  </span>
                </div>
                <div className="font-medium text-zinc-200 text-[11px] leading-snug">{adr.title}</div>
                <div className="text-[10px] text-zinc-500 leading-snug">{adr.rationale}</div>
              </div>
            ))
          )}

          <div className="flex items-center gap-1.5 pt-1">
            <Activity className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Latest QA Benchmarks</span>
          </div>
          {(response?.latest_qa || []).length === 0 ? (
            <div className="text-[10px] text-zinc-500">No QA runs recorded yet.</div>
          ) : (
            (response?.latest_qa || []).map(qa => (
              <div key={qa.id} className="bg-[#202023] border border-zinc-800 rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-400">#{qa.id}</span>
                  <StatusBadge status={qa.verdict.toLowerCase() === 'succeeded' ? 'passed' : qa.verdict.toLowerCase()} />
                </div>
                <div className="text-[10px] text-zinc-500 truncate">{qa.goal}</div>
                <div className="flex gap-3 text-[10px] text-zinc-400 font-mono">
                  <span>fps {Math.round(qa.fps_average)}</span>
                  <span>draws {qa.draw_calls}</span>
                  <span>heap {qa.heap_mb}MB</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
