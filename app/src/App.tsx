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

/**
 * `?play=1` boots the arena, `?play=driving` the driving slice (the container and
 * the studio header use these to jump straight into a playable game).
 */
const isGameMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const play = new URLSearchParams(window.location.search).get('play');
  return play !== null && play !== '';
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
