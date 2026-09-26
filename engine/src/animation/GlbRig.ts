/**
 * Headless GLB rig parser (Track E.1, ADR-1790433500001).
 *
 * Reads rig + animation metadata from GLB binaries WITHOUT three.js, fetch,
 * or a GPU: joints (skin order), animation names/durations/channels. Pure
 * byte parsing — the headless proof half of the character pipeline
 * (retargeting consumes this + three AnimationClip tracks, see RigRetarget).
 */

export interface GlbJoint {
  index: number;
  name: string;
  children: number[];
}

export interface GlbAnimation {
  name: string;
  duration: number;
  channels: number;
  paths: string[];
  interpolations: string[];
}

export interface GlbRig {
  joints: GlbJoint[];
  animations: GlbAnimation[];
  skinCount: number;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] * 0x1000000)
  ) >>> 0;
}

function readF32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

/** Parse a GLB (bytes) into rig metadata. Throws on malformed input. */
export function parseGlbRig(data: Uint8Array): GlbRig {
  if (data.length < 12 || readAscii(data, 0, 4) !== 'glTF') {
    throw new Error('not a GLB file (bad magic)');
  }
  const version = readU32LE(data, 4);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);

  let offset = 12;
  let jsonChunk: Record<string, any> | null = null;
  let binChunk: Uint8Array | null = null;
  const totalLength = readU32LE(data, 8);
  while (offset + 8 <= Math.min(data.length, totalLength)) {
    const chunkLength = readU32LE(data, offset);
    const chunkType = readAscii(data, offset + 4, 4);
    const chunkData = data.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') {
      jsonChunk = JSON.parse(readAscii(chunkData, 0, chunkData.length));
    } else if (chunkType === 'BIN\x00') {
      binChunk = chunkData;
    }
    offset += 8 + chunkLength;
  }
  if (!jsonChunk) throw new Error('GLB has no JSON chunk');
  const json = jsonChunk;

  const nodes: any[] = Array.isArray(json.nodes) ? json.nodes : [];
  const joints: GlbJoint[] = [];
  const skins: any[] = Array.isArray(json.skins) ? json.skins : [];
  for (const skin of skins) {
    const jointIndices: number[] = Array.isArray(skin.joints) ? skin.joints : [];
    for (const jointIndex of jointIndices) {
      const node = nodes[jointIndex] || {};
      joints.push({
        index: jointIndex,
        name: typeof node.name === 'string' ? node.name : `joint_${jointIndex}`,
        children: Array.isArray(node.children) ? node.children.filter((c: unknown) => typeof c === 'number') : []
      });
    }
  }

  const bufferViews: any[] = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  const accessors: any[] = Array.isArray(json.accessors) ? json.accessors : [];

  function accessorMaxTime(accessorIndex: number): number {
    const accessor = accessors[accessorIndex];
    if (!accessor || typeof accessor.count !== 'number') return 0;
    // Fast path: accessor min/max (exporters like Blender write these).
    if (Array.isArray(accessor.max) && typeof accessor.max[0] === 'number') {
      return accessor.max[0];
    }
    // Slow path: read the float array from the BIN chunk.
    if (!binChunk || accessor.componentType !== 5126) return 0;
    const view = bufferViews[accessor.bufferView];
    if (!view) return 0;
    const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    let max = 0;
    for (let i = 0; i < accessor.count; i++) {
      const value = readF32LE(binChunk, base + i * 4);
      if (Number.isFinite(value) && value > max) max = value;
    }
    return max;
  }

  const animations: GlbAnimation[] = [];
  const animDefs: any[] = Array.isArray(json.animations) ? json.animations : [];
  for (const anim of animDefs) {
    const channels: any[] = Array.isArray(anim.channels) ? anim.channels : [];
    const samplers: any[] = Array.isArray(anim.samplers) ? anim.samplers : [];
    let duration = 0;
    const paths = new Set<string>();
    const interpolations = new Set<string>();
    for (const channel of channels) {
      const target = channel.target || {};
      if (typeof target.path === 'string') paths.add(target.path);
      const sampler = samplers[channel.sampler];
      if (sampler) {
        if (typeof sampler.interpolation === 'string') interpolations.add(sampler.interpolation);
        if (typeof sampler.input === 'number') {
          duration = Math.max(duration, accessorMaxTime(sampler.input));
        }
      }
    }
    animations.push({
      name: typeof anim.name === 'string' && anim.name ? anim.name : `anim_${animations.length}`,
      duration,
      channels: channels.length,
      paths: [...paths],
      interpolations: [...interpolations]
    });
  }

  return { joints, animations, skinCount: skins.length };
}
