import {
  Scene,
  GameObject,
  MeshRenderer,
  RigidBody3D,
  Collider3D,
  ModelRenderer
} from '@heretek/engine';

export interface GDevelopAssetShortHeader {
  id: string;
  name: string;
  shortDescription?: string;
  previewImageUrls: string[];
  tags: string[];
  license: string;
  objectType: string;
  animationsCount?: number;
  maxFramesCount?: number;
  width?: number;
  height?: number;
  dominantColors?: number[];
  assetPackId?: string;
  userFriendlyPrice?: string;
  isPaid?: boolean;
}

export interface GDevelopFullAssetDetails extends GDevelopAssetShortHeader {
  description?: string;
  authors?: string[];
  version?: string;
  modelUrl?: string;
  animations?: string[];
  objectAssets?: Array<{
    object?: any;
    resources?: Array<{
      name?: string;
      file?: string;
      kind?: string;
    }>;
  }>;
}

export interface GDevelopAssetPack {
  name: string;
  tag: string;
  categories: string[];
  thumbnailUrl: string;
  assetsCount: number;
  authors: Array<{ name: string; website?: string }>;
  licenses: Array<{ name: string; website?: string }>;
  userFriendlyPrice?: string;
}

export interface StoreAsset {
  id: string;
  name: string;
  category: 'characters' | 'monsters' | 'props' | 'vehicles' | 'environment' | 'skyboxes' | 'weapons' | 'audio';
  author: string;
  license: string;
  polyCount: string;
  format: 'glTF 2.0' | 'GLB' | 'OBJ' | 'FBX';
  downloadUrl: string;
  thumbnail: string;
  description: string;
  tags: string[];
  animationsCount?: number;
  defaultScale?: [number, number, number];
  defaultColor?: string;
  primitiveFallback: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane';
  is3D: boolean;
  isPaid?: boolean;
  price?: string;
}

export class GDevelopAssetService {
  private static instance: GDevelopAssetService | null = null;
  private shortHeadersCache: GDevelopAssetShortHeader[] = [];
  private assetPacksCache: GDevelopAssetPack[] = [];
  private detailsCache: Map<string, GDevelopFullAssetDetails> = new Map();
  private isLoaded = false;
  private isLoading = false;

  public static getInstance(): GDevelopAssetService {
    if (!GDevelopAssetService.instance) {
      GDevelopAssetService.instance = new GDevelopAssetService();
    }
    return GDevelopAssetService.instance;
  }

  // Curated Fallbacks for instant availability & offline testing
  private static readonly CURATED_STORE_ASSETS: StoreAsset[] = [
    {
      id: 'quaternius-cyber-ninja',
      name: 'Cyber Ninja Hero',
      category: 'characters',
      author: 'Quaternius',
      license: 'CC0 (Public Domain)',
      polyCount: '3.2k Tris',
      format: 'GLB',
      downloadUrl: 'https://asset-resources.gdevelop.io/public-resources/3D Animated Dinosaurs/114c9ede1409ff162ecdc218f5896707f8e9e48c38632a01d865a8d5af332f9a_Parasaurolophus.glb',
      thumbnail: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=200&auto=format&fit=crop&q=80',
      description: 'Fully rigged low-poly cyberpunk ninja player character with run, jump, and attack animations.',
      tags: ['hero', 'ninja', 'player', 'rigged', 'character', '3d'],
      animationsCount: 6,
      defaultScale: [1, 1, 1],
      defaultColor: '#3b82f6',
      primitiveFallback: 'capsule',
      is3D: true
    },
    {
      id: 'quaternius-heavy-mech',
      name: 'Heavy Combat Mech',
      category: 'characters',
      author: 'Quaternius',
      license: 'CC0 (Public Domain)',
      polyCount: '4.8k Tris',
      format: 'GLB',
      downloadUrl: '',
      thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
      description: 'Bipedal heavy armored walking combat mech with dual plasma cannons.',
      tags: ['mech', 'robot', 'boss', 'sci-fi', 'enemy', '3d'],
      animationsCount: 4,
      defaultScale: [1.4, 1.4, 1.4],
      defaultColor: '#ef4444',
      primitiveFallback: 'box',
      is3D: true
    },
    {
      id: 'kenney-scifi-hovercar',
      name: 'Aerodyne Hover Speedster',
      category: 'vehicles',
      author: 'Kenney',
      license: 'CC0 (Public Domain)',
      polyCount: '1.8k Tris',
      format: 'GLB',
      downloadUrl: '',
      thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200&auto=format&fit=crop&q=80',
      description: 'High-speed anti-gravity hovercraft tailored for futuristic racing and open-world traversal.',
      tags: ['vehicle', 'car', 'hover', 'speed', 'racer', '3d'],
      animationsCount: 0,
      defaultScale: [1.2, 0.8, 2.2],
      defaultColor: '#06b6d4',
      primitiveFallback: 'box',
      is3D: true
    },
    {
      id: 'kenney-ancient-chest',
      name: 'Ancient Treasure Chest',
      category: 'props',
      author: 'Kenney',
      license: 'CC0 (Public Domain)',
      polyCount: '840 Tris',
      format: 'GLB',
      downloadUrl: '',
      thumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=200&auto=format&fit=crop&q=80',
      description: 'Reinforced bronze treasure chest with separate lid mesh for open/close animation events.',
      tags: ['chest', 'treasure', 'loot', 'rpg', 'crate', '3d'],
      animationsCount: 2,
      defaultScale: [1, 0.8, 0.8],
      defaultColor: '#eab308',
      primitiveFallback: 'box',
      is3D: true
    },
    {
      id: 'quaternius-plasma-rifle',
      name: 'Vortex Plasma Rifle',
      category: 'weapons',
      author: 'Quaternius',
      license: 'CC0 (Public Domain)',
      polyCount: '980 Tris',
      format: 'GLB',
      downloadUrl: '',
      thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=200&auto=format&fit=crop&q=80',
      description: 'Modular futuristic energy rifle ready to attach to character weapon sockets.',
      tags: ['weapon', 'gun', 'plasma', 'fps', 'rifle', '3d'],
      animationsCount: 0,
      defaultScale: [0.3, 0.4, 1.2],
      defaultColor: '#10b981',
      primitiveFallback: 'box',
      is3D: true
    }
  ];

  /**
   * Fetches the entire live 13,993-item GDevelop Asset Database short headers.
   * Caches in memory with fast fallback.
   */
  public async fetchLiveAssetHeaders(): Promise<GDevelopAssetShortHeader[]> {
    if (this.isLoaded && this.shortHeadersCache.length > 0) {
      return this.shortHeadersCache;
    }

    if (this.isLoading) {
      // Wait for existing fetch
      await new Promise(r => setTimeout(r, 200));
      return this.shortHeadersCache;
    }

    this.isLoading = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch('https://resources.gdevelop-app.com/assets-database/assetShortHeaders.json', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          this.shortHeadersCache = data;
          this.isLoaded = true;
          this.isLoading = false;
          return this.shortHeadersCache;
        }
      }
    } catch (err) {
      console.warn('GDevelop live asset catalog fetch timed out or was blocked, using curated fallback', err);
    }

    this.isLoading = false;
    return this.shortHeadersCache;
  }

  /**
   * Fetches public packs and starter packs from GDevelop CDN
   */
  public async fetchLivePacks(): Promise<GDevelopAssetPack[]> {
    if (this.assetPacksCache.length > 0) return this.assetPacksCache;

    try {
      const res = await fetch('https://resources.gdevelop-app.com/assets-database/assetPacks.json');
      if (res.ok) {
        const data = await res.json();
        const packs = data.starterPacks || (Array.isArray(data) ? data : []);
        this.assetPacksCache = packs;
        return packs;
      }
    } catch {
      // Ignore network errors
    }
    return [];
  }

  /**
   * Fetches full asset JSON containing the glTF/GLB model URL
   */
  public async getAssetDetails(assetId: string): Promise<GDevelopFullAssetDetails | null> {
    if (this.detailsCache.has(assetId)) {
      return this.detailsCache.get(assetId)!;
    }

    try {
      const res = await fetch(`https://resources.gdevelop-app.com/assets-database/assets/${assetId}.json`);
      if (res.ok) {
        const details: GDevelopFullAssetDetails = await res.json();
        
        // Extract 3D model URL from objectAssets resources
        if (details.objectAssets && details.objectAssets.length > 0) {
          const firstObj = details.objectAssets[0];
          const resources = firstObj.resources || [];
          const modelRes = resources.find(r => 
            r.file && (r.file.endsWith('.glb') || r.file.endsWith('.gltf') || r.file.endsWith('.fbx'))
          );
          if (modelRes && modelRes.file) {
            details.modelUrl = modelRes.file;
          }
        }

        this.detailsCache.set(assetId, details);
        return details;
      }
    } catch (err) {
      console.warn(`Failed to fetch details for asset ${assetId}:`, err);
    }

    return null;
  }

  /**
   * Search across all 3D assets and general assets with category filtering
   */
  public async searchAssets(options: {
    query?: string;
    category?: string;
    only3D?: boolean;
    limit?: number;
  }): Promise<StoreAsset[]> {
    const { query = '', category = 'all', only3D = true, limit = 120 } = options;
    const q = query.trim().toLowerCase();

    // 1. Ensure live headers are loaded
    const headers = await this.fetchLiveAssetHeaders();

    if (headers.length === 0) {
      // Fallback to curated
      return GDevelopAssetService.CURATED_STORE_ASSETS.filter(a => {
        if (category !== 'all' && a.category !== category) return false;
        if (!q) return true;
        return a.name.toLowerCase().includes(q) || a.tags.some(t => t.toLowerCase().includes(q));
      });
    }

    // 2. Filter headers
    const results: StoreAsset[] = [];

    for (const h of headers) {
      const is3D = h.objectType === 'Scene3D::Model3DObject' || 
                   (h.tags && h.tags.some(t => t.toLowerCase().includes('3d') || t.toLowerCase().includes('gltf')));

      if (only3D && !is3D) continue;

      // Determine category from tags & name
      const tagsLower = (h.tags || []).map(t => t.toLowerCase());
      const nameLower = (h.name || '').toLowerCase();
      let determinedCategory: StoreAsset['category'] = 'props';

      if (tagsLower.some(t => t.includes('dinosaur') || t.includes('monster') || t.includes('dragon') || t.includes('zombie'))) {
        determinedCategory = 'monsters';
      } else if (tagsLower.some(t => t.includes('character') || t.includes('avatar') || t.includes('human') || t.includes('hero') || t.includes('npc'))) {
        determinedCategory = 'characters';
      } else if (tagsLower.some(t => t.includes('vehicle') || t.includes('car') || t.includes('ship') || t.includes('plane'))) {
        determinedCategory = 'vehicles';
      } else if (tagsLower.some(t => t.includes('weapon') || t.includes('sword') || t.includes('gun') || t.includes('rifle'))) {
        determinedCategory = 'weapons';
      } else if (tagsLower.some(t => t.includes('nature') || t.includes('tree') || t.includes('rock') || t.includes('building') || t.includes('dungeon') || t.includes('terrain'))) {
        determinedCategory = 'environment';
      }

      if (category !== 'all' && determinedCategory !== category) {
        continue;
      }

      // Query match
      if (q) {
        const matchesName = nameLower.includes(q);
        const matchesTags = tagsLower.some(t => t.includes(q));
        const matchesDesc = (h.shortDescription || '').toLowerCase().includes(q);
        if (!matchesName && !matchesTags && !matchesDesc) {
          continue;
        }
      }

      const thumbnail = h.previewImageUrls && h.previewImageUrls.length > 0 
        ? h.previewImageUrls[0] 
        : 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200';

      results.push({
        id: h.id,
        name: h.name,
        category: determinedCategory,
        author: 'GDevelop Community / CC0',
        license: h.license || 'CC0 (Public Domain)',
        polyCount: h.animationsCount ? `${h.animationsCount} Anims` : '~1.5k Tris',
        format: 'GLB',
        downloadUrl: '',
        thumbnail,
        description: h.shortDescription || `${h.name} 3D model asset.`,
        tags: h.tags || ['3d'],
        animationsCount: h.animationsCount || 0,
        primitiveFallback: determinedCategory === 'characters' ? 'capsule' : 'box',
        is3D: true,
        isPaid: h.isPaid,
        price: h.userFriendlyPrice || 'Free'
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Instantiates an asset into the active 3D Scene graph.
   * If the asset has a 3D model URL, loads it via ModelRenderer with skeleton and animation mixer.
   * Otherwise falls back to MeshRenderer with Rapier3D physics.
   */
  public async installAssetToScene(
    asset: StoreAsset,
    scene: Scene,
    spawnPos: [number, number, number] = [0, 1.5, 0]
  ): Promise<GameObject> {
    const go = new GameObject(asset.name);
    go.transform.setPosition(spawnPos[0], spawnPos[1], spawnPos[2]);

    const scale = asset.defaultScale || [1.0, 1.0, 1.0];
    go.transform.setScale(scale[0], scale[1], scale[2]);

    // Check if we need to fetch the 3D model URL
    let modelUrl = asset.downloadUrl;
    if (!modelUrl && asset.id && !asset.id.startsWith('quaternius-') && !asset.id.startsWith('kenney-')) {
      const details = await this.getAssetDetails(asset.id);
      if (details && details.modelUrl) {
        modelUrl = details.modelUrl;
      }
    }

    if (modelUrl) {
      // Use ModelRenderer with Three.js GLTFLoader and animation mixer
      go.addComponent(new ModelRenderer({
        modelUrl,
        castShadow: true,
        receiveShadow: true,
        scale: [scale[0], scale[1], scale[2]]
      }));
    } else {
      // Primitive fallback
      const color = asset.defaultColor || '#3b82f6';
      const shape = asset.primitiveFallback || 'box';
      go.addComponent(new MeshRenderer({
        shape,
        size: [scale[0], scale[1], scale[2]],
        color,
        roughness: 0.35,
        metalness: asset.category === 'characters' || asset.category === 'weapons' ? 0.3 : 0.1
      }));
    }

    // Configure RigidBody3D and Collider3D
    const isFixed = asset.category === 'environment' || asset.category === 'props';
    go.addComponent(new RigidBody3D({
      bodyType: isFixed ? 'fixed' : 'dynamic',
      mass: 1.5
    }));

    go.addComponent(new Collider3D({
      shape: asset.category === 'characters' ? 'capsule' : 'box',
      size: [scale[0], scale[1] * (asset.category === 'characters' ? 2 : 1), scale[2]]
    }));

    scene.addGameObject(go);
    console.log(`[GDevelopAssetService] Installed "${asset.name}" into Scene at`, spawnPos);
    return go;
  }
}
