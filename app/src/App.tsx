import React from 'react';
import { StudioProvider } from './state/StudioState';
import { DockviewWorkspace } from './components/DockviewWorkspace';
import { GameView } from './components/GameView';

const StudioContent: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-gray-200 select-none overflow-hidden font-sans">
      <DockviewWorkspace />
    </div>
  );
};

/** `?play=1` boots straight into the playable arena (used by the Android container). */
const isGameMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('play') === '1';
};

export const App: React.FC = () => {
  if (isGameMode()) {
    return <GameView />;
  }
  return (
    <StudioProvider>
      <StudioContent />
    </StudioProvider>
  );
};

export default App;
