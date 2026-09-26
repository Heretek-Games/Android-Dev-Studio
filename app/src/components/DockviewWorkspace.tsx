import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { useStudio } from '../state/StudioState';
import { useWorkspaceLayouts } from '../state/useWorkspaceLayouts';
import { StudioHeader } from './StudioHeader';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { Viewport3D } from './Viewport3D';
import { Hierarchy } from './Hierarchy';
import { Inspector } from './Inspector';
import { AssetBrowser } from './AssetBrowser';
import { EventSheetEditor } from './EventSheetEditor';
import { AIHarnessDock } from './AIHarnessDock';
import { AgentSwarmDock } from './AgentSwarmDock';
import { ArtemisQADock } from './ArtemisQADock';
import { ProfilerDock } from './ProfilerDock';
import { ConsoleDock } from './ConsoleDock';
import { TerrainSculptorDock } from './TerrainSculptorDock';
import { AnimationBlendTreeDock } from './AnimationBlendTreeDock';
import { LargeScaleWorldDock } from './LargeScaleWorldDock';
import { DialogueEditorDock } from './DialogueEditorDock';
import { DeviceMirrorDock } from './DeviceMirrorDock';

export type WorkspacePreset = 'default' | 'level_design' | 'visual_scripting' | 'ai_swarm' | 'mobile_qa';

// Panel components registry for DockviewReact
const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  scene_viewport: () => <Viewport3D />,
  hierarchy: () => <Hierarchy />,
  inspector: () => <Inspector />,
  asset_browser: () => <AssetBrowser />,
  event_sheet: () => <EventSheetEditor />,
  ai_harness: () => <AIHarnessDock />,
  agent_swarm: () => <AgentSwarmDock />,
  artemis_qa: () => <ArtemisQADock />,
  profiler: () => <ProfilerDock />,
  console: () => <ConsoleDock />,
  terrain_sculptor: () => <TerrainSculptorDock />,
  animation_studio: () => <AnimationBlendTreeDock />,
  large_world: () => <LargeScaleWorldDock />,
  dialogue_editor: () => <DialogueEditorDock />,
  device_mirror: () => <DeviceMirrorDock />
};

export const DockviewWorkspace: React.FC = () => {
  const { addLog } = useStudio();
  const apiRef = useRef<DockviewApi | null>(null);
  const [activePreset, setActivePreset] = useState<WorkspacePreset>('default');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const layouts = useWorkspaceLayouts();
  const detachLayouts = useRef<(() => void) | null>(null);

  // Ctrl+K command palette (Track D.1); ignored inside text inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      detachLayouts.current?.();
    };
  }, []);

  // Apply workspace layout presets
  const applyPreset = useCallback((preset: WorkspacePreset, api: DockviewApi) => {
    api.clear();

    if (preset === 'default') {
      // 1. Center Viewport (HERO Panel - 70%+ of screen)
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Scene Viewport',
        renderer: 'always'
      });

      // 2. Hierarchy on Left
      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Scene Hierarchy',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      // 3. Inspector on Right
      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: { referencePanel: 'scene_viewport', direction: 'right' }
      });

      // 4. Tabbed Bottom Drawer (Asset Store active by default)
      api.addPanel({
        id: 'asset_browser',
        component: 'asset_browser',
        title: 'GDevelop 3D Store',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      // Secondary tabs in bottom drawer
      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console & Logcat',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'event_sheet',
        component: 'event_sheet',
        title: 'Visual Event Sheet',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'ai_harness',
        component: 'ai_harness',
        title: 'AI Copilot',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'agent_swarm',
        component: 'agent_swarm',
        title: 'Agent Swarm',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'terrain_sculptor',
        component: 'terrain_sculptor',
        title: 'Terrain Sculptor',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'animation_studio',
        component: 'animation_studio',
        title: 'Animation Studio',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Artemis Mobile QA',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: 'Mobile Profiler',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'large_world',
        component: 'large_world',
        title: 'Large-Scale World & Sim',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      api.addPanel({
        id: 'dialogue_editor',
        component: 'dialogue_editor',
        title: 'Dialogue & Narrative',
        position: { referencePanel: 'asset_browser', direction: 'within' }
      });

      // Explicitly set 3D Scene Viewport as active in center
      const vp = api.getPanel('scene_viewport');
      if (vp) vp.api.setActive();
      const ab = api.getPanel('asset_browser');
      if (ab) ab.api.setActive();
    } else if (preset === 'level_design') {
      // Level Design & World preset: Large Viewport, Terrain Sculptor on side, Asset store on bottom
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Scene Viewport',
        renderer: 'always'
      });

      api.addPanel({
        id: 'terrain_sculptor',
        component: 'terrain_sculptor',
        title: 'Terrain Sculptor',
        position: { referencePanel: 'scene_viewport', direction: 'right' }
      });

      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Hierarchy',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      api.addPanel({
        id: 'asset_browser',
        component: 'asset_browser',
        title: 'GDevelop 3D Assets',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: { referencePanel: 'terrain_sculptor', direction: 'below' }
      });
    } else if (preset === 'visual_scripting') {
      // Visual Scripting preset: Event Sheet & Viewport side-by-side
      api.addPanel({
        id: 'event_sheet',
        component: 'event_sheet',
        title: 'Visual Event Sheet Editor'
      });

      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Live Preview',
        renderer: 'always',
        position: { referencePanel: 'event_sheet', direction: 'right' }
      });

      api.addPanel({
        id: 'hierarchy',
        component: 'hierarchy',
        title: 'Hierarchy',
        position: { referencePanel: 'event_sheet', direction: 'left' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console & Logcat',
        position: { referencePanel: 'event_sheet', direction: 'below' }
      });
    } else if (preset === 'ai_swarm') {
      // AI Swarm Operations preset: Agent Swarm dock front and center
      api.addPanel({
        id: 'agent_swarm',
        component: 'agent_swarm',
        title: 'Autonomous Agent Swarm & Memory'
      });

      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: '3D Viewport',
        renderer: 'always',
        position: { referencePanel: 'agent_swarm', direction: 'right' }
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Artemis QA Telemetry',
        position: { referencePanel: 'agent_swarm', direction: 'below' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: 'Mobile Profiler',
        position: { referencePanel: 'artemis_qa', direction: 'within' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Console Logs',
        position: { referencePanel: 'artemis_qa', direction: 'within' }
      });
    } else if (preset === 'mobile_qa') {
      // Mobile Android QA preset: Device Viewport with Artemis QA and Profiler
      api.addPanel({
        id: 'scene_viewport',
        component: 'scene_viewport',
        title: 'Android Game View',
        renderer: 'always'
      });

      api.addPanel({
        id: 'artemis_qa',
        component: 'artemis_qa',
        title: 'Google Artemis Mobile QA',
        position: { referencePanel: 'scene_viewport', direction: 'left' }
      });

      api.addPanel({
        id: 'profiler',
        component: 'profiler',
        title: '60 FPS Profiler & Memory',
        position: { referencePanel: 'scene_viewport', direction: 'below' }
      });

      api.addPanel({
        id: 'device_mirror',
        component: 'device_mirror',
        title: 'Device Mirror & Profiler',
        position: { referencePanel: 'profiler', direction: 'within' }
      });

      api.addPanel({
        id: 'console',
        component: 'console',
        title: 'Android Logcat',
        position: { referencePanel: 'profiler', direction: 'within' }
      });
    }

    setActivePreset(preset);
    addLog('info', 'StudioWorkspace', `Applied layout preset: "${preset}".`);
  }, [addLog]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    detachLayouts.current = layouts.attach(event.api);
    // User's last state wins; fall back to the default preset.
    if (!layouts.restoreLast()) applyPreset('default', event.api);
  }, [applyPreset, layouts]);

  const handleOpenPanel = (panelId: string, title: string) => {
    if (!apiRef.current) return;
    const existing = apiRef.current.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
    } else {
      apiRef.current.addPanel({
        id: panelId,
        component: panelId,
        title,
        position: { direction: 'within', referencePanel: 'scene_viewport' }
      });
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-studio-bg text-studio-text select-none overflow-hidden font-sans">
      {/* Top Unified Studio Master Header */}
      <StudioHeader
        activePreset={activePreset}
        onSelectPreset={(p) => {
          if (apiRef.current) applyPreset(p, apiRef.current);
        }}
        onOpenPanel={handleOpenPanel}
      />

      {/* Dockview Multi-Window Workspace Container */}
      <main className="flex-1 w-full h-full dockview-theme-dark relative overflow-hidden">
        <DockviewReact
          components={components}
          onReady={onReady}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onSelectPreset={(p) => {
            if (apiRef.current) applyPreset(p, apiRef.current);
          }}
          onSaveLayoutAs={(name) => layouts.saveNamed(name)}
          extraCommands={[
            ...layouts.savedNames.map(name => ({
              id: `layout-open-${name}`,
              category: 'Layout',
              label: `Open layout "${name}"`,
              run: () => { layouts.restoreNamed(name); }
            })),
            { id: 'layout-reset', category: 'Layout', label: 'Reset to default workspace', run: () => { if (apiRef.current) applyPreset('default', apiRef.current); } }
          ]}
        />
      </main>

      {/* Track D.1 status bar: workspace left, selection right */}
      <StatusBar />
    </div>
  );
};
