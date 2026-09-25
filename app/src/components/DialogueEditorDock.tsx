import React, { useState } from 'react';
import {
  MessageSquare,
  GitBranch,
  Play,
  Plus,
  Trash2,
  FileCode,
  Save,
  CheckCircle2,
  Sparkles,
  User,
  Zap
} from 'lucide-react';
import { useStudio } from '../state/StudioState';
import { DialogueManager, DialogueTree, DialogueNode } from '@heretek/engine';

const SAMPLE_SCRIPT = `[Tree: MerchantEncounter (Ancient Bazaar Merchant)]
Merchant: Greetings, wanderer! What brings you to our oasis?
- "Show me your rarest artifacts." -> BrowseShop
- "Have you heard any rumors about the dragon?" -> RumorCheck
- "Just passing through." -> Farewell

[Node: BrowseShop]
Merchant: Feast your eyes on these relics from the third era.
-> End

[Node: RumorCheck]
Merchant: They say the dragon sleeps beneath Mount Pyre... but awaken it, and ashes will cover the land.
-> End

[Node: Farewell]
Merchant: Safe travels under the twin moons, traveler.
-> End
`;

export const DialogueEditorDock: React.FC = () => {
  const { addLog } = useStudio();
  const [mode, setMode] = useState<'visual' | 'script' | 'preview'>('visual');
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);

  // Active compiled tree
  const [dialogueTree, setDialogueTree] = useState<DialogueTree>(() => {
    const dm = new DialogueManager();
    return dm.parseScript(SAMPLE_SCRIPT);
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string>(dialogueTree.startNodeId || 'node_0');

  // Preview simulator state
  const [previewNode, setPreviewNode] = useState<DialogueNode | null>(null);
  const [variables, setVariables] = useState<Record<string, any>>({ gold: 100, rep: 5 });

  const handleCompileScript = () => {
    try {
      const dm = new DialogueManager();
      const compiled = dm.parseScript(scriptText);
      setDialogueTree(compiled);
      setSelectedNodeId(compiled.startNodeId);
      addLog('info', 'Dialogue', `Compiled dialogue tree "${compiled.title}" with ${Object.keys(compiled.nodes).length} nodes`);
      setMode('visual');
    } catch (err: any) {
      addLog('error', 'Dialogue', `Dialogue parse error: ${err.message}`);
    }
  };

  const handleStartSim = () => {
    const dm = new DialogueManager();
    dm.registerTree(dialogueTree);
    Object.entries(variables).forEach(([k, v]) => dm.setVariable(k, v));
    const first = dm.startConversation(dialogueTree.id);
    setPreviewNode(first);
    setMode('preview');
  };

  const handleChooseOption = (choiceIndex: number) => {
    if (!previewNode || !previewNode.choices) return;
    const choice = previewNode.choices[choiceIndex];
    if (!choice) return;

    const next = dialogueTree.nodes[choice.nextNodeId];
    setPreviewNode(next || null);
  };

  const handleAdvance = () => {
    if (!previewNode || !previewNode.nextNodeId) {
      setPreviewNode(null);
      return;
    }
    const next = dialogueTree.nodes[previewNode.nextNodeId];
    setPreviewNode(next || null);
  };

  const selectedNode = dialogueTree.nodes[selectedNodeId];

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-zinc-200 select-none text-xs font-sans">
      {/* Top Header */}
      <div className="flex items-center justify-between p-2 bg-[#27272a] border-b border-zinc-700/60">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-zinc-100">{dialogueTree.title}</span>
          <span className="text-[10px] text-zinc-400 font-mono">({Object.keys(dialogueTree.nodes).length} nodes)</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMode('visual')}
            className={`px-2.5 py-1 rounded flex items-center gap-1 transition-all ${
              mode === 'visual' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" /> Visual Nodes
          </button>

          <button
            onClick={() => setMode('script')}
            className={`px-2.5 py-1 rounded flex items-center gap-1 transition-all ${
              mode === 'script' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" /> Script DSL
          </button>

          <button
            onClick={handleStartSim}
            className={`px-2.5 py-1 rounded flex items-center gap-1 transition-all ${
              mode === 'preview' ? 'bg-emerald-600 text-white' : 'bg-emerald-700 hover:bg-emerald-600 text-white'
            }`}
          >
            <Play className="w-3.5 h-3.5" /> Test Preview
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {mode === 'visual' && (
          <div className="flex-1 flex">
            {/* Left Node Hierarchy */}
            <div className="w-56 border-r border-zinc-800 bg-[#202023] p-2 overflow-y-auto space-y-1">
              <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-1">
                Dialogue Nodes
              </div>
              {Object.values(dialogueTree.nodes).map(node => (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`p-2 rounded cursor-pointer transition-colors flex items-center justify-between ${
                    selectedNodeId === node.id ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <div className="truncate">
                    <div className="font-medium truncate">{node.id}</div>
                    <div className="text-[10px] opacity-70 truncate">{node.speaker ? `${node.speaker}: ` : ''}{node.text || '(empty)'}</div>
                  </div>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-black/30 uppercase">{node.type}</span>
                </div>
              ))}
            </div>

            {/* Right Node Inspector */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {selectedNode ? (
                <div className="space-y-4 max-w-xl">
                  <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-3">
                    <span className="font-semibold text-zinc-100">Node Properties: {selectedNode.id}</span>

                    <div className="space-y-1">
                      <label className="text-zinc-400">Speaker Name</label>
                      <input
                        type="text"
                        value={selectedNode.speaker || ''}
                        onChange={e => {
                          const updated = { ...selectedNode, speaker: e.target.value };
                          setDialogueTree({
                            ...dialogueTree,
                            nodes: { ...dialogueTree.nodes, [selectedNode.id]: updated }
                          });
                        }}
                        className="w-full bg-[#18181b] border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-100"
                        placeholder="e.g. Merchant, Elder, Hero"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-zinc-400">Dialogue Text</label>
                      <textarea
                        rows={3}
                        value={selectedNode.text || ''}
                        onChange={e => {
                          const updated = { ...selectedNode, text: e.target.value };
                          setDialogueTree({
                            ...dialogueTree,
                            nodes: { ...dialogueTree.nodes, [selectedNode.id]: updated }
                          });
                        }}
                        className="w-full bg-[#18181b] border border-zinc-700 rounded p-2 text-zinc-100"
                        placeholder="Enter character speech..."
                      />
                    </div>

                    {selectedNode.type === 'choice' && (
                      <div className="space-y-2 pt-2 border-t border-zinc-800">
                        <label className="text-zinc-400 font-medium">Branching Choices</label>
                        {(selectedNode.choices || []).map((ch, idx) => (
                          <div key={idx} className="flex gap-2 items-center bg-[#18181b] p-2 rounded border border-zinc-800">
                            <span className="text-zinc-500 font-mono text-[10px]">#{idx + 1}</span>
                            <input
                              type="text"
                              value={ch.text}
                              className="flex-1 bg-transparent border-none text-zinc-200"
                              readOnly
                            />
                            <span className="text-blue-400 text-[10px] font-mono">-&gt; {ch.nextNodeId}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedNode.nextNodeId && (
                      <div className="text-[11px] text-zinc-400">
                        Linear Next Node: <span className="font-mono text-blue-400">{selectedNode.nextNodeId}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500 text-center py-10">Select a dialogue node to inspect.</div>
              )}
            </div>
          </div>
        )}

        {mode === 'script' && (
          <div className="flex-1 flex flex-col p-3 space-y-2">
            <div className="flex justify-between items-center text-zinc-400 text-[11px]">
              <span>Markdown Dialogue DSL (Godot Dialogue Manager syntax)</span>
              <button
                onClick={handleCompileScript}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Compile AST
              </button>
            </div>
            <textarea
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
              className="flex-1 bg-[#121214] border border-zinc-800 rounded-lg p-3 font-mono text-zinc-200 resize-none focus:outline-none focus:border-blue-500"
              placeholder="Enter narrative script..."
            />
          </div>
        )}

        {mode === 'preview' && (
          <div className="flex-1 p-6 flex flex-col items-center justify-center bg-[#121214]">
            {previewNode ? (
              <div className="w-full max-w-lg bg-[#202023] border border-zinc-700/80 rounded-xl p-5 shadow-2xl space-y-4">
                {/* Character Header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">{previewNode.speaker || 'Narrator'}</h3>
                    <span className="text-[10px] text-zinc-400">Node: {previewNode.id}</span>
                  </div>
                </div>

                {/* Speech Bubble */}
                <div className="bg-[#18181b] border border-zinc-800 p-4 rounded-lg text-zinc-100 text-sm leading-relaxed">
                  {previewNode.text}
                </div>

                {/* Branching Choice Buttons */}
                {previewNode.type === 'choice' && previewNode.choices && (
                  <div className="space-y-2 pt-2">
                    {previewNode.choices.map((ch, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleChooseOption(idx)}
                        className="w-full p-2.5 rounded-lg bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-200 text-left transition-all border border-zinc-700/50 flex items-center justify-between"
                      >
                        <span>{ch.text}</span>
                        <span className="text-[10px] opacity-60 font-mono">-&gt; {ch.nextNodeId}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Advance Button for linear nodes */}
                {previewNode.type !== 'choice' && (
                  <button
                    onClick={handleAdvance}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>Continue</span>
                    <Play className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-zinc-800 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="text-zinc-200 font-semibold">Conversation Concluded</div>
                <button
                  onClick={handleStartSim}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
                >
                  Restart Conversation
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
