import React from 'react';
import { StudioProvider } from './state/StudioState';
import { DockviewWorkspace } from './components/DockviewWorkspace';

const StudioContent: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-gray-200 select-none overflow-hidden font-sans">
      <DockviewWorkspace />
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
