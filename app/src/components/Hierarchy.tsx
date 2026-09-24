import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Box,
  Circle,
  Cylinder,
  Sun,
  Camera,
  Plus,
  Trash2,
  Copy,
  ChevronRight,
  Eye,
  EyeOff
} from 'lucide-react';

export const Hierarchy: React.FC = () => {
  const {
    scene,
    selectedId,
    setSelectedId,
    addPrimitive,
    deleteSelected,
    refreshScene
  } = useStudio();

  const [showAddMenu, setShowAddMenu] = useState(false);

  const getIcon = (name: string) => {
    const l = name.toLowerCase();
    if (l.includes('light') || l.includes('sun')) return <Sun className="w-3.5 h-3.5 text-amber-400" />;
    if (l.includes('camera')) return <Camera className="w-3.5 h-3.5 text-cyan-400" />;
    if (l.includes('sphere') || l.includes('ball')) return <Circle className="w-3.5 h-3.5 text-pink-400" />;
    if (l.includes('cylinder')) return <Cylinder className="w-3.5 h-3.5 text-emerald-400" />;
    return <Box className="w-3.5 h-3.5 text-blue-400" />;
  };

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-r border-studio-border">
      {/* Header & Actions */}
      <div className="flex items-center justify-between p-2.5 border-b border-studio-border bg-studio-bg/40">
        <span className="text-xs font-semibold text-gray-300 tracking-wide uppercase">
          Scene Graph
        </span>
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
              title="Delete Entity"
              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Add Dropdown Menu */}
          {showAddMenu && (
            <div
              className="absolute right-0 top-8 w-44 bg-zinc-800 border border-studio-border rounded-lg shadow-xl py-1 z-50 text-xs text-gray-200"
              onMouseLeave={() => setShowAddMenu(false)}
            >
              <button
                onClick={() => { addPrimitive('box'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Box className="w-3.5 h-3.5 text-blue-400" />
                <span>3D Cube</span>
              </button>
              <button
                onClick={() => { addPrimitive('sphere'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Circle className="w-3.5 h-3.5 text-pink-400" />
                <span>3D Sphere</span>
              </button>
              <button
                onClick={() => { addPrimitive('cylinder'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Cylinder className="w-3.5 h-3.5 text-emerald-400" />
                <span>3D Cylinder</span>
              </button>
              <button
                onClick={() => { addPrimitive('plane'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Box className="w-3.5 h-3.5 text-slate-400" />
                <span>Ground Plane</span>
              </button>
              <div className="h-px bg-studio-border my-1" />
              <button
                onClick={() => { addPrimitive('light'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Point Light</span>
              </button>
              <button
                onClick={() => { addPrimitive('camera'); setShowAddMenu(false); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600/30 text-left transition-colors"
              >
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                <span>Camera</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Entity Tree List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {scene.gameObjects.map(go => {
          const isSelected = go.id === selectedId;
          return (
            <div
              key={go.id}
              onClick={() => setSelectedId(go.id)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-gray-300 hover:bg-studio-hover'
              }`}
            >
              <div className="flex items-center space-x-2 truncate">
                {getIcon(go.name)}
                <span className="truncate">{go.name}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  go.active = !go.active;
                  refreshScene();
                }}
                className={`p-0.5 rounded transition-colors ${
                  isSelected ? 'hover:bg-blue-700 text-white' : 'hover:bg-studio-border text-gray-500'
                }`}
              >
                {go.active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-red-400" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
