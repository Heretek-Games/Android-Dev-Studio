import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Save,
  Play,
  GitBranch,
  FileCode2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Plus,
  Trash2,
  Database
} from 'lucide-react';
import { useStudio } from '../state/StudioState';
import { sceneStore, type HarnessScene } from '../services/SceneStore';
import { DialogueManager, LocalizationService, type DialogueTree, type DialogueNode, type DialogueChoice } from '@heretek/engine';

const SAMPLE_SCRIPT = `
[Tree: AncientBazaar (Ancient Bazaar Merchant)]
Merchant: Greetings, wanderer! What brings you to our oasis?
- "Show me your rarest artifacts." -> BrowseShop
- "Have you heard any rumors about the dragon?" -> RumorCheck
- "Just passing through." -> Farewell

[Node: BrowseShop]
Merchant: Feast your eyes on these relics of a forgotten age.
-> Farewell

[Node: RumorCheck]
Merchant: They say the dragon sleeps beneath the eastern dunes... for now.
-> Farewell

[Node: Farewell]
Merchant: Safe travels under the desert stars.
`;

type Mode = 'visual' | 'script' | 'preview';

interface SceneDialogueEntry {
  id?: string;
  script?: string;
  format?: string;
  nodes?: Record<string, DialogueNode>;
  title?: string;
  startNodeId?: string;
}

function buildTreesFromScene(scene: HarnessScene): { trees: DialogueTree[]; scripts: Record<string, string>; errors: string[] } {
  const dialogues = (scene as any).dialogues as Record<string, SceneDialogueEntry> | undefined;
  const trees: DialogueTree[] = [];
  const scripts: Record<string, string> = {};
  const errors: string[] = [];
  if (!dialogues) return { trees, scripts, errors };

  for (const [key, entry] of Object.entries(dialogues)) {
    try {
      if (entry?.format === 'dsl' && typeof entry.script === 'string') {
        const dm = new DialogueManager();
        const tree = dm.parseScript(entry.script);
        if (!tree.id) tree.id = key;
        scripts[tree.id] = entry.script;
        trees.push(tree);
      } else if (entry?.nodes) {
        trees.push({
          id: entry.id || key,
          title: entry.title || key,
          startNodeId: entry.startNodeId || Object.keys(entry.nodes)[0] || 'node_0',
          nodes: entry.nodes
        });
      }
    } catch (err: any) {
      errors.push(`${key}: ${err.message}`);
    }
  }
  return { trees, scripts, errors };
}

export const DialogueEditorDock: React.FC = () => {
  const { addLog } = useStudio();
  const [mode, setMode] = useState<Mode>('visual');
  const [harnessScene, setHarnessScene] = useState<HarnessScene | null>(null);
  const [trees, setTrees] = useState<DialogueTree[]>([]);
  const [dslScripts, setDslScripts] = useState<Record<string, string>>({});
  const [activeTreeId, setActiveTreeId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Preview state
  const dmRef = useRef<DialogueManager | null>(null);
  const [previewNode, setPreviewNode] = useState<DialogueNode | null>(null);
  const [previewChoices, setPreviewChoices] = useState<Array<{ index: number; choice: DialogueChoice }>>([]);
  const [previewEvents, setPreviewEvents] = useState<string[]>([]);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewLocale, setPreviewLocale] = useState('en');

  /** String tables from the canonical scene (scene.localization), if any. */
  const localeTables = (harnessScene?.localization as unknown as
    { locale?: string; tables?: Record<string, Record<string, string>> } | undefined)?.tables ?? null;
  const previewLocales = localeTables ? Object.keys(localeTables).sort() : ['en'];

  const bindPreviewLocale = (dm: DialogueManager, locale: string): void => {
    if (localeTables) {
      dm.setLocalization(new LocalizationService(localeTables, locale));
    }
  };
  const [variables, setVariables] = useState<Record<string, any>>({ gold: 100, rep: 5 });

  // ---- Load canonical scene ------------------------------------------------
  const loadFromHarness = useCallback(async () => {
    try {
      const scene = await sceneStore.fetchScene();
      setHarnessScene(scene);
      setSceneError(null);
      const { trees: loaded, scripts, errors } = buildTreesFromScene(scene);
      if (errors.length) addLog('warn', 'Dialogue', `Dialogue load issues: ${errors.join('; ')}`);
      if (loaded.length > 0) {
        setTrees(loaded);
        setDslScripts(scripts);
        setActiveTreeId(prev => (loaded.some(t => t.id === prev) ? prev : loaded[0].id));
        setDirty(false);
      } else if (trees.length === 0) {
        // Seed locally from the sample script; nothing persists until Save.
        const dm = new DialogueManager();
        const seeded = dm.parseScript(SAMPLE_SCRIPT);
        setTrees([seeded]);
        setActiveTreeId(seeded.id);
        setSelectedNodeId(seeded.startNodeId);
        setScriptText(SAMPLE_SCRIPT);
      }
    } catch (err: any) {
      setSceneError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  useEffect(() => {
    loadFromHarness();
    return sceneStore.subscribe(scene => setHarnessScene(scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTree = useMemo(() => trees.find(t => t.id === activeTreeId) || null, [trees, activeTreeId]);
  const selectedNode = activeTree?.nodes[selectedNodeId] || null;

  useEffect(() => {
    if (activeTree && !activeTree.nodes[selectedNodeId]) {
      setSelectedNodeId(activeTree.startNodeId);
    }
    if (activeTree && dslScripts[activeTree.id]) {
      setScriptText(dslScripts[activeTree.id]);
    }
  }, [activeTree, selectedNodeId, dslScripts]);

  // ---- Editing -------------------------------------------------------------
  const updateActiveTree = (mutator: (tree: DialogueTree) => void) => {
    setTrees(prev =>
      prev.map(t => {
        if (t.id !== activeTreeId) return t;
        const draft: DialogueTree = JSON.parse(JSON.stringify(t));
        mutator(draft);
        return draft;
      })
    );
    setDirty(true);
  };

  const updateSelectedNode = (patch: Partial<DialogueNode>) => {
    if (!selectedNodeId) return;
    updateActiveTree(tree => {
      const node = tree.nodes[selectedNodeId];
      if (node) Object.assign(node, patch);
    });
  };

  const updateChoice = (choiceIndex: number, patch: Partial<DialogueChoice>) => {
    updateActiveTree(tree => {
      const node = tree.nodes[selectedNodeId];
      if (node?.choices?.[choiceIndex]) Object.assign(node.choices[choiceIndex], patch);
    });
  };

  const addChoice = () => {
    updateActiveTree(tree => {
      const node = tree.nodes[selectedNodeId];
      if (node) {
        node.choices = node.choices || [];
        node.choices.push({
          id: `choice_${node.choices.length + 1}`,
          text: 'New choice',
          nextNodeId: tree.startNodeId
        });
      }
    });
  };

  const removeChoice = (choiceIndex: number) => {
    updateActiveTree(tree => {
      const node = tree.nodes[selectedNodeId];
      if (node?.choices) node.choices.splice(choiceIndex, 1);
    });
  };

  const handleCompileScript = () => {
    try {
      const dm = new DialogueManager();
      const compiled = dm.parseScript(scriptText);
      setTrees(prev => {
        const others = prev.filter(t => t.id !== compiled.id);
        return [...others, compiled];
      });
      setDslScripts(prev => ({ ...prev, [compiled.id]: scriptText }));
      setActiveTreeId(compiled.id);
      setSelectedNodeId(compiled.startNodeId);
      setDirty(true);
      addLog('info', 'Dialogue', `Compiled "${compiled.title}" with ${Object.keys(compiled.nodes).length} nodes`);
      setMode('visual');
    } catch (err: any) {
      addLog('error', 'Dialogue', `Dialogue parse error: ${err.message}`);
    }
  };

  // ---- Persistence ---------------------------------------------------------
  const handleSave = async () => {
    const payload: Record<string, DialogueTree> = {};
    for (const tree of trees) payload[tree.id] = tree;
    const result = await sceneStore.mutate(scene => {
      (scene as any).dialogues = payload;
    });
    if (result.ok) {
      setDirty(false);
      setSaveNote(`Saved ${trees.length} dialogue tree(s) to scene.dialogues (MCP studio_configure_dialogue compatible)`);
      addLog('info', 'Dialogue', `Persisted ${trees.length} tree(s) to the canonical scene`);
    } else {
      setSaveNote(`Save rejected: ${result.error}`);
      addLog('warn', 'Dialogue', `Scene save rejected: ${result.error}`);
    }
  };

  // ---- Preview through the real DialogueManager ---------------------------
  const startPreview = () => {
    if (!activeTree) return;
    const dm = new DialogueManager();
    for (const tree of trees) dm.registerTree(tree);
    for (const [k, v] of Object.entries(variables)) dm.setVariable(k, v);
    bindPreviewLocale(dm, previewLocale);
    dm.addEventListener((eventName, payload) => {
      setPreviewEvents(prev => [
        ...prev.slice(-19),
        `${new Date().toLocaleTimeString()} → ${eventName}${payload ? ` ${JSON.stringify(payload)}` : ''}`
      ]);
      addLog('ai', 'Dialogue', `Narrative event emitted: ${eventName}`);
    });
    dmRef.current = dm;
    setPreviewEvents([]);
    dm.startConversation(activeTree.id);
    refreshPreviewState();
    setPreviewActive(true);
    setMode('preview');
  };

  const refreshPreviewState = () => {
    const dm = dmRef.current;
    if (!dm) return;
    // Localized display text; variable gating preserved via available indices.
    const localized = dm.getLocalizedNode();
    const byIndex = new Map((localized?.choices ?? []).map((c, i) => [i, c] as const));
    setPreviewNode(localized);
    setPreviewChoices(
      dm.getAvailableChoices().map(({ index, choice }) => ({
        index,
        choice: byIndex.get(index) ?? choice
      }))
    );
    if (!dm.getCurrentNode()) setPreviewActive(false);
  };

  const handlePreviewLocale = (locale: string) => {
    setPreviewLocale(locale);
    const dm = dmRef.current;
    if (dm) {
      bindPreviewLocale(dm, locale);
      refreshPreviewState();
    }
  };

  const handleAdvance = () => {
    dmRef.current?.advance();
    refreshPreviewState();
  };

  const handleChoose = (choiceIndex: number) => {
    try {
      dmRef.current?.chooseOption(choiceIndex);
      refreshPreviewState();
    } catch (err: any) {
      addLog('warn', 'Dialogue', `Choice blocked: ${err.message}`);
    }
  };

  const applyVariables = (next: Record<string, any>) => {
    setVariables(next);
    const dm = dmRef.current;
    if (dm) {
      for (const [k, v] of Object.entries(next)) dm.setVariable(k, v);
      refreshPreviewState();
    }
  };

  const nodeList = activeTree ? Object.values(activeTree.nodes) : [];

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-zinc-200 select-none text-xs font-sans">
      {/* Header */}
      <div className="flex items-center justify-between p-2 bg-[#27272a] border-b border-zinc-700/60">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="font-semibold text-zinc-100 truncate">{activeTree?.title || 'No tree loaded'}</span>
          <span className="text-[10px] text-zinc-500 font-mono shrink-0">
            ({activeTree ? Object.keys(activeTree.nodes).length : 0} nodes{dirty ? ' · unsaved' : ''})
          </span>
          {harnessScene && (
            <span className="text-[10px] text-zinc-600 font-mono flex items-center gap-1 shrink-0">
              <Database className="w-3 h-3" /> scene.dialogues
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMode('visual')}
            className={`px-2.5 py-1 rounded flex items-center gap-1 ${
              mode === 'visual' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" /> Visual Nodes
          </button>
          <button
            onClick={() => setMode('script')}
            className={`px-2.5 py-1 rounded flex items-center gap-1 ${
              mode === 'script' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" /> Script DSL
          </button>
          <button
            onClick={startPreview}
            disabled={!activeTree}
            className="px-2.5 py-1 rounded flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white"
          >
            <Play className="w-3.5 h-3.5" /> Test Preview
          </button>
          <button
            onClick={handleSave}
            disabled={!trees.length}
            className="px-2.5 py-1 rounded flex items-center gap-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-100"
          >
            <Save className="w-3.5 h-3.5" /> Save
          </button>
          <button onClick={loadFromHarness} className="p-1 rounded hover:bg-zinc-700 text-zinc-400" title="Reload from harness">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {(sceneError || saveNote) && (
        <div
          className={`px-3 py-1.5 text-[11px] border-b flex items-center gap-1.5 ${
            sceneError
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {sceneError ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
          <span>{sceneError || saveNote}</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {/* ============ VISUAL ============ */}
        {mode === 'visual' && activeTree && (
          <div className="flex h-full">
            {/* Node list */}
            <div className="w-64 border-r border-zinc-800 overflow-y-auto p-2 space-y-1">
              {nodeList.map(node => (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`w-full text-left px-2.5 py-2 rounded border transition-colors ${
                    selectedNodeId === node.id
                      ? 'bg-blue-600/20 border-blue-500/50 text-white'
                      : 'bg-[#202023] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px]">{node.id}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border uppercase ${
                        node.type === 'choice'
                          ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                          : node.type === 'end'
                            ? 'text-zinc-400 bg-zinc-500/10 border-zinc-600/40'
                            : 'text-blue-300 bg-blue-500/10 border-blue-500/30'
                      }`}
                    >
                      {node.type}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate mt-1">
                    {node.speaker ? `${node.speaker}: ` : ''}
                    {node.text || '—'}
                  </div>
                </button>
              ))}
            </div>

            {/* Node inspector */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {selectedNode ? (
                <>
                  <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-2">
                    <div className="font-semibold text-zinc-100">Node Properties: {selectedNode.id}</div>
                    <label className="block text-zinc-400 text-[11px]">Speaker Name</label>
                    <input
                      value={selectedNode.speaker || ''}
                      onChange={e => updateSelectedNode({ speaker: e.target.value })}
                      placeholder="e.g. Merchant, Elder, Hero"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
                    />
                    <label className="block text-zinc-400 text-[11px]">Dialogue Text</label>
                    <textarea
                      value={selectedNode.text || ''}
                      onChange={e => updateSelectedNode({ text: e.target.value })}
                      rows={3}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 resize-none"
                    />
                    <label className="block text-zinc-400 text-[11px]">Next Node (text nodes)</label>
                    <input
                      value={selectedNode.nextNodeId || ''}
                      onChange={e => updateSelectedNode({ nextNodeId: e.target.value })}
                      placeholder="node id"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 font-mono text-[11px]"
                    />
                  </div>

                  <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-100">Branching Choices</span>
                      <button
                        onClick={addChoice}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-[11px]"
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </div>
                    {(selectedNode.choices || []).map((choice, idx) => (
                      <div key={choice.id} className="bg-[#18181b] border border-zinc-800 rounded p-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500 text-[10px] font-mono">#{idx + 1}</span>
                          <input
                            value={choice.text}
                            onChange={e => updateChoice(idx, { text: e.target.value })}
                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                          />
                          <input
                            value={choice.nextNodeId}
                            onChange={e => updateChoice(idx, { nextNodeId: e.target.value })}
                            className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 font-mono text-[10px]"
                          />
                          <button
                            onClick={() => removeChoice(idx)}
                            className="p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                          <span>Gate:</span>
                          <input
                            value={choice.conditionVariable || ''}
                            placeholder="variable"
                            onChange={e => updateChoice(idx, { conditionVariable: e.target.value || undefined })}
                            className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                          />
                          <select
                            value={choice.conditionOperator || '>='}
                            onChange={e => updateChoice(idx, { conditionOperator: e.target.value as any })}
                            className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200"
                          >
                            {['==', '!=', '>', '<', '>=', '<='].map(op => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                          <input
                            value={String(choice.conditionValue ?? '')}
                            placeholder="value"
                            onChange={e => {
                              const raw = e.target.value;
                              const num = Number(raw);
                              updateChoice(idx, { conditionValue: raw !== '' && !Number.isNaN(num) ? num : raw });
                            }}
                            className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                          />
                          <span className="text-zinc-600">(unmet choices are hidden in preview)</span>
                        </div>
                      </div>
                    ))}
                    {(!selectedNode.choices || selectedNode.choices.length === 0) && (
                      <div className="text-[11px] text-zinc-500">No choices on this node.</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-zinc-500">Select a node to edit.</div>
              )}
            </div>
          </div>
        )}

        {/* ============ SCRIPT DSL ============ */}
        {mode === 'script' && (
          <div className="h-full flex flex-col p-3 gap-2">
            <textarea
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
              placeholder="Enter narrative script…"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200 font-mono text-[11px] leading-relaxed resize-none outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setScriptText(dslScripts[activeTreeId] || SAMPLE_SCRIPT)}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              >
                Reset
              </button>
              <button
                onClick={handleCompileScript}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Compile Script
              </button>
            </div>
          </div>
        )}

        {/* ============ PREVIEW ============ */}
        {mode === 'preview' && (
          <div className="h-full flex">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span>Preview locale:</span>
                <select
                  value={previewLocale}
                  onChange={(e) => handlePreviewLocale(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 outline-none"
                >
                  {previewLocales.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                {!localeTables && (
                  <span className="text-zinc-600">(no scene.localization tables — showing literals)</span>
                )}
              </div>
              <div className="bg-[#202023] border border-zinc-800 rounded-lg p-4 space-y-3">
                {previewNode ? (
                  <>
                    {previewNode.speaker && (
                      <div className="text-blue-400 font-semibold text-[11px] uppercase tracking-wide">
                        {previewNode.speaker}
                      </div>
                    )}
                    <div className="text-zinc-100 text-sm leading-relaxed">{previewNode.text || '—'}</div>

                    {previewNode.type === 'choice' && (
                      <div className="space-y-1.5 pt-1">
                        {previewChoices.map(({ index, choice }) => (
                          <button
                            key={choice.id}
                            onClick={() => handleChoose(index)}
                            className="w-full text-left px-3 py-2 rounded border border-blue-500/30 bg-blue-600/10 hover:bg-blue-600/20 text-zinc-100 flex items-center justify-between"
                          >
                            <span>{choice.text}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-blue-400" />
                          </button>
                        ))}
                        {previewChoices.length === 0 && (
                          <div className="text-[11px] text-amber-300">
                            All choices are gated out by the current variables — adjust variables to continue.
                          </div>
                        )}
                      </div>
                    )}

                    {(previewNode.type === 'text' || previewNode.type === 'action') && (
                      <button
                        onClick={handleAdvance}
                        className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-medium"
                      >
                        {previewNode.nextNodeId ? 'Continue' : 'End Conversation'}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-zinc-500">Conversation ended.</div>
                )}
              </div>

              {previewEvents.length > 0 && (
                <div className="bg-[#202023] border border-zinc-800 rounded-lg p-3">
                  <div className="font-semibold text-zinc-300 text-[11px] mb-1.5">
                    Narrative Events (dispatched by DialogueManager)
                  </div>
                  <div className="space-y-1 font-mono text-[10px] text-purple-300 max-h-32 overflow-y-auto">
                    {previewEvents.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Variable table */}
            <div className="w-64 border-l border-zinc-800 p-3 space-y-2 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Dialogue Variables</div>
              {Object.entries(variables).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-[11px] text-zinc-400 truncate">{key}</span>
                  <input
                    value={String(value)}
                    onChange={e => {
                      const raw = e.target.value;
                      const num = Number(raw);
                      applyVariables({ ...variables, [key]: raw !== '' && !Number.isNaN(num) ? num : raw });
                    }}
                    className="w-20 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                  />
                </div>
              ))}
              <div className="flex gap-1 pt-1">
                <input
                  id="new-var-name"
                  placeholder="new var"
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                />
                <button
                  onClick={() => {
                    const el = document.getElementById('new-var-name') as HTMLInputElement | null;
                    if (el?.value) {
                      applyVariables({ ...variables, [el.value]: 0 });
                      el.value = '';
                    }
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-[11px]"
                >
                  Add
                </button>
              </div>
              <div className="text-[10px] text-zinc-500 pt-1">
                Preview runs the real DialogueManager: choices are gated live by these variables (operators supported),
                and action nodes emit events into the log.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
