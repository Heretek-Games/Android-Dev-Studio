import React, { useState, useEffect } from 'react';
import { useStudio } from '../state/StudioState';
import {
  Folder,
  FileCode,
  FileBox,
  Image as ImageIcon,
  Music,
  Plus,
  Search,
  Upload,
  ShoppingBag,
  Sparkles,
  Download,
  CheckCircle,
  ExternalLink,
  Package,
  Layers,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import {
  GDevelopAssetService,
  StoreAsset,
  UnityPackageFileEntry
} from '../services/GDevelopAssetService';

export interface AssetItem {
  id: string;
  name: string;
  type: 'model' | 'script' | 'texture' | 'audio' | 'scene';
  size: string;
}

export const AssetBrowser: React.FC = () => {
  const { scene, refreshScene, addPrimitive, addLog } = useStudio();
  const [activeTab, setActiveTab] = useState<'project' | 'store'>('project');
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  // Store state
  const [storeCategory, setStoreCategory] = useState<string>('all');
  const [storeAssets, setStoreAssets] = useState<StoreAsset[]>([]);
  const [isLoadingStore, setIsLoadingStore] = useState(false);
  const [installedAssetIds, setInstalledAssetIds] = useState<Set<string>>(new Set());
  const [unityManifest, setUnityManifest] = useState<UnityPackageFileEntry[] | null>(null);

  const localAssets: AssetItem[] = [
    { id: '1', name: 'PlayerHero.glb', type: 'model', size: '2.4 MB' },
    { id: '2', name: 'BonusCrate.glb', type: 'model', size: '480 KB' },
    { id: '3', name: 'FloatingPlatform.glb', type: 'model', size: '1.1 MB' },
    { id: '4', name: 'MobileTouchControls.ts', type: 'script', size: '8.2 KB' },
    { id: '5', name: 'ObstacleSpawner.ts', type: 'script', size: '4.5 KB' },
    { id: '6', name: 'Grass_PBR_Albedo.png', type: 'texture', size: '1.8 MB' },
    { id: '7', name: 'JumpSound.wav', type: 'audio', size: '120 KB' },
    { id: '8', name: 'MainArena.scene.json', type: 'scene', size: '42 KB' }
  ];

  useEffect(() => {
    if (activeTab === 'store') {
      loadStoreCatalog();
    }
  }, [activeTab, storeCategory]);

  const loadStoreCatalog = async () => {
    setIsLoadingStore(true);
    try {
      const results = await GDevelopAssetService.getInstance().searchAssets(search, storeCategory);
      setStoreAssets(results);
    } catch (err: any) {
      addLog('error', 'AssetStore', `Failed to query store: ${err.message}`);
    } finally {
      setIsLoadingStore(false);
    }
  };

  const handleSearchChange = async (val: string) => {
    setSearch(val);
    if (activeTab === 'store') {
      const results = await GDevelopAssetService.getInstance().searchAssets(val, storeCategory);
      setStoreAssets(results);
    }
  };

  const filteredLocal = localAssets.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

  const handleInstallStoreAsset = (asset: StoreAsset) => {
    const go = GDevelopAssetService.getInstance().installAssetToScene(asset, scene, [
      (Math.random() - 0.5) * 6,
      2,
      (Math.random() - 0.5) * 6
    ]);
    refreshScene();
    setInstalledAssetIds(prev => new Set(prev).add(asset.id));
    addLog('info', 'AssetStore', `Imported & spawned "${asset.name}" (${asset.polyCount}) into active scene.`);
  };

  const handleUnityPackageUpload = () => {
    const entries = GDevelopAssetService.getInstance().parseUnityPackageManifest('');
    setUnityManifest(entries);
    addLog('info', 'UnityImporter', `Decompressed .unitypackage containing ${entries.length} 3D assets & prefabs.`);
  };

  const getIcon = (type: AssetItem['type']) => {
    switch (type) {
      case 'model': return <FileBox className="w-5 h-5 text-blue-400" />;
      case 'script': return <FileCode className="w-5 h-5 text-emerald-400" />;
      case 'texture': return <ImageIcon className="w-5 h-5 text-pink-400" />;
      case 'audio': return <Music className="w-5 h-5 text-amber-400" />;
      case 'scene': return <Folder className="w-5 h-5 text-cyan-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-studio-surface select-none border-t border-studio-border">
      {/* Header with Tabs */}
      <div className="flex items-center justify-between p-2.5 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          {/* Tab Switcher */}
          <div className="flex items-center bg-zinc-900 border border-studio-border rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setActiveTab('project')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md transition-colors ${
                activeTab === 'project'
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
              <span>Project Assets</span>
            </button>
            <button
              onClick={() => setActiveTab('store')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md transition-colors ${
                activeTab === 'store'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>GDevelop & CC0 3D Store</span>
            </button>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder={activeTab === 'project' ? 'Search project assets...' : 'Search CC0 3D models...'}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="bg-zinc-900 border border-studio-border rounded pl-7 pr-2 py-1 text-xs text-white placeholder-gray-500 outline-none w-40 focus:w-56 transition-all"
            />
          </div>

          {activeTab === 'project' ? (
            <div className="flex items-center space-x-1.5">
              <button
                onClick={handleUnityPackageUpload}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-gray-200 text-xs border border-studio-border transition-colors"
                title="Decompress .unitypackage files"
              >
                <Package className="w-3 h-3 text-amber-400" />
                <span>Import .unitypackage</span>
              </button>
              <button
                onClick={() => addLog('info', 'Assets', 'Import file selector opened.')}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-gray-200 text-xs border border-studio-border transition-colors"
              >
                <Upload className="w-3 h-3" />
                <span>Import File</span>
              </button>
            </div>
          ) : (
            <button
              onClick={loadStoreCatalog}
              className="p-1 rounded text-gray-400 hover:text-white bg-zinc-800 border border-studio-border transition-colors"
              title="Refresh store catalog"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStore ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Store Category Sub-bar */}
      {activeTab === 'store' && (
        <div className="flex items-center space-x-2 p-2 bg-zinc-900/60 border-b border-studio-border overflow-x-auto text-[11px]">
          {[
            { id: 'all', label: 'All 3D Assets' },
            { id: 'characters', label: '3D Characters (Quaternius)' },
            { id: 'props', label: 'Props & Gates (Kenney)' },
            { id: 'vehicles', label: 'Vehicles' },
            { id: 'environment', label: 'Crystals & Nature' },
            { id: 'weapons', label: 'Weapons' },
            { id: 'skyboxes', label: 'Skyboxes & PBR (Poly Haven)' }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setStoreCategory(cat.id)}
              className={`px-2.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                storeCategory === cat.id
                  ? 'bg-purple-600 text-white font-medium'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-studio-border'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'project' ? (
          <div>
            {/* Unity Package Decompressed Notice */}
            {unityManifest && (
              <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between text-amber-300 font-semibold">
                  <div className="flex items-center space-x-1.5">
                    <Package className="w-4 h-4 text-amber-400" />
                    <span>Decompressed Unity Package Manifest</span>
                  </div>
                  <button
                    onClick={() => setUnityManifest(null)}
                    className="text-gray-400 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-gray-300 pt-1">
                  {unityManifest.map((entry, idx) => (
                    <div key={idx} className="bg-zinc-900/80 p-1.5 rounded border border-studio-border flex justify-between">
                      <span className="truncate">{entry.pathname}</span>
                      <span className="text-gray-500">{(entry.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Local Assets Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3 content-start">
              {filteredLocal.map(asset => (
                <div
                  key={asset.id}
                  onClick={() => {
                    setSelectedAsset(asset.id);
                    if (asset.type === 'model') {
                      addPrimitive('box');
                      addLog('info', 'Assets', `Instantiated asset ${asset.name} into scene.`);
                    }
                  }}
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
        ) : (
          /* Asset Store Cards Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 content-start">
            {storeAssets.map(asset => {
              const isInstalled = installedAssetIds.has(asset.id);
              return (
                <div
                  key={asset.id}
                  className="bg-zinc-900/80 border border-studio-border hover:border-purple-500/50 rounded-xl overflow-hidden flex flex-col justify-between transition-all group hover:shadow-lg hover:shadow-purple-900/20"
                >
                  {/* Card Thumbnail / Header */}
                  <div className="relative h-28 overflow-hidden bg-zinc-950">
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80 group-hover:opacity-100"
                    />
                    <div className="absolute top-2 left-2 flex items-center space-x-1">
                      <span className="bg-black/70 backdrop-blur-md text-[10px] font-semibold text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">
                        {asset.polyCount}
                      </span>
                      <span className="bg-black/70 backdrop-blur-md text-[10px] font-mono text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">
                        {asset.format}
                      </span>
                    </div>
                    <div className="absolute top-2 right-2">
                      <span className="bg-black/70 backdrop-blur-md text-[9px] text-gray-300 px-1.5 py-0.5 rounded border border-white/10">
                        {asset.license}
                      </span>
                    </div>
                  </div>

                  {/* Body Information */}
                  <div className="p-3 space-y-1.5 flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-200 truncate" title={asset.name}>
                        {asset.name}
                      </h4>
                      <span className="text-[10px] text-gray-400 font-medium">by {asset.author}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
                      {asset.description}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {asset.tags.slice(0, 3).map((tag, tIdx) => (
                        <span key={tIdx} className="text-[9px] bg-zinc-800 text-gray-400 px-1.5 py-0.2 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Footer Action Button */}
                  <div className="p-3 pt-0">
                    <button
                      onClick={() => handleInstallStoreAsset(asset)}
                      className={`w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all shadow-sm ${
                        isInstalled
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40'
                          : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20 active:scale-95'
                      }`}
                    >
                      {isInstalled ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Add Another Instance</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>Import to Scene</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
