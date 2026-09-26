import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';

interface FeedIteration {
  iteration: number;
  phase: string;
  applied: number;
  gate: string;
  qa: string;
  qaScore: string | null;
  visual: string | null;
  spatial: string | null;
  hasDiff: boolean;
  hasFrame: boolean;
}

interface FeedRun {
  file: string;
  goal: string;
  verdict: string;
  totalTokens: number;
  iterations: FeedIteration[];
}

/**
 * Studio status bar (Track D.1): persistent bottom strip in the VS Code
 * pattern — left items are workspace-scoped, right items selection-scoped.
 * Agent activity slot is reserved for the D.2 live feed.
 */
export const StatusBar: React.FC = () => {
  const {
    scene,
    canUndo,
    devices,
    selectedDevice,
    selectedGameObject,
    isPlaying,
    artemisRunning,
    viewportFps,
    cameraPosition
  } = useStudio();

  const device = devices.find(d => d.id === selectedDevice) || devices[0] || null;
  const objectCount = scene?.gameObjects?.length ?? 0;

  // D.2 activity feed (user-expand gated; fetched on open, never polled).
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedRuns, setFeedRuns] = useState<FeedRun[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);

  const toggleFeed = async () => {
    if (feedOpen) {
      setFeedOpen(false);
      return;
    }
    setFeedOpen(true);
    setFeedError(null);
    try {
      const res = await fetch('/api/loop/feed');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFeedRuns(data.runs ?? []);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      {feedOpen && (
        <div
          data-testid="agent-feed"
          className="absolute bottom-6 left-0 w-[420px] max-h-[300px] overflow-y-auto bg-studio-surface border border-studio-border rounded-t-lg shadow-2xl p-3 space-y-2 text-[11px] font-mono"
        >
          <div className="text-studio-muted uppercase tracking-wider text-[10px]">
            Agent activity — newest loop runs first
          </div>
          {feedError && <div className="text-studio-danger">Feed unavailable: {feedError}</div>}
          {!feedError && feedRuns.length === 0 && (
            <div className="text-studio-faint">No loop runs recorded yet.</div>
          )}
          {feedRuns.map(run => (
            <div key={run.file} className="border border-studio-border rounded-md p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-studio-text truncate">{run.goal}</span>
                <span className={run.verdict === 'green' ? 'text-studio-success' : 'text-studio-warning'}>
                  {run.verdict}
                </span>
              </div>
              <div className="text-studio-faint">
                {run.file} · {run.totalTokens} tokens
              </div>
              {run.iterations.map(it => (
                <div key={it.iteration} className="text-studio-muted">
                  #{it.iteration} {it.phase} · +{it.applied} · gate {it.gate} · QA {it.qa}
                  {it.qaScore ? ` ${it.qaScore}` : ''}
                  {it.visual ? ` · vis ${it.visual}` : ''}
                  {it.spatial ? ` · spat ${it.spatial}` : ''}
                  {it.hasDiff ? ' · Δ' : ''}
                  {it.hasFrame ? ' · ▣' : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    <footer
      data-testid="studio-status-bar"
      className="flex items-center justify-between h-6 px-3 bg-studio-surface border-t border-studio-border text-[11px] font-mono text-studio-muted select-none shrink-0"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <span className="flex items-center space-x-1.5 truncate" title="Active scene">
          <span className={`w-1.5 h-1.5 rounded-full ${canUndo ? 'bg-studio-warning' : 'bg-studio-success'}`} />
          <span className="text-studio-text truncate">{scene?.name ?? 'Scene'}</span>
          <span>{objectCount} objects</span>
        </span>
        <button
          onClick={toggleFeed}
          className={artemisRunning ? 'text-studio-success' : undefined}
          title="Agent activity feed — click to expand (D.2)"
        >
          {artemisRunning ? '● Artemis QA running' : '○ agents idle'}
        </button>
        {isPlaying && <span className="text-studio-accent">▶ playing</span>}
      </div>
      <div className="flex items-center space-x-3 shrink-0">
        {selectedGameObject && (
          <span className="text-studio-text truncate max-w-[220px]" title="Selection">
            {selectedGameObject.name}
          </span>
        )}
        <span title="Viewport camera">
          cam ({cameraPosition.x.toFixed(0)}, {cameraPosition.y.toFixed(0)}, {cameraPosition.z.toFixed(0)})
        </span>
        <span title="Device">{device ? device.model ?? device.id : 'no device'}</span>
        <span title="Viewport FPS" className="text-studio-text">
          {viewportFps > 0 ? `${viewportFps} FPS` : '— FPS'}
        </span>
      </div>
    </footer>
    </>
  );
};
