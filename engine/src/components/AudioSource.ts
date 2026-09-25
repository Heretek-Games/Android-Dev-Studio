/**
 * AudioSource — binds a GameObject to a clip on the shared `AudioManager`.
 *
 * Supports one-shot or looping playback, optional distance attenuation, and
 * per-frame position updates for spatial voices. Headless runs use the manager's
 * null backend, so the component is fully testable without an AudioContext.
 */

import { Component } from '../core/Component.js';
import { AudioManager, getAudioManager } from '../audio/AudioManager.js';

export interface AudioSourceOptions {
  clipId: string;
  volume?: number;
  loop?: boolean;
  playOnStart?: boolean;
  spatial?: boolean;
  refDistance?: number;
  maxDistance?: number;
  /** Custom manager (tests / multiple buses). Defaults to the shared manager. */
  manager?: AudioManager;
}

export class AudioSource extends Component {
  public clipId: string;
  public volume: number;
  public loop: boolean;
  public playOnStart: boolean;
  public spatial: boolean;
  public refDistance: number;
  public maxDistance: number;

  private readonly manager: AudioManager;
  private voiceId: number | null = null;

  constructor(options: AudioSourceOptions) {
    super();
    this.clipId = options.clipId;
    this.volume = options.volume ?? 1;
    this.loop = options.loop ?? false;
    this.playOnStart = options.playOnStart ?? true;
    this.spatial = options.spatial ?? false;
    this.refDistance = options.refDistance ?? 5;
    this.maxDistance = options.maxDistance ?? 40;
    this.manager = options.manager ?? getAudioManager();
  }

  public override start(): void {
    if (this.playOnStart) this.play();
  }

  public override update(_deltaTime: number): void {
    if (!this.spatial || this.voiceId === null) return;
    const world = this.gameObject.transform.getWorldPosition();
    this.manager.updateVoicePosition(this.voiceId, world.x, world.y, world.z);
  }

  public override onDestroy(): void {
    this.stop();
  }

  /** Start playback; returns true when a voice was created. */
  public play(): boolean {
    if (this.voiceId !== null) this.stop();
    this.voiceId = this.manager.play(this.clipId, {
      volume: this.volume,
      loop: this.loop,
      spatial: this.spatial,
      refDistance: this.refDistance,
      maxDistance: this.maxDistance
    });
    return this.voiceId !== null;
  }

  public stop(): void {
    if (this.voiceId === null) return;
    this.manager.stop(this.voiceId);
    this.voiceId = null;
  }

  public isPlaying(): boolean {
    return this.voiceId !== null;
  }

  public getVoiceId(): number | null {
    return this.voiceId;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'AudioSource',
      enabled: this.enabled,
      clipId: this.clipId,
      volume: this.volume,
      loop: this.loop,
      playOnStart: this.playOnStart,
      spatial: this.spatial,
      refDistance: this.refDistance,
      maxDistance: this.maxDistance
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.clipId !== undefined) this.clipId = data.clipId;
    if (data.volume !== undefined) this.volume = data.volume;
    if (data.loop !== undefined) this.loop = data.loop;
    if (data.playOnStart !== undefined) this.playOnStart = data.playOnStart;
    if (data.spatial !== undefined) this.spatial = data.spatial;
    if (data.refDistance !== undefined) this.refDistance = data.refDistance;
    if (data.maxDistance !== undefined) this.maxDistance = data.maxDistance;
  }
}
