import React, { useState } from 'react';
import { useStudio, StudioLog } from '../state/StudioState';
import {
  Terminal,
  Trash2,
  Info,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Filter
} from 'lucide-react';

export const ConsoleDock: React.FC = () => {
  const { logs, clearLogs } = useStudio();
  const [filter, setFilter] = useState<'all' | 'error' | 'ai'>('all');

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'error') return log.level === 'error';
    if (filter === 'ai') return log.level === 'ai';
    return true;
  });

  const getBadge = (level: StudioLog['level']) => {
    switch (level) {
      case 'error':
        return <span className="text-red-400 bg-red-500/10 px-1 rounded border border-red-500/20 font-bold">ERR</span>;
      case 'warn':
        return <span className="text-amber-400 bg-amber-500/10 px-1 rounded border border-amber-500/20 font-bold">WARN</span>;
      case 'ai':
        return <span className="text-purple-400 bg-purple-500/10 px-1 rounded border border-purple-500/20 font-bold">AI</span>;
      case 'info':
      default:
        return <span className="text-blue-400 bg-blue-500/10 px-1 rounded border border-blue-500/20 font-bold">INFO</span>;
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
        </div>

        <div className="flex items-center space-x-2">
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
              className="flex items-start space-x-2 py-0.5 px-1 hover:bg-zinc-900/60 rounded"
            >
              <span className="text-gray-500 text-[10px] shrink-0">{l.timestamp}</span>
              {getBadge(l.level)}
              <span className="text-gray-400 text-[11px] font-semibold shrink-0">[{l.source}]</span>
              <span className="text-gray-200 text-[11px] break-all">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
