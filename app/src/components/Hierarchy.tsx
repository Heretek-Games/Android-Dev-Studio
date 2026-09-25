import React, { useState, useMemo } from 'react';
import { useStudio } from '../state/StudioState';
import {
  RigidBody3D,
  MobileController,
  ElementalReactionComponent,
  LightComponent,
  CameraComponent
} from '@heretek/engine';
import {
  Box,
  Circle,
  Cylinder,
  Sun,
  Camera,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Search,
  Layers,
  Sparkles,
  Zap,
  Flame,
  Activity,
  Undo2,
  Redo2
} from 'lucide-react';

export const Hierarchy: React.FC = () => {
  const {
    scene,
    selectedId,
    setSelectedId,
    addPrimitive,
    deleteSelected,
    undo,
    redo,
    canUndo,
    canRedo,
    refreshScene
  } = useStudio();

  const [search, setSearch] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);

  const filteredObjects = useMemo(() => {
    if (!search.trim()) return scene.gameObjects;
    const query = search.toLowerCase();
    return scene.gameObjects.filter(
      go => go.name.toLowerCase().includes(query) || go.tag.toLowerCase().includes(query)
    );
  }, [scene.gameObjects, search]);

  const getEntityIcon = (go: any) => {
    const l = go.name.toLowerCase();
    if (go.getComponent(LightComponent) || l.includes('light') || l.includes('sun')) {
      return <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (go.getComponent(CameraComponent) || l.includes('camera')) {
      return <Camera className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    }
    if (go.getComponent(ElementalReactionComponent) || l.includes('slime')) {
      return <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    }
    if (l.includes('sphere') || l.includes('ball')) {
      return <Circle className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
    }
    if (l.includes('cylinder') || l.includes('coin')) {
      return <Cylinder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    return <Box className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  };

  const getComponentBadges = (go: any) => {
    const badges: { label: string; color: string }[] = [];
    if (go.getComponent(RigidBody3D)) badges.push({ label: 'RB', color: 'text-purple-400 bg-purple-950/50 border-purple-800/40' });
    if (go.getComponent(ElementalReactionComponent)) badges.push({ label: 'FX', color: 'text-rose-400 bg-rose-950/50 border-rose-800/40' });
    if (go.getComponent(MobileController)) badges.push({ label: 'CTRL', color: 'text-cyan-400 bg-cyan-950/50 border-cyan-800/40' });
    return badges;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none border-r border-zinc-800">
      {/* Top Header & Quick Add */}
      <div className="p-2.5 border-b border-zinc-800 bg-zinc-900/50 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase">
              Scene Graph
            </span>
            <span className="text-[10px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 font-mono rounded border border-zinc-700">
              {scene.gameObjects.length}
            </span>
          </div>

          <div className="relative flex items-center space-x-1">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="flex items-center space-x-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>

            {selectedId && (
              <button
                onClick={deleteSelected}
                title="Delete Selected Entity"
                className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>

            {/* Add Primitive Dropdown Menu */}
            {showAddMenu && (
              <div
                className="absolute right-0 top-8 w-44 bg-zinc-900 border border-zinc-850 rounded-lg shadow-2xl py-1 z-50 text-xs text-zinc-200"
                onMouseLeave={() => setShowAddMenu(false)}
              >
                <button
                  onClick={() => { addPrimitive('box'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Box className="w-3.5 h-3.5 text-blue-400" />
                  <span>3D Cube</span>
                </button>
                <button
                  onClick={() => { addPrimitive('sphere'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Circle className="w-3.5 h-3.5 text-pink-400" />
                  <span>3D Sphere</span>
                </button>
                <button
                  onClick={() => { addPrimitive('cylinder'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Cylinder className="w-3.5 h-3.5 text-emerald-400" />
                  <span>3D Cylinder</span>
                </button>
                <button
                  onClick={() => { addPrimitive('plane'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Box className="w-3.5 h-3.5 text-slate-400" />
                  <span>Ground Plane</span>
                </button>
                <div className="h-px bg-zinc-800 my-1" />
                <button
                  onClick={() => { addPrimitive('light'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Point Light</span>
                </button>
                <button
                  onClick={() => { addPrimitive('camera'); setShowAddMenu(false); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-zinc-800 text-left transition-colors"
                >
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Camera</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-2" />
          <input
            type="text"
            placeholder="Filter entities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-7 pl-7 pr-6 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1.5 text-xs text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Entity Tree List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filteredObjects.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No entities match "{search}"
          </div>
        ) : (
          filteredObjects.map(go => {
            const isSelected = go.id === selectedId;
            const badges = getComponentBadges(go);

            return (
              <div
                key={go.id}
                onClick={() => setSelectedId(go.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2 truncate flex-1 min-w-0 mr-1.5">
                  {getEntityIcon(go)}
                  <span className="truncate">{go.name}</span>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  {/* Component Badges */}
                  {!isSelected && badges.map((b, idx) => (
                    <span
                      key={idx}
                      className={`text-[9px] px-1 py-0.2 rounded border font-mono font-medium ${b.color}`}
                    >
                      {b.label}
                    </span>
                  ))}

                  {/* Active Visibility Eye Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      go.active = !go.active;
                      refreshScene();
                    }}
                    title={go.active ? 'Hide Object' : 'Show Object'}
                    className={`p-0.5 rounded transition-colors ${
                      isSelected ? 'hover:bg-blue-700 text-white' : 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {go.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-rose-400" />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
