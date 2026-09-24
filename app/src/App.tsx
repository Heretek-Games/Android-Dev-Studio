import React from 'react';
import { StudioProvider } from './state/StudioState';
import { DeviceBar } from './components/DeviceBar';
import { DockviewWorkspace } from './components/DockviewWorkspace';

const StudioContent: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Android Deployment & Device Selection Bar */}
      <DeviceBar />

      {/* Professional Multi-Window Dockable Workspace */}
      <div className="flex-1 w-full h-full overflow-hidden">
        <DockviewWorkspace />
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
