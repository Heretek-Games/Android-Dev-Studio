import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../state/StudioState';
import type { WorkspacePreset } from './DockviewWorkspace';

/**
 * Command palette (Track D.1, Ctrl+K): fuzzy-filtered categorized commands —
 * layout presets, gizmo modes, play controls, entity jump, external docs.
 * VS Code pattern: category prefixes, keyboard-first, Esc closes.
 */

export interface PaletteCommand {
  id: string;
  category: string;
  label: string;
  hint?: string;
  run: () => void;
}

function fuzzyScore(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  let score = 0;
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi);
    if (found === -1) return -1;
    if (found === hi) score += 2;
    else score += 1;
    hi = found + 1;
  }
  return score;
}

export const CommandPalette: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelectPreset: (preset: WorkspacePreset) => void;
}> = ({ open, onClose, onSelectPreset }) => {
  const {
    scene,
    setSelectedId,
    gizmoMode,
    setGizmoMode,
    isPlaying,
    startPlayMode,
    stopPlayMode
  } = useStudio();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: PaletteCommand[] = useMemo(() => {
    const list: PaletteCommand[] = [
      { id: 'layout-default', category: 'Layout', label: 'Default workspace', run: () => onSelectPreset('default') },
      { id: 'layout-level', category: 'Layout', label: 'Level design workspace', run: () => onSelectPreset('level_design') },
      { id: 'layout-script', category: 'Layout', label: 'Visual scripting workspace', run: () => onSelectPreset('visual_scripting') },
      { id: 'layout-swarm', category: 'Layout', label: 'AI swarm workspace', run: () => onSelectPreset('ai_swarm') },
      { id: 'layout-qa', category: 'Layout', label: 'Mobile QA workspace', run: () => onSelectPreset('mobile_qa') },
      { id: 'gizmo-translate', category: 'Gizmo', label: `Translate mode${gizmoMode === 'translate' ? ' (active)' : ''}`, run: () => setGizmoMode('translate') },
      { id: 'gizmo-rotate', category: 'Gizmo', label: `Rotate mode${gizmoMode === 'rotate' ? ' (active)' : ''}`, run: () => setGizmoMode('rotate') },
      { id: 'gizmo-scale', category: 'Gizmo', label: `Scale mode${gizmoMode === 'scale' ? ' (active)' : ''}`, run: () => setGizmoMode('scale') },
      isPlaying
        ? { id: 'play-stop', category: 'Play', label: 'Stop play mode', run: () => stopPlayMode() }
        : { id: 'play-start', category: 'Play', label: 'Start play mode', run: () => startPlayMode() },
      ...(scene?.gameObjects ?? []).slice(0, 200).map(go => ({
        id: `select-${go.id}`,
        category: 'Select',
        label: go.name,
        hint: go.id,
        run: () => setSelectedId(go.id)
      })),
      { id: 'docs-engine', category: 'Docs', label: 'Open engine parity program', run: () => window.open('https://github.com/Heretek-Games/Android-Dev-Studio', '_blank') }
    ];
    return list;
  }, [scene, gizmoMode, isPlaying, onSelectPreset, setGizmoMode, setSelectedId, startPlayMode, stopPlayMode]);

  const results = useMemo(() => {
    const scored = commands
      .map(cmd => ({ cmd, score: Math.max(fuzzyScore(cmd.label, query), fuzzyScore(`${cmd.category} ${cmd.label}`, query)) }))
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 12).map(entry => entry.cmd);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open ]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const choose = (cmd: PaletteCommand) => {
    onClose();
    cmd.run();
  };

  return (
    <div
      data-testid="command-palette"
      className="absolute inset-0 z-[100] flex justify-center pt-24 bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[480px] max-h-[380px] flex flex-col bg-studio-surface border border-studio-border rounded-lg shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter' && results[cursor]) choose(results[cursor]);
          }}
          placeholder="Type a command, entity, or layout…"
          className="px-4 py-3 bg-transparent text-sm text-white placeholder-zinc-500 outline-none border-b border-studio-border font-mono"
        />
        <div className="overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">No matching commands.</div>
          )}
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(cmd)}
              className={`w-full flex items-center space-x-2 px-4 py-1.5 text-left text-xs ${
                i === cursor ? 'bg-blue-600/30 text-white' : 'text-zinc-300'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 w-14 shrink-0">{cmd.category}</span>
              <span className="truncate">{cmd.label}</span>
              {cmd.hint && <span className="ml-auto font-mono text-[10px] text-zinc-600 truncate">{cmd.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
