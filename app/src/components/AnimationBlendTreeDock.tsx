import React, { useState, useEffect } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Activity,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Sliders,
  Palette,
  Layers,
  Zap,
  Film,
  Move
} from 'lucide-react';
import { ModelRenderer, AnimFSM, TimelineLite } from '@heretek/engine';

export const AnimationBlendTreeDock: React.FC = () => {
  const { scene, selectedGameObject, refreshScene, addLog, isPlaying } = useStudio();

  // Locomotion blend state
  const [blendWeight, setBlendWeight] = useState(0.0); // 0 = Idle, 0.5 = Walk, 1.0 = Run
  const [isPlayingAnim, setIsPlayingAnim] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [crossFadeDuration, setCrossFadeDuration] = useState(0.25);

  // Cel-shader tuning state
  const [celBands, setCelBands] = useState(3);
  const [outlineThickness, setOutlineThickness] = useState(0.025);
  const [outlineColor, setOutlineColor] = useState('#1e1b4b');
  const [rimPower, setRimPower] = useState(3.0);
  const [rimColor, setRimColor] = useState('#60a5fa');

  // Check if selected object has ModelRenderer
  const modelRenderer = selectedGameObject?.getComponent(ModelRenderer) || null;
  const animFsm = selectedGameObject?.getComponent(AnimFSM) || null;
  const timeline = selectedGameObject?.getComponent(TimelineLite) || null;

  // Live readouts: re-render twice a second during play.
  const [, setLiveTick] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setLiveTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [isPlaying]);
  const availableAnimations = modelRenderer 
    ? Array.from(modelRenderer.animations.keys())
    : ['Idle', 'Walk_Forward', 'Run_Forward', 'Jump_Up', 'Attack_Slash', 'Hit_Reaction'];

  const handlePlayAnimation = (animName: string) => {
    if (modelRenderer) {
      modelRenderer.playAnimation(animName, crossFadeDuration);
      addLog('info', 'AnimationMixer', `Cross-fading into animation "${animName}" (${crossFadeDuration}s).`);
      refreshScene();
    } else {
      addLog('info', 'AnimationMixer', `Previewing simulated clip "${animName}" on ${selectedGameObject?.name || 'Selected Entity'}.`);
    }
  };

  const handleApplyCelShader = () => {
    addLog(
      'info',
      'AnimeCelShader',
      `Applied Genshin Anime Cel Shader to "${selectedGameObject?.name || 'Target'}": ${celBands} bands, rim power ${rimPower}, outline width ${outlineThickness}.`
    );
  };

  const handleAttachDemoFsm = () => {
    if (!selectedGameObject || animFsm) return;
    selectedGameObject.addComponent(new AnimFSM({
      states: {
        Idle: { clip: 'idle', clipLength: 2.0 },
        Run: { clip: 'run', clipLength: 1.0 }
      },
      initial: 'Idle',
      transitions: [
        { from: 'Idle', to: 'Run', conditions: [{ param: 'speed', op: '>', value: 0.5 }] },
        { from: 'Run', to: 'Idle', conditions: [{ param: 'speed', op: '<=', value: 0.5 }] }
      ]
    }));
    addLog('info', 'AnimFSM', `Attached Idle/Run state machine to "${selectedGameObject.name}".`);
    refreshScene();
  };

  const handleAttachDemoTimeline = () => {
    if (!selectedGameObject || timeline) return;
    selectedGameObject.addComponent(new TimelineLite({
      duration: 4,
      tracks: [{
        target: selectedGameObject.name,
        clips: [
          { id: 'demo-move', start: 0.5, dur: 2, type: 'move', data: { to: [4, 1, 0] } },
          { id: 'demo-done', start: 3.5, type: 'event', data: { name: 'demo-finale' } }
        ]
      }]
    }));
    addLog('info', 'Timeline', `Attached 4s demo timeline to "${selectedGameObject.name}".`);
    refreshScene();
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-gray-200 select-none overflow-y-auto font-sans p-3 space-y-4">
      {/* Header Banner */}
      <div className="p-3 bg-gradient-to-r from-purple-950/40 via-zinc-900 to-zinc-900 border border-purple-500/30 rounded-lg flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Film className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-bold text-purple-300">Animation Blend Tree & Cel-Shading Studio</h3>
          </div>
          <p className="text-xs text-zinc-400">
            Real-time skeletal locomotion blending and AAA Genshin Impact anime cel-shading inspector.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs px-2.5 py-1 bg-zinc-900 border border-zinc-700 rounded font-mono text-zinc-300">
            Target: {selectedGameObject?.name || 'No Entity Selected'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Section 1: Locomotion Blend Tree */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300">
              <Move className="w-3.5 h-3.5 text-blue-400" />
              <span>1D Locomotion Blend Space (Speed)</span>
            </div>
            <span className="text-xs font-mono text-blue-400">
              {blendWeight < 0.2 ? 'Idle' : blendWeight < 0.7 ? 'Walk' : 'Run / Sprint'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {/* Blend Slider */}
            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Locomotion Velocity</span>
                <span className="font-mono text-zinc-200">{(blendWeight * 10).toFixed(1)} m/s</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={blendWeight}
                onChange={e => setBlendWeight(Number(e.target.value))}
                className="w-full accent-blue-500 h-1.5 bg-zinc-700 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
                <span>0.0 (Idle)</span>
                <span>0.5 (Walk)</span>
                <span>1.0 (Sprint)</span>
              </div>
            </div>

            {/* Playback Controls */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800">
              <div>
                <span className="text-zinc-400 block mb-1">Playback Speed</span>
                <input
                  type="range"
                  min={0.25}
                  max={2.0}
                  step={0.05}
                  value={playbackSpeed}
                  onChange={e => setPlaybackSpeed(Number(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-zinc-700 rounded"
                />
                <span className="text-[10px] font-mono text-zinc-400">{playbackSpeed.toFixed(2)}x</span>
              </div>

              <div>
                <span className="text-zinc-400 block mb-1">Cross-Fade (s)</span>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={crossFadeDuration}
                  onChange={e => setCrossFadeDuration(Number(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-zinc-700 rounded"
                />
                <span className="text-[10px] font-mono text-zinc-400">{crossFadeDuration.toFixed(2)}s</span>
              </div>
            </div>

            {/* Clip Selector Buttons */}
            <div>
              <span className="text-zinc-400 block mb-1.5 font-medium">Loaded Animation Clips:</span>
              <div className="flex flex-wrap gap-1.5">
                {availableAnimations.map(anim => (
                  <button
                    key={anim}
                    onClick={() => handlePlayAnimation(anim)}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 hover:border-blue-500 border border-zinc-750 text-zinc-200 rounded text-xs transition-colors flex items-center space-x-1"
                  >
                    <Play className="w-2.5 h-2.5 text-emerald-400" />
                    <span>{anim}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Anime Cel-Shading Inspector */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300">
              <Palette className="w-3.5 h-3.5 text-pink-400" />
              <span>Genshin Impact Anime Cel-Shader</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 bg-pink-950/60 border border-pink-500/30 text-pink-300 rounded font-mono">
              Custom GLSL
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Diffuse Quantization Bands</span>
                <span className="font-mono text-zinc-200">{celBands} Bands</span>
              </div>
              <input
                type="range"
                min={2}
                max={5}
                step={1}
                value={celBands}
                onChange={e => setCelBands(Number(e.target.value))}
                className="w-full accent-pink-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Inverted-Hull Outline Width</span>
                <span className="font-mono text-zinc-200">{(outlineThickness * 100).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0.005}
                max={0.06}
                step={0.005}
                value={outlineThickness}
                onChange={e => setOutlineThickness(Number(e.target.value))}
                className="w-full accent-pink-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Fresnel Rim Light Power</span>
                <span className="font-mono text-zinc-200">{rimPower.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1.0}
                max={8.0}
                step={0.5}
                value={rimPower}
                onChange={e => setRimPower(Number(e.target.value))}
                className="w-full accent-pink-500 h-1 bg-zinc-700 rounded cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-zinc-400 block mb-1">Outline Color</span>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={outlineColor}
                    onChange={e => setOutlineColor(e.target.value)}
                    className="w-6 h-6 rounded bg-transparent cursor-pointer border border-zinc-700"
                  />
                  <span className="font-mono text-[10px] text-zinc-300">{outlineColor}</span>
                </div>
              </div>

              <div>
                <span className="text-zinc-400 block mb-1">Rim Glow Tint</span>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={rimColor}
                    onChange={e => setRimColor(e.target.value)}
                    className="w-6 h-6 rounded bg-transparent cursor-pointer border border-zinc-700"
                  />
                  <span className="font-mono text-[10px] text-zinc-300">{rimColor}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleApplyCelShader}
              className="mt-2 w-full py-1.5 bg-pink-600 hover:bg-pink-500 text-white rounded text-xs font-semibold shadow transition-colors flex items-center justify-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Apply Cel-Shader to Selected Mesh</span>
            </button>
          </div>
        </div>

        {/* Section 3: Animation State Machine */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Animation State Machine</span>
            </div>
            {animFsm && (
              <span className="font-mono text-[11px] px-1.5 py-0.5 bg-amber-950/60 border border-amber-500/30 text-amber-300 rounded">
                {animFsm.current || '—'}
              </span>
            )}
          </div>

          {!animFsm ? (
            <button
              onClick={handleAttachDemoFsm}
              disabled={!selectedGameObject}
              className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-200 rounded text-xs transition-colors"
            >
              Attach Idle/Run FSM to selection
            </button>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-zinc-400">
                <span>State time</span>
                <span className="font-mono text-zinc-200">{animFsm.stateTime.toFixed(2)}s</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Transitions taken</span>
                <span className="font-mono text-zinc-200">{animFsm.transitionsTaken}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>States</span>
                <span className="font-mono text-zinc-200">{Object.keys(animFsm.states).join(' → ')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Speed param</span>
                <input
                  type="number"
                  step="0.5"
                  value={animFsm.getFloat('speed')}
                  onChange={(e) => { animFsm.setFloat('speed', parseFloat(e.target.value) || 0); refreshScene(); }}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.keys(animFsm.states).map(name => (
                  <button
                    key={name}
                    onClick={() => { animFsm.setFloat('speed', name === 'Idle' ? 0 : 3); refreshScene(); }}
                    className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] transition-colors"
                  >
                    Drive: {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Timeline-lite Cutscene */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300">
              <Film className="w-3.5 h-3.5 text-cyan-400" />
              <span>Timeline-lite Cutscene</span>
            </div>
            {timeline && (
              <span className="font-mono text-[11px] px-1.5 py-0.5 bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 rounded">
                {timeline.time.toFixed(1)}s / {timeline.duration}s{timeline.finished ? ' ✓' : ''}
              </span>
            )}
          </div>

          {!timeline ? (
            <button
              onClick={handleAttachDemoTimeline}
              disabled={!selectedGameObject}
              className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-200 rounded text-xs transition-colors"
            >
              Attach 4s demo timeline to selection
            </button>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Tracks / clips</span>
                <span className="font-mono text-zinc-200">
                  {timeline.tracks.length} / {timeline.tracks.reduce((n, t) => n + t.clips.length, 0)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => { timeline.playing ? timeline.pause() : timeline.play(); refreshScene(); }}
                  className="py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] transition-colors flex items-center justify-center space-x-1"
                >
                  {timeline.playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{timeline.playing ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  onClick={() => { timeline.restart(); refreshScene(); }}
                  className="py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] transition-colors flex items-center justify-center space-x-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restart</span>
                </button>
                <button
                  onClick={() => { timeline.seek(0); refreshScene(); }}
                  className="py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] transition-colors"
                >
                  Rewind
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
