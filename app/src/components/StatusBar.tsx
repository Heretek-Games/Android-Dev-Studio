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
      className="flex items-center justify-between h-6 px-3 bg-studio-surface border-t border-studio-border text-[11px] font-mono text-studio-muted select-none shrink-0"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <span className="flex items-center space-x-1.5 truncate" title="Active scene">
          <span className={`w-1.5 h-1.5 rounded-full ${canUndo ? 'bg-studio-warning' : 'bg-studio-success'}`} />
          <span className="text-studio-text truncate">{scene?.name ?? 'Scene'}</span>
          <span>{objectCount} objects</span>
        </span>
        <span
          className={artemisRunning ? 'text-studio-success' : undefined}
          title="Agent activity (D.2 live feed)"
        >
          {artemisRunning ? '● Artemis QA running' : '○ agents idle'}
        </span>
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
  );
};
