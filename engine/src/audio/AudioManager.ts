/**
 * Audio manager: clip registry, voice tracking, master volume, and spatial
 * attenuation. All math is pure and headless-tested; playback itself is delegated
 * to an `AudioBackend` (WebAudio in the browser, a recording null backend in
 * headless runs/tests).
 */

import type { AudioBackend, PlayRequest } from './AudioBackend.js';
import { NullAudioBackend } from './AudioBackend.js';
import { WebAudioBackend } from './WebAudioBackend.js';
import type { AudioMixer } from './AudioMixer.js';

export interface PlayOptions {
  /** Per-play base volume (0..1). */
  volume?: number;
  loop?: boolean;
  /** Attenuate by distance to the listener. */
  spatial?: boolean;
  /** Distance (world units) where attenuation starts. */
  refDistance?: number;
  /** Distance (world units) where the voice becomes silent. */
  maxDistance?: number;
  /** Mixer bus routing (requires setMixer; unmixed voices ignore it). */
  bus?: string;
}

interface VoiceState {
  clipId: string;
  baseVolume: number;
  loop: boolean;
  spatial: boolean;
  refDistance: number;
  maxDistance: number;
  position: [number, number, number];
  bus?: string;
}

const DEFAULT_REF_DISTANCE = 5;
const DEFAULT_MAX_DISTANCE = 40;

export class AudioManager {
  private readonly backend: AudioBackend;
  private readonly clips = new Set<string>();
  private readonly voices = new Map<number, VoiceState>();
  private readonly warnedMissing = new Set<string>();
  private masterVolume = 1;
  private listener: [number, number, number] = [0, 0, 0];
  private mixer: AudioMixer | null = null;

  public constructor(backend?: AudioBackend) {
    this.backend = backend ?? (WebAudioBackend.isSupported() ? new WebAudioBackend() : new NullAudioBackend());
  }

  /** The active backend (useful for assertions in tests and headless runs). */
  public getBackend(): AudioBackend {
    return this.backend;
  }

  public async registerClip(clipId: string, source?: string | ArrayBuffer): Promise<void> {
    this.clips.add(clipId);
    if (source !== undefined) {
      await this.backend.load(clipId, source);
    }
  }

  public hasClip(clipId: string): boolean {
    return this.clips.has(clipId);
  }

  /** Start a clip; returns the voice id, or null when the clip is unknown/unloaded. */
  public play(clipId: string, options: PlayOptions = {}): number | null {
    if (!this.clips.has(clipId)) {
      if (!this.warnedMissing.has(clipId)) {
        this.warnedMissing.add(clipId);
        console.warn(`[AudioManager] play("${clipId}") ignored — clip not registered`);
      }
      return null;
    }

    const state: VoiceState = {
      clipId,
      baseVolume: options.volume ?? 1,
      loop: options.loop ?? false,
      spatial: options.spatial ?? false,
      refDistance: options.refDistance ?? DEFAULT_REF_DISTANCE,
      maxDistance: options.maxDistance ?? DEFAULT_MAX_DISTANCE,
      position: [0, 0, 0],
      bus: options.bus,
    };
    const request: PlayRequest = { volume: this.voiceVolume(state), loop: state.loop };
    const voiceId = this.backend.play(clipId, request);
    if (voiceId === null) return null;
    this.voices.set(voiceId, state);
    return voiceId;
  }

  public stop(voiceId: number): void {
    this.backend.stop(voiceId);
    this.voices.delete(voiceId);
  }

  public stopAll(): void {
    this.backend.stopAll();
    this.voices.clear();
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume);
    for (const [voiceId, state] of this.voices) {
      this.backend.setVolume(voiceId, this.voiceVolume(state));
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  /** Attaches a mixer (null detaches; unmixed voices compute as before). */
  public setMixer(mixer: AudioMixer | null): void {
    this.mixer = mixer;
    this.refreshVoiceVolumes();
  }

  public getMixer(): AudioMixer | null {
    return this.mixer;
  }

  /**
   * Advances mixer fades/ducks and re-pushes backend volumes. `activity`
   * maps bus name -> voice-active; omitted entries read as inactive.
   * Call once per frame when a mixer is attached (no-op otherwise).
   */
  public update(deltaTime: number, activity: Record<string, boolean> = {}): void {
    if (!this.mixer) return;
    this.mixer.update(deltaTime, this.voiceActivity(activity));
    this.refreshVoiceVolumes();
  }

  /** Live voice presence per bus, merged over explicit activity hints. */
  private voiceActivity(hints: Record<string, boolean>): Record<string, boolean> {
    const activity: Record<string, boolean> = { ...hints };
    for (const state of this.voices.values()) {
      if (state.bus) activity[state.bus] = true;
    }
    return activity;
  }

  private refreshVoiceVolumes(): void {
    for (const [voiceId, state] of this.voices) {
      this.backend.setVolume(voiceId, this.voiceVolume(state));
    }
  }

  public setListenerPosition(x: number, y: number, z: number): void {
    this.listener = [x, y, z];
  }

  /** Update a voice's world position (called by spatial `AudioSource`s each frame). */
  public updateVoicePosition(voiceId: number, x: number, y: number, z: number): void {
    const state = this.voices.get(voiceId);
    if (!state) return;
    state.position = [x, y, z];
    this.backend.setVolume(voiceId, this.voiceVolume(state));
  }

  public getVoiceCount(): number {
    return this.voices.size;
  }

  public dispose(): void {
    this.backend.dispose();
    this.voices.clear();
    this.clips.clear();
  }

  /** Linear rolloff: 1 inside refDistance, 0 beyond maxDistance. */
  public static attenuation(distance: number, refDistance: number, maxDistance: number): number {
    if (maxDistance <= refDistance) return distance <= refDistance ? 1 : 0;
    if (distance <= refDistance) return 1;
    if (distance >= maxDistance) return 0;
    return 1 - (distance - refDistance) / (maxDistance - refDistance);
  }

  private voiceVolume(state: VoiceState): number {
    let volume = this.masterVolume * state.baseVolume;
    if (state.spatial) {
      const [lx, ly, lz] = this.listener;
      const [x, y, z] = state.position;
      const distance = Math.hypot(x - lx, y - ly, z - lz);
      volume *= AudioManager.attenuation(distance, state.refDistance, state.maxDistance);
    }
    if (this.mixer && state.bus) {
      volume = this.mixer.voiceGain(state.bus, volume);
    }
    return clamp01(volume);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

let defaultManager: AudioManager | null = null;

/** Shared manager for components; falls back to the null backend when headless. */
export function getAudioManager(): AudioManager {
  if (!defaultManager) defaultManager = new AudioManager();
  return defaultManager;
}

/** Replace the shared manager (tests, custom backends). Pass null to reset. */
export function setAudioManager(manager: AudioManager | null): void {
  defaultManager = manager;
}
