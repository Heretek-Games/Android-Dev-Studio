/**
 * WebAudio playback backend (browser only).
 *
 * Thin by design: all gain/spatial math lives in `AudioManager` (headless-tested).
 * This class only owns the AudioContext, decoded buffers, and voice nodes.
 */

import type { AudioBackend, PlayRequest } from './AudioBackend.js';

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class WebAudioBackend implements AudioBackend {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Map<number, Voice>();
  private nextVoiceId = 1;

  public static isSupported(): boolean {
    const scope = globalThis as unknown as Record<string, unknown>;
    return typeof scope.AudioContext !== 'undefined' || typeof scope.webkitAudioContext !== 'undefined';
  }

  public constructor() {
    if (!WebAudioBackend.isSupported()) {
      throw new Error('WebAudioBackend requires an AudioContext (browser runtime)');
    }
    const scope = globalThis as unknown as Record<string, new () => AudioContext>;
    const Ctor = (scope.AudioContext ?? scope.webkitAudioContext) as new () => AudioContext;
    this.context = new Ctor();
  }

  public async load(clipId: string, source: string | ArrayBuffer): Promise<void> {
    if (!this.context) return;
    const data = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source;
    const buffer = await this.context.decodeAudioData(data);
    this.buffers.set(clipId, buffer);
  }

  public play(clipId: string, request: PlayRequest): number | null {
    if (!this.context) return null;
    const buffer = this.buffers.get(clipId);
    if (!buffer) return null;

    const gain = this.context.createGain();
    gain.gain.value = request.volume;
    gain.connect(this.context.destination);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = request.loop;
    source.connect(gain);

    const voiceId = this.nextVoiceId++;
    source.onended = () => {
      this.voices.delete(voiceId);
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    source.start();
    this.voices.set(voiceId, { source, gain });
    return voiceId;
  }

  public stop(voiceId: number): void {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    try {
      voice.source.stop();
    } catch {
      /* already stopped */
    }
    voice.gain.disconnect();
    this.voices.delete(voiceId);
  }

  public setVolume(voiceId: number, volume: number): void {
    const voice = this.voices.get(voiceId);
    if (voice) voice.gain.gain.value = volume;
  }

  public stopAll(): void {
    for (const voiceId of Array.from(this.voices.keys())) this.stop(voiceId);
  }

  public dispose(): void {
    this.stopAll();
    this.buffers.clear();
    void this.context?.close();
    this.context = null;
  }
}
