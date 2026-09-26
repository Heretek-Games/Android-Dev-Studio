import * as THREE from 'three';

/**
 * Data-level animation retargeting (Track E.1, ADR-1790433500001).
 *
 * Remaps three.js AnimationClip tracks from a source rig to a target rig by
 * joint NAME (`Hips.quaternion` -> `Pelvis.quaternion`). Operates on clip
 * data only — no SkeletonHelpers, no GLTFLoader fetch, no GPU — so it runs
 * headless in Node and in the QA runner.
 *
 * Phase-1 scope: pure rename remap (matching rest-orientation conventions).
 * Rest-pose offset retargeting, scale compensation, and CUBICSPLINE resampling
 * are explicitly deferred (STEP/LINEAR pass through untouched).
 */

export type RetargetMap = Record<string, string>;

export interface RetargetResult {
  clip: THREE.AnimationClip;
  /** Source tracks with no map entry (dropped or kept per options). */
  dropped: string[];
}

/** Split "NodeName.property" (node names may contain dots; property is known). */
export function splitTrackName(trackName: string): { node: string; property: string } | null {
  const properties = [
    'position', 'quaternion', 'scale', 'morphTargetInfluences'
  ];
  for (const property of properties) {
    const suffix = `.${property}`;
    if (trackName.endsWith(suffix) && trackName.length > suffix.length) {
      return { node: trackName.slice(0, -suffix.length), property };
    }
  }
  return null;
}

/**
 * Remap a clip's tracks through a source->target joint map.
 * Unknown properties fail loudly; unmapped joints are dropped by default
 * (reported) or kept with `dropUnmapped: false`.
 */
export function retargetClip(
  clip: THREE.AnimationClip,
  map: RetargetMap,
  options?: { dropUnmapped?: boolean; targetName?: string }
): RetargetResult {
  const dropUnmapped = options?.dropUnmapped ?? true;
  const dropped: string[] = [];
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const split = splitTrackName(track.name);
    if (!split) {
      throw new Error(`retarget: unparseable track name '${track.name}'`);
    }
    const targetJoint = map[split.node];
    if (targetJoint === undefined) {
      dropped.push(track.name);
      if (!dropUnmapped) tracks.push(track.clone());
      continue;
    }
    const renamed = track.clone();
    renamed.name = `${targetJoint}.${split.property}`;
    tracks.push(renamed);
  }

  const out = new THREE.AnimationClip(
    options?.targetName ?? `${clip.name}_retargeted`,
    clip.duration,
    tracks
  );
  return { clip: out, dropped };
}

/** Joint-name coverage of a clip against a map (audit helper, 0..1). */
export function retargetCoverage(clip: THREE.AnimationClip, map: RetargetMap): number {
  if (clip.tracks.length === 0) return 1;
  let covered = 0;
  for (const track of clip.tracks) {
    const split = splitTrackName(track.name);
    if (split && map[split.node] !== undefined) covered++;
  }
  return covered / clip.tracks.length;
}
