import React, { useState, useEffect, useTransition } from 'react';
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
  RefreshCw,
  Eye,
  Tag,
  Boxes,
  Compass,
  Cpu,
  Zap,
  Info
} from 'lucide-react';
import {
  GDevelopAssetService,
  StoreAsset,
  GDevelopAssetPack,
  GDevelopFullAssetDetails
} from '../services/GDevelopAssetService';

export interface AssetItem {
  id: string;
  name: string;
  type: 'model' | 'script' | 'texture' | 'audio' | 'scene';
  size: string;
}

export const AssetBrowser: React.FC = () => {
  const { scene, refreshScene, addLog } = useStudio();
  const [activeTab, setActiveTab] = useState<'store' | 'packs' | 'project' | 'shop'>('store');
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<StoreAsset | null>(null);
  const [assetDetails, setAssetDetails] = useState<GDevelopFullAssetDetails | null>(null);

  // Store state
  const [storeCategory, setStoreCategory] = useState<string>('all');
  const [storeAssets, setStoreAssets] = useState<StoreAsset[]>([]);
  const [assetPacks, setAssetPacks] = useState<GDevelopAssetPack[]>([]);
  const [isLoadingStore, setIsLoadingStore] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedAssetIds, setInstalledAssetIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

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

  // Initial load
  useEffect(() => {
    loadStoreCatalog();
    loadPacksCatalog();
  }, []);

  // Filter on category / search change
  useEffect(() => {
    if (activeTab === 'store') {
      const timer = setTimeout(() => {
        loadStoreCatalog();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [storeCategory, search, activeTab]);

  const loadStoreCatalog = async () => {
    setIsLoadingStore(true);
    try {
      const results = await GDevelopAssetService.getInstance().searchAssets({
        query: search,
        category: storeCategory,
        only3D: true,
        limit: 120
      });
      setStoreAssets(results);
    } catch (err: any) {
      addLog('error', 'AssetStore', `Failed to query store: ${err.message}`);
    } finally {
      setIsLoadingStore(false);
    }
  };

  const loadPacksCatalog = async () => {
    try {
      const packs = await GDevelopAssetService.getInstance().fetchLivePacks();
      setAssetPacks(packs);
    } catch {
      // Ignore
    }
  };

  const handleInstallStoreAsset = async (asset: StoreAsset, customPos?: [number, number, number]) => {
    setInstallingId(asset.id);
    try {
      const spawnPos: [number, number, number] = customPos || [
        (Math.random() - 0.5) * 6,
        1.5,
        (Math.random() - 0.5) * 6
      ];
      await GDevelopAssetService.getInstance().installAssetToScene(asset, scene, spawnPos);
      refreshScene();
      setInstalledAssetIds(prev => new Set(prev).add(asset.id));
      addLog('info', 'AssetStore', `Imported & spawned 3D asset "${asset.name}" (${asset.polyCount}) into active scene.`);
    } catch (err: any) {
      addLog('error', 'AssetStore', `Failed to install asset "${asset.name}": ${err.message}`);
    } finally {
      setInstallingId(null);
    }
  };

  const handleInspectAsset = async (asset: StoreAsset) => {
    setSelectedAsset(asset);
    setAssetDetails(null);
    if (asset.id && !asset.id.startsWith('quaternius-') && !asset.id.startsWith('kenney-')) {
      const details = await GDevelopAssetService.getInstance().getAssetDetails(asset.id);
      setAssetDetails(details);
    }
  };

  const handleDragStart = (e: React.DragEvent, asset: StoreAsset) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'gdevelop-asset',
      asset
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const categories = [
    { id: 'all', label: 'All 3D Models' },
    { id: 'characters', label: 'Characters & Heroes' },
    { id: 'monsters', label: 'Dinosaurs & Monsters' },
    { id: 'vehicles', label: 'Vehicles & Mechs' },
    { id: 'weapons', label: 'Weapons & Armor' },
    { id: 'environment', label: 'Nature & Buildings' },
    { id: 'props', label: 'Loot & Props' }
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-gray-200 select-none overflow-hidden font-sans border-t border-zinc-800">
      {/* Top Header & Tab Switcher */}
      <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('store')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
              activeTab === 'store'
                ? 'bg-blue-600 text-white shadow'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-blue-300" />
            <span>GDevelop 3D Store</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-blue-700/60 rounded text-blue-200">5.4k+</span>
          </button>

          <button
            onClick={() => setActiveTab('packs')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
              activeTab === 'packs'
                ? 'bg-purple-600 text-white shadow'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Package className="w-3.5 h-3.5 text-purple-300" />
            <span>Starter Packs ({assetPacks.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('shop')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
              activeTab === 'shop'
                ? 'bg-amber-600 text-white shadow'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5 text-amber-300" />
            <span>GDevelop Premium Shop</span>
          </button>

          <button
            onClick={() => setActiveTab('project')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
              activeTab === 'project'
                ? 'bg-zinc-800 text-white shadow'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Folder className="w-3.5 h-3.5 text-yellow-400" />
            <span>Project Files</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={activeTab === 'store' ? 'Search 5,433+ 3D models...' : 'Filter assets...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-56 h-7 pl-8 pr-3 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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

          <button
            onClick={loadStoreCatalog}
            title="Refresh Catalog"
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStore ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sub-bar: Category Chips (Only for GDevelop 3D Store) */}
      {activeTab === 'store' && (
        <div className="h-8 bg-zinc-900/60 border-b border-zinc-800 flex items-center px-3 space-x-1.5 overflow-x-auto scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setStoreCategory(cat.id)}
              className={`px-2.5 py-0.5 rounded text-xs whitespace-nowrap transition-colors ${
                storeCategory === cat.id
                  ? 'bg-zinc-700 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
          <div className="ml-auto text-[11px] text-zinc-400 flex items-center space-x-1 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            <span>Live GDevelop.io CDN</span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Tab 1: Live GDevelop 3D Store */}
        {activeTab === 'store' && (
          <div>
            {isLoadingStore && storeAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3 text-zinc-400">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <p className="text-xs">Querying GDevelop.io 3D Database...</p>
              </div>
            ) : storeAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-2 text-zinc-500">
                <Boxes className="w-8 h-8 text-zinc-600" />
                <p className="text-sm font-medium">No 3D models matching "{search}"</p>
                <p className="text-xs">Try searching for "dinosaur", "character", "tree", "car", or "chest".</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {storeAssets.map(asset => {
                  const isInstalled = installedAssetIds.has(asset.id);
                  const isInstalling = installingId === asset.id;

                  return (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={e => handleDragStart(e, asset)}
                      className="group flex flex-col bg-zinc-900 border border-zinc-800 hover:border-blue-500 rounded-lg overflow-hidden transition-all duration-150 hover:shadow-lg hover:shadow-blue-500/10 cursor-grab active:cursor-grabbing"
                    >
                      {/* Thumbnail Container */}
                      <div className="relative aspect-square w-full bg-zinc-950 overflow-hidden flex items-center justify-center">
                        <img
                          src={asset.thumbnail}
                          alt={asset.name}
                          loading="lazy"
                          className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-200"
                        />
                        {/* 3D Badge */}
                        <span className="absolute top-1.5 left-1.5 bg-black/70 backdrop-blur text-[10px] text-blue-300 px-1.5 py-0.5 rounded font-mono font-medium border border-blue-500/30">
                          3D GLB
                        </span>
                        {/* Animations count */}
                        {asset.animationsCount && asset.animationsCount > 0 ? (
                          <span className="absolute top-1.5 right-1.5 bg-emerald-950/80 backdrop-blur text-[10px] text-emerald-300 px-1.5 py-0.5 rounded font-mono border border-emerald-500/30">
                            {asset.animationsCount} Anims
                          </span>
                        ) : null}
                        {/* Hover Overlay Actions */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 p-2">
                          <button
                            onClick={() => handleInspectAsset(asset)}
                            title="Inspect 3D Details"
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded shadow text-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleInstallStoreAsset(asset)}
                            disabled={isInstalling}
                            title="Instantiate into 3D Scene"
                            className="flex items-center space-x-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded shadow text-xs font-medium"
                          >
                            {isInstalling ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : isInstalled ? (
                              <CheckCircle className="w-3 h-3 text-emerald-300" />
                            ) : (
                              <Plus className="w-3 h-3" />
                            )}
                            <span>{isInstalling ? 'Loading' : isInstalled ? 'Added' : 'Add'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Info Container */}
                      <div className="p-2 flex flex-col justify-between flex-1">
                        <div>
                          <div className="text-xs font-semibold text-zinc-100 truncate" title={asset.name}>
                            {asset.name}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                            {asset.author}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-1 border-t border-zinc-800/80 text-[10px] text-zinc-400">
                          <span className="text-emerald-400 font-mono font-medium">CC0 Free</span>
                          <span className="text-zinc-500 truncate max-w-[65px]">{asset.polyCount}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Asset Packs & Bundles */}
        {activeTab === 'packs' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {assetPacks.map((pack, idx) => (
              <div
                key={idx}
                className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col hover:border-purple-500 transition-colors"
              >
                <div className="h-32 bg-zinc-950 relative overflow-hidden flex items-center justify-center">
                  <img
                    src={pack.thumbnailUrl}
                    alt={pack.name}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-2 left-2 bg-black/70 backdrop-blur text-[10px] text-purple-300 px-2 py-0.5 rounded font-mono">
                    {pack.assetsCount} Assets
                  </span>
                </div>
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">{pack.name}</h3>
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                      Official starter collection with ready-to-use models and physics components.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {pack.categories.map((c, i) => (
                        <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 pt-2 border-t border-zinc-800 flex items-center justify-between">
                    <span className="text-xs text-purple-400 font-mono font-medium">
                      {pack.userFriendlyPrice || 'Free Pack'}
                    </span>
                    <button
                      onClick={() => {
                        setSearch(pack.tag || pack.name);
                        setActiveTab('store');
                      }}
                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-medium"
                    >
                      Browse Assets
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: GDevelop Shop (Premium) */}
        {activeTab === 'shop' && (
          <div className="max-w-4xl mx-auto space-y-4 py-2">
            <div className="p-4 bg-gradient-to-r from-amber-950/40 via-zinc-900 to-zinc-900 border border-amber-500/30 rounded-lg flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <ShoppingBag className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold text-amber-300">GDevelop Commercial Asset Store</h3>
                </div>
                <p className="text-xs text-zinc-300">
                  Import AAA game-ready characters, environmental kits, and sound packs directly into Heretek Studio.
                </p>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <button
                  onClick={() => window.open('https://gdevelop.io/shop', '_blank')}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium shadow"
                >
                  <span>Open Web Shop</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                {
                  title: 'Genshin Style Anime Character Pack',
                  author: 'Studio Heretek Art',
                  price: '$14.99',
                  thumb: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=400&q=80',
                  items: '4 Rigged Characters + Cel Shaders + 32 Animations'
                },
                {
                  title: 'Open World Sci-Fi Mech & Hover Kit',
                  author: 'CyberForge',
                  price: '$19.99',
                  thumb: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80',
                  items: '6 Combat Mechs + Modular Cockpits + SFX'
                },
                {
                  title: 'Modular Fantasy Dungeon & Bosses',
                  author: 'PolyQuest',
                  price: '$12.50',
                  thumb: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&q=80',
                  items: '120 Modular Tiles + 4 Animated Bosses'
                }
              ].map((prod, idx) => (
                <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
                  <div className="h-36 bg-zinc-950 overflow-hidden relative">
                    <img src={prod.thumb} alt={prod.title} className="w-full h-full object-cover" />
                    <span className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded">
                      {prod.price}
                    </span>
                  </div>
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-semibold text-zinc-100">{prod.title}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">By {prod.author}</div>
                      <p className="text-[11px] text-zinc-300 mt-2">{prod.items}</p>
                    </div>
                    <button
                      onClick={() => addLog('info', 'AssetStore', `Simulated purchase authorized for "${prod.title}". Assets unlocked.`)}
                      className="mt-3 w-full py-1.5 bg-amber-600/80 hover:bg-amber-600 text-white rounded text-xs font-medium"
                    >
                      Authorize & Install
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Local Project Assets */}
        {activeTab === 'project' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {localAssets
                .filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()))
                .map(file => (
                  <div
                    key={file.id}
                    className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 flex flex-col items-center text-center cursor-pointer transition-colors"
                  >
                    {file.type === 'model' && <FileBox className="w-8 h-8 text-blue-400 mb-1" />}
                    {file.type === 'script' && <FileCode className="w-8 h-8 text-emerald-400 mb-1" />}
                    {file.type === 'texture' && <ImageIcon className="w-8 h-8 text-purple-400 mb-1" />}
                    {file.type === 'audio' && <Music className="w-8 h-8 text-amber-400 mb-1" />}
                    {file.type === 'scene' && <Layers className="w-8 h-8 text-red-400 mb-1" />}
                    <div className="text-xs font-medium text-zinc-200 truncate w-full mt-1" title={file.name}>
                      {file.name}
                    </div>
                    <div className="text-[10px] text-zinc-500">{file.size}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Asset Inspection & Turntable Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">{selectedAsset.name}</h3>
                <p className="text-xs text-zinc-400">{selectedAsset.author} • {selectedAsset.license}</p>
              </div>
              <button
                onClick={() => setSelectedAsset(null)}
                className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              <div className="h-56 bg-zinc-950 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-800">
                <img
                  src={selectedAsset.thumbnail}
                  alt={selectedAsset.name}
                  className="max-h-full max-w-full object-contain p-2"
                />
              </div>

              <div className="space-y-2 text-xs">
                <p className="text-zinc-300">{selectedAsset.description}</p>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800">
                  <div className="p-2 bg-zinc-950 rounded">
                    <span className="text-zinc-500 block">Format & Complexity</span>
                    <span className="text-zinc-200 font-mono font-medium">{selectedAsset.format} • {selectedAsset.polyCount}</span>
                  </div>
                  <div className="p-2 bg-zinc-950 rounded">
                    <span className="text-zinc-500 block">Physics Preset</span>
                    <span className="text-zinc-200 font-mono font-medium">Rapier3D Dynamic Rig</span>
                  </div>
                </div>

                {assetDetails?.modelUrl && (
                  <div className="p-2 bg-blue-950/40 border border-blue-800/40 rounded text-[11px] text-blue-200 font-mono break-all">
                    glTF Source: {assetDetails.modelUrl}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
              <span className="text-xs text-emerald-400 font-medium">Verified Compatible with Three.js & Rapier3D</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleInstallStoreAsset(selectedAsset);
                    setSelectedAsset(null);
                  }}
                  className="flex items-center space-x-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Instantiate in Scene</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
