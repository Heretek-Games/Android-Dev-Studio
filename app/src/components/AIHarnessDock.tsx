import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Sparkles,
  Send,
  Bot,
  Zap,
  CheckCircle,
  Cpu,
  Layers,
  Wand2,
  Brain,
  ShieldAlert,
  Activity,
  ShoppingBag
} from 'lucide-react';
import { AiHarnessService } from '../services/AiHarnessService';

export const AIHarnessDock: React.FC = () => {
  const { scene, refreshScene, addLog } = useStudio();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Array<{
    sender: 'user' | 'ai';
    text: string;
    reasoning?: string;
    details?: string[];
    isSelfHealed?: boolean;
  }>>([
    {
      sender: 'ai',
      text: 'Hello! I am your 3D Android Studio AI Copilot. Ask me to construct 3D environments, wire visual game logic, optimize mobile touch controls, or self-heal runtime errors.',
      details: [
        'Engine: Three.js PBR + Rapier3D WASM physics',
        'Target: Android 14 / WebGL2 / Hardware WebView',
        'CC0 Asset Store: GDevelop, Quaternius & Kenney integrated',
        'Model: mimotp/mimo-v2.6-flash & Studio MCP'
      ]
    }
  ]);

  const handleGenerate = async (queryText?: string) => {
    const q = queryText || prompt;
    if (!q.trim() || isGenerating) return;

    setPrompt('');
    setStreamingReasoning('');
    setChatHistory(prev => [...prev, { sender: 'user', text: q }]);
    setIsGenerating(true);
    addLog('ai', 'AI Harness', `Calling LLM for prompt: "${q}"`);

    try {
      const result = await AiHarnessService.getInstance().generateWorld(
        q,
        scene,
        (progress) => {
          if (progress.accumulatedReasoning) {
            setStreamingReasoning(progress.accumulatedReasoning);
          }
        }
      );
      refreshScene();

      setChatHistory(prev => [
        ...prev,
        {
          sender: 'ai',
          text: result.summary,
          reasoning: result.reasoning || streamingReasoning,
          details: result.actionsApplied
        }
      ]);
      addLog('ai', 'AI Harness', `Scene updated: ${result.actionsApplied.join(', ') || 'No scene mutations'}`);
    } catch (err: any) {
      addLog('error', 'AI Harness', `Generation failed: ${err.message}`);
      setChatHistory(prev => [
        ...prev,
        {
          sender: 'ai',
          text: `Error during generation: ${err.message}`,
          details: ['Fallback mode engaged']
        }
      ]);
    } finally {
      setIsGenerating(false);
      setStreamingReasoning('');
    }
  };

  const handleSelfHealScene = async () => {
    setIsGenerating(true);
    addLog('ai', 'AI Harness', 'Running autonomous scene stability & physics collision audit...');

    try {
      const result = await AiHarnessService.getInstance().selfHeal(
        { error: 'Proactive Audit: Check physics bounds, ground clipping, and lighting intensity', source: 'Inspector' },
        scene
      );
      refreshScene();

      setChatHistory(prev => [
        ...prev,
        {
          sender: 'ai',
          text: result.summary,
          reasoning: result.reasoning,
          details: result.actionsApplied,
          isSelfHealed: true
        }
      ]);
    } catch (err: any) {
      addLog('error', 'AI Harness', `Self-heal failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-t border-studio-border">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-gray-200 uppercase tracking-wide">
            Studio AI Copilot (Natural Language Scene & Logic Harness)
          </span>
        </div>
        <div className="flex items-center space-x-2 text-[11px] text-gray-400 font-mono">
          <Cpu className="w-3 h-3 text-purple-400" />
          <span>mimo-v2.6-flash & Studio MCP</span>
        </div>
      </div>

      {/* Quick Action Suggestion Chips */}
      <div className="flex items-center space-x-2 p-2 bg-zinc-900/60 border-b border-studio-border overflow-x-auto text-[11px]">
        <button
          onClick={() => handleGenerate('Generate an obstacle course with pillars and jumping pads')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-studio-border whitespace-nowrap transition-colors"
        >
          <Wand2 className="w-3 h-3 text-red-400" />
          <span>Add Obstacle Arena</span>
        </button>
        <button
          onClick={() => handleGenerate('Spawn 3 spinning gold coins with Idle Spin events')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-studio-border whitespace-nowrap transition-colors"
        >
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span>Spawn Collectible Coins</span>
        </button>
        <button
          onClick={() => handleGenerate('Add a floating island platform')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-studio-border whitespace-nowrap transition-colors"
        >
          <Layers className="w-3 h-3 text-emerald-400" />
          <span>Add Floating Platform</span>
        </button>
        <button
          onClick={() => handleGenerate('Change to warm sunset lighting with high-contrast shadows')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-studio-border whitespace-nowrap transition-colors"
        >
          <Zap className="w-3 h-3 text-orange-400" />
          <span>Sunset Lighting</span>
        </button>
        <button
          onClick={handleSelfHealScene}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-purple-900/40 hover:bg-purple-900/60 text-purple-300 border border-purple-500/40 whitespace-nowrap transition-colors"
        >
          <ShieldAlert className="w-3 h-3 text-purple-400" />
          <span>Audit & Self-Heal</span>
        </button>
      </div>

      {/* Chat / Generation Logs */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {chatHistory.map((item, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${item.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg p-2.5 text-xs ${
                item.sender === 'user'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-900 border border-studio-border text-gray-200 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between space-x-1.5 mb-1 font-semibold text-[11px] text-gray-400">
                <div className="flex items-center space-x-1.5">
                  {item.sender === 'user' ? <span>You</span> : <Bot className="w-3 h-3 text-purple-400" />}
                  {item.sender === 'ai' && <span>AI Copilot</span>}
                </div>
                {item.isSelfHealed && (
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/30">
                    Self-Healed
                  </span>
                )}
              </div>

              {item.reasoning && (
                <details className="mb-2 p-2 rounded bg-zinc-950/80 border border-purple-500/20 text-[11px] text-purple-300">
                  <summary className="cursor-pointer font-mono text-purple-400 font-medium select-none flex items-center space-x-1.5 hover:text-purple-300">
                    <Brain className="w-3 h-3 text-purple-400" />
                    <span>Thinking Process ({item.reasoning.length} chars)</span>
                  </summary>
                  <div className="mt-2 text-xs font-sans text-gray-300 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border-t border-purple-500/10 pt-2">
                    {item.reasoning}
                  </div>
                </details>
              )}

              <p className="leading-relaxed">{item.text}</p>

              {item.details && item.details.length > 0 && (
                <div className="mt-2 pt-2 border-t border-studio-border/60 space-y-1">
                  {item.details.map((d, dIdx) => (
                    <div key={dIdx} className="flex items-center space-x-1.5 text-[11px] text-emerald-400">
                      <CheckCircle className="w-3 h-3 shrink-0" />
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="space-y-2 max-w-md">
            <div className="flex items-center space-x-2 text-xs text-purple-400 p-2 bg-purple-500/10 rounded border border-purple-500/20">
              <Sparkles className="w-4 h-4 animate-spin text-purple-400" />
              <span>Analyzing scene graph, generating components & wiring physics...</span>
            </div>
            {streamingReasoning && (
              <div className="p-2.5 rounded bg-zinc-950/90 border border-purple-500/30 text-[11px] font-mono text-purple-300 space-y-1">
                <div className="flex items-center space-x-1.5 text-purple-400 font-semibold">
                  <Brain className="w-3 h-3 animate-pulse" />
                  <span>Streaming Reasoning Trace:</span>
                </div>
                <div className="max-h-28 overflow-y-auto text-gray-300 text-[10px] leading-relaxed">
                  {streamingReasoning}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Prompt Dock */}
      <div className="p-3 border-t border-studio-border bg-studio-bg/60">
        <form
          onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            placeholder="Describe what to build or change (e.g. 'Add 3 floating bounce pads and make player jump higher')..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            className="flex-1 bg-zinc-900 border border-studio-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
          />
          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-purple-600/30 transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Generate</span>
          </button>
        </form>
      </div>
    </div>
  );
};
