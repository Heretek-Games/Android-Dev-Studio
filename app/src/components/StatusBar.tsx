import React from 'react';
import { useStudio } from '../state/StudioState';

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

  return (
    <footer
      data-testid="studio-status-bar"
      className="flex items-center justify-between h-6 px-3 bg-studio-surface border-t border-studio-border text-[11px] font-mono text-zinc-400 select-none shrink-0"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <span className="flex items-center space-x-1.5 truncate" title="Active scene">
          <span className={`w-1.5 h-1.5 rounded-full ${canUndo ? 'bg-amber-400' : 'bg-emerald-500'}`} />
          <span className="text-zinc-200 truncate">{scene?.name ?? 'Scene'}</span>
          <span className="text-zinc-500">{objectCount} objects</span>
        </span>
        <span
          className={artemisRunning ? 'text-emerald-300' : 'text-zinc-500'}
          title="Agent activity (D.2 live feed)"
        >
          {artemisRunning ? '● Artemis QA running' : '○ agents idle'}
        </span>
        {isPlaying && <span className="text-blue-300">▶ playing</span>}
      </div>
      <div className="flex items-center space-x-3 shrink-0">
        {selectedGameObject && (
          <span className="text-zinc-300 truncate max-w-[220px]" title="Selection">
            {selectedGameObject.name}
          </span>
        )}
        <span title="Viewport camera">
          cam ({cameraPosition.x.toFixed(0)}, {cameraPosition.y.toFixed(0)}, {cameraPosition.z.toFixed(0)})
        </span>
        <span title="Device">{device ? device.model ?? device.id : 'no device'}</span>
        <span title="Viewport FPS" className="text-zinc-200">
          {viewportFps > 0 ? `${viewportFps} FPS` : '— FPS'}
        </span>
      </div>
    </footer>
  );
};
