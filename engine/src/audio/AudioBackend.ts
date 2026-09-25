/**
 * Audio backends for the engine.
 *
 * The engine runs headless in tests and QA (Node, no WebAudio), so playback is
 * abstracted behind `AudioBackend`: the browser uses `WebAudioBackend`, tests and
 * headless runs use `NullAudioBackend` (records calls for assertions). Volume and
 * spatial math lives in `AudioManager` so it is covered by headless tests.
 */

export interface PlayRequest {
  volume: number;
  loop: boolean;
}

export interface AudioBackend {
  /** Load a clip source (URL or encoded bytes) so it can be played. */
  load(clipId: string, source: string | ArrayBuffer): Promise<void>;
  /** Start playback; returns a voice id, or null when the clip is unavailable. */
  play(clipId: string, request: PlayRequest): number | null;
  stop(voiceId: number): void;
  setVolume(voiceId: number, volume: number): void;
  stopAll(): void;
  dispose(): void;
}

/** Records playback calls; used by headless runs and unit tests. */
export class NullAudioBackend implements AudioBackend {
  public readonly loaded = new Set<string>();
  public readonly played: Array<{ voiceId: number; clipId: string; volume: number; loop: boolean }> = [];
  public readonly stopped: number[] = [];
  public readonly volumes = new Map<number, number>();
  public stopAllCount = 0;
  public disposed = false;
  private nextVoiceId = 1;

  public async load(clipId: string): Promise<void> {
    this.loaded.add(clipId);
  }

  public play(clipId: string, request: PlayRequest): number | null {
    const voiceId = this.nextVoiceId++;
    this.played.push({ voiceId, clipId, volume: request.volume, loop: request.loop });
    this.volumes.set(voiceId, request.volume);
    return voiceId;
  }

  public stop(voiceId: number): void {
    this.stopped.push(voiceId);
    this.volumes.delete(voiceId);
  }

  public setVolume(voiceId: number, volume: number): void {
    if (this.volumes.has(voiceId)) this.volumes.set(voiceId, volume);
  }

  public stopAll(): void {
    this.stopAllCount++;
    this.volumes.clear();
  }

  public dispose(): void {
    this.disposed = true;
  }
}
