import React, { useState } from 'react';
import { useStudio, StudioLog } from '../state/StudioState';
import {
  Terminal,
  Trash2,
  Info,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Filter,
  Wand2,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { AiHarnessService } from '../services/AiHarnessService';

export const ConsoleDock: React.FC = () => {
  const { logs, clearLogs, scene, refreshScene, addLog } = useStudio();
  const [filter, setFilter] = useState<'all' | 'error' | 'ai'>('all');
  const [healingLogId, setHealingLogId] = useState<string | null>(null);

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'error') return log.level === 'error';
    if (filter === 'ai') return log.level === 'ai';
    return true;
  });

  const errorLogs = logs.filter(l => l.level === 'error');

  const handleSelfHeal = async (logItem: StudioLog) => {
    setHealingLogId(logItem.id);
    addLog('ai', 'Self-Healing', `Initiating autonomous diagnosis for error: "${logItem.message.slice(0, 60)}..."`);

    try {
      const result = await AiHarnessService.getInstance().selfHeal(
        { error: logItem.message, source: logItem.source },
        scene
      );
      refreshScene();
      addLog('ai', 'Self-Healing', `Diagnosis & Resolution applied: ${result.summary}`);
      if (result.actionsApplied.length > 0) {
        addLog('info', 'Self-Healing', `Restored entities: ${result.actionsApplied.join('; ')}`);
      }
    } catch (err: any) {
      addLog('error', 'Self-Healing', `Failed to auto-heal: ${err.message}`);
    } finally {
      setHealingLogId(null);
    }
  };

  const getBadge = (level: StudioLog['level']) => {
    switch (level) {
      case 'error':
        return <span className="text-red-400 bg-red-500/10 px-1 rounded border border-red-500/20 font-bold shrink-0">ERR</span>;
      case 'warn':
        return <span className="text-amber-400 bg-amber-500/10 px-1 rounded border border-amber-500/20 font-bold shrink-0">WARN</span>;
      case 'ai':
        return <span className="text-purple-400 bg-purple-500/10 px-1 rounded border border-purple-500/20 font-bold shrink-0">AI</span>;
      case 'info':
      default:
        return <span className="text-blue-400 bg-blue-500/10 px-1 rounded border border-blue-500/20 font-bold shrink-0">INFO</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <Terminal className="w-3.5 h-3.5 text-gray-400" />
          <span className="font-semibold text-gray-300">Console & Logcat Diagnostics</span>
          <span className="text-[10px] text-gray-500">({filteredLogs.length} events)</span>
          {errorLogs.length > 0 && (
            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.2 rounded border border-red-500/30">
              {errorLogs.length} error{errorLogs.length > 1 ? 's' : ''} detected
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {errorLogs.length > 0 && (
            <button
              onClick={() => handleSelfHeal(errorLogs[errorLogs.length - 1])}
              disabled={healingLogId !== null}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 text-[11px] transition-colors"
            >
              {healingLogId ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-purple-400" />
                  <span>Healing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  <span>⚡ AI Self-Heal</span>
                </>
              )}
            </button>
          )}

          <div className="flex items-center bg-zinc-900 border border-studio-border rounded p-0.5 text-[11px]">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded transition-colors ${filter === 'all' ? 'bg-zinc-800 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('ai')}
              className={`px-2 py-0.5 rounded transition-colors ${filter === 'ai' ? 'bg-purple-600/30 text-purple-300 font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              AI Harness
            </button>
            <button
              onClick={() => setFilter('error')}
              className={`px-2 py-0.5 rounded transition-colors ${filter === 'error' ? 'bg-red-600/30 text-red-300 font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              Errors
            </button>
          </div>

          <button
            onClick={clearLogs}
            title="Clear logs"
            className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log Stream */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredLogs.length === 0 ? (
          <div className="text-gray-600 py-4 text-center">No log messages to display.</div>
        ) : (
          filteredLogs.map(l => (
            <div
              key={l.id}
              className={`flex items-start justify-between py-1 px-1.5 rounded transition-colors ${
                l.level === 'error'
                  ? 'bg-red-950/20 border border-red-900/30'
                  : l.level === 'ai'
                  ? 'bg-purple-950/20 border border-purple-900/20'
                  : 'hover:bg-zinc-900/60'
              }`}
            >
              <div className="flex items-start space-x-2 flex-1 min-w-0">
                <span className="text-gray-500 text-[10px] shrink-0 pt-0.5">{l.timestamp}</span>
                {getBadge(l.level)}
                <span className="text-gray-400 text-[11px] font-semibold shrink-0">[{l.source}]</span>
                <span className={`text-[11px] break-all ${l.level === 'error' ? 'text-red-300' : l.level === 'ai' ? 'text-purple-200' : 'text-gray-200'}`}>
                  {l.message}
                </span>
              </div>

              {l.level === 'error' && (
                <button
                  onClick={() => handleSelfHeal(l)}
                  disabled={healingLogId === l.id}
                  className="ml-2 px-1.5 py-0.5 rounded bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 text-[10px] flex items-center space-x-1 shrink-0 transition-colors"
                  title="Diagnose and patch error with LLM reasoning"
                >
                  {healingLogId === l.id ? (
                    <RefreshCw className="w-3 h-3 animate-spin text-purple-400" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-purple-400" />
                  )}
                  <span>Auto-Heal</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
