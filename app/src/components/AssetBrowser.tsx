import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Folder,
  FileCode,
  FileBox,
  Image,
  Music,
  Plus,
  Search,
  Upload
} from 'lucide-react';

export interface AssetItem {
  id: string;
  name: string;
  type: 'model' | 'script' | 'texture' | 'audio' | 'scene';
  size: string;
}

export const AssetBrowser: React.FC = () => {
  const { addPrimitive, addLog } = useStudio();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const assets: AssetItem[] = [
    { id: '1', name: 'PlayerHero.glb', type: 'model', size: '2.4 MB' },
    { id: '2', name: 'BonusCrate.glb', type: 'model', size: '480 KB' },
    { id: '3', name: 'FloatingPlatform.glb', type: 'model', size: '1.1 MB' },
    { id: '4', name: 'MobileTouchControls.ts', type: 'script', size: '8.2 KB' },
    { id: '5', name: 'ObstacleSpawner.ts', type: 'script', size: '4.5 KB' },
    { id: '6', name: 'Grass_PBR_Albedo.png', type: 'texture', size: '1.8 MB' },
    { id: '7', name: 'JumpSound.wav', type: 'audio', size: '120 KB' },
    { id: '8', name: 'MainArena.scene.json', type: 'scene', size: '42 KB' }
  ];

  const filtered = assets.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

  const getIcon = (type: AssetItem['type']) => {
    switch (type) {
      case 'model': return <FileBox className="w-6 h-6 text-blue-400" />;
      case 'script': return <FileCode className="w-6 h-6 text-emerald-400" />;
      case 'texture': return <Image className="w-6 h-6 text-pink-400" />;
      case 'audio': return <Music className="w-6 h-6 text-amber-400" />;
      case 'scene': return <Folder className="w-6 h-6 text-cyan-400" />;
    }
  };

  const handleAssetClick = (asset: AssetItem) => {
    setSelectedAsset(asset.id);
    if (asset.type === 'model') {
      addPrimitive('box');
      addLog('info', 'Assets', `Instantiated asset ${asset.name} into scene.`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-t border-studio-border">
      {/* Header */}
      <div className="flex items-center justify-between p-2.5 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <Folder className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
            Project Assets (glTF 2.0 / Textures / Scripts)
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-zinc-900 border border-studio-border rounded pl-7 pr-2 py-1 text-xs text-white placeholder-gray-500 outline-none w-36 focus:w-48 transition-all"
            />
          </div>

          <button
            onClick={() => addLog('info', 'Assets', 'Import dialog opened.')}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-gray-200 text-xs border border-studio-border transition-colors"
          >
            <Upload className="w-3 h-3" />
            <span>Import</span>
          </button>
        </div>
      </div>

      {/* Assets Grid */}
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3 content-start">
        {filtered.map(asset => (
          <div
            key={asset.id}
            onClick={() => handleAssetClick(asset)}
            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
              selectedAsset === asset.id
                ? 'bg-blue-600/20 border-blue-500 text-white shadow-sm'
                : 'bg-zinc-900/60 border-studio-border/60 hover:bg-studio-hover text-gray-300'
            }`}
          >
            <div className="mb-2 p-2 bg-zinc-800/80 rounded-md">
              {getIcon(asset.type)}
            </div>
            <span className="text-[11px] font-medium text-center truncate w-full" title={asset.name}>
              {asset.name}
            </span>
            <span className="text-[9px] text-gray-500 mt-0.5">{asset.size}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
