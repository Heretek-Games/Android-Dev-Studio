import { Component } from '../core/Component.js';
import type { GameObject } from '../core/GameObject.js';
import { AnimFSM } from '../animation/AnimFSM.js';
import { CineCamera } from './CineCamera.js';

export type TimelineClipType = 'move' | 'rotate' | 'event' | 'anim' | 'camera';

export interface TimelineClip {
  id: string;
  /** Seconds from timeline start. */
  start: number;
  /** Clip length in seconds (events fire at start; dur 0 allowed). */
  dur?: number;
  type: TimelineClipType;
  /** move: {to:[x,y,z]} · rotate: {yawDeg} · event: {name} · anim: {trigger|param,value} · camera: {shot?, to?, cut?, blend?, lookTarget?, deadzone?, lookahead?, smoothTime?, dolly?|crane? {path, ease}, shake? {trauma, decay, freq, ampPos, ampRot}, fov? {from, to}, fovKick?} */
  data?: Record<string, unknown>;
}

export interface TimelineTrack {
  /** Target GameObject name (scene-resolved each pass; missing targets skip). */
  target: string;
  clips: TimelineClip[];
}

export interface TimelineOptions {
  duration?: number;
  loop?: boolean;
  autostart?: boolean;
  tracks?: TimelineTrack[];
}

/** Boundary tolerance for IEEE754 clock accumulation (see update). */
const TL_EPSILON = 1e-9;

/**
 * Timeline-lite cutscene scheduler (Track 1.7, ADR-1790374021375).
 *
 * Unity-PlayableGraph-binding + Godot-track-model semantics as a pure
 * headless-steppable scheduler: a master clock sweeps entity-name-bound
 * tracks; move/rotate/camera clips interpolate transforms, event clips emit
 * once per pass into a drained log, anim clips poke the target's AnimFSM
 * (trigger or param set). play/pause/seek/restart; loop or clamp-and-stop.
 * Targets resolve live per pass so spawned/destroyed objects never break
 * the clock; fired-event state serializes for undo restore.
 */
export class TimelineLite extends Component {
  public duration: number = 10;
  public loop: boolean = false;
  public playing: boolean = true;
  public time: number = 0;
  public tracks: TimelineTrack[] = [];
  public finished: boolean = false;

  /** events emitted this pass (drained by readers each update). */
  public emitted: Array<{ clipId: string; name: string; target: string; time: number }> = [];

  private firedThisPass: Set<string> = new Set();
  /** Captured move/camera origins per clip id (never stored on the spec). */
  private origins: Map<string, [number, number, number]> = new Map();
  /** False until the first evaluated pass (lets start-0 events fire). */
  private started: boolean = false;

  constructor(options?: TimelineOptions) {
    super();
    if (options) {
      if (options.duration !== undefined) this.duration = Math.max(0.01, options.duration);
      if (options.loop !== undefined) this.loop = options.loop;
      if (options.autostart !== undefined) this.playing = options.autostart;
      if (options.tracks) {
        this.tracks = options.tracks.map(t => ({
          target: t.target,
          clips: (t.clips ?? []).map(c => ({ ...c, dur: c.dur ?? 0, data: c.data ? { ...c.data } : {} }))
        }));
      }
    }
  }

  public play(): void {
    if (this.finished && this.time >= this.duration) this.restart();
    else this.playing = true;
  }

  public pause(): void {
    this.playing = false;
  }

  public restart(): void {
    this.time = 0;
    this.finished = false;
    this.playing = true;
    this.firedThisPass.clear();
    this.origins.clear();
    this.emitted = [];
    this.started = false;
  }

  /** Jumps the clock; event clips re-arm (fire again when swept). */
  public seek(t: number): void {
    this.time = Math.min(this.duration, Math.max(0, t));
    this.finished = false;
    this.firedThisPass.clear();
    this.origins.clear();
    this.started = this.time > 0;
  }

  public override update(deltaTime: number): void {
    this.emitted = [];
    if (!this.playing || this.finished) return;
    // First evaluated pass sweeps from -EPSILON so start-0 events fire.
    const prev = this.started ? this.time : -TL_EPSILON;
    this.started = true;
    this.time += deltaTime;
    // EPSILON + subtract (never modulo): 240 x (1/60) sums to just under
    // 4.0 in IEEE754 — the end boundary must trip on time, and modulo would
    // return the pre-duration value unchanged and stall the wrap/finish.
    if (this.time + TL_EPSILON >= this.duration) {
      if (this.loop) {
        this.time -= this.duration;
        this.firedThisPass.clear();
      } else {
        this.time = this.duration;
        this.finished = true;
        this.playing = false;
      }
    }
    this.applyWindow(prev, this.time, deltaTime);
  }

  /** Applies every clip overlapping (prev, now]; wrap clears in update(). */
  private applyWindow(prev: number, now: number, deltaTime: number): void {
    for (const track of this.tracks) {
      const target = this.gameObject.scene?.findByName(track.target);
      if (!target) continue;
      for (const clip of track.clips) {
        const start = clip.start;
        const end = clip.start + (clip.dur ?? 0);
        if (clip.type === 'event') {
          // EPSILON: 60 x (1/60) sums to just under 1.0 — a start-1.0 event
          // must trip on the 60th pass, not slip to the 61st.
          if (!this.firedThisPass.has(clip.id) && prev < start && now + TL_EPSILON >= start) {
            this.firedThisPass.add(clip.id);
            const name = typeof clip.data?.['name'] === 'string' ? (clip.data['name'] as string) : clip.id;
            this.emitted.push({ clipId: clip.id, name, target: track.target, time: this.time });
          }
          continue;
        }
        // Continuous clips: progress over their window (instant when dur 0 and swept).
        if (now < start || prev >= end) continue;
        const span = Math.max(end - start, 1e-9);
        const alpha = Math.min(1, Math.max(0, (now - start) / span));
        this.applyContinuous(target, clip, alpha, deltaTime);
      }
    }
  }

  private originFor(target: GameObject, clipId: string): [number, number, number] {
    let from = this.origins.get(clipId);
    if (!from) {
      const p = target.transform.position;
      from = [p.x, p.y, p.z];
      this.origins.set(clipId, from);
    }
    return from;
  }

  private applyContinuous(target: GameObject, clip: TimelineClip, alpha: number, deltaTime: number): void {
    const data = clip.data ?? {};
    if (clip.type === 'camera') {
      // Cinematic shots delegate to CineCamera when present (cut/blend,
      // look-target, dolly, shake, FOV); otherwise the legacy position lerp.
      const to = (Array.isArray(data['to']) ? data['to'] : null) as number[] | null;
      const from = this.originFor(target, clip.id);
      const legacy: [number, number, number] = to
        ? [
          from[0] + (to[0] - from[0]) * alpha,
          from[1] + (to[1] - from[1]) * alpha,
          from[2] + (to[2] - from[2]) * alpha
        ]
        : [target.transform.position.x, target.transform.position.y, target.transform.position.z];
      const cine = target.getComponent(CineCamera);
      if (cine) {
        cine.evaluateShot(clip, alpha, deltaTime, legacy);
      } else {
        target.transform.setPosition(legacy[0], legacy[1], legacy[2]);
      }
      return;
    }
    if (clip.type === 'move' && Array.isArray(data['to'])) {
      const to = data['to'] as number[];
      const from = this.originFor(target, clip.id);
      target.transform.setPosition(
        from[0] + (to[0] - from[0]) * alpha,
        from[1] + (to[1] - from[1]) * alpha,
        from[2] + (to[2] - from[2]) * alpha
      );
    } else if (clip.type === 'rotate' && typeof data['yawDeg'] === 'number') {
      target.transform.setRotation(
        target.transform.rotation.x,
        ((data['yawDeg'] as number) * Math.PI) / 180 * alpha,
        target.transform.rotation.z
      );
    } else if (clip.type === 'anim') {
      const fsm = target.getComponent(AnimFSM);
      if (!fsm) return;
      if (typeof data['trigger'] === 'string') fsm.setTrigger(data['trigger'] as string);
      if (typeof data['param'] === 'string' && typeof data['value'] === 'number') {
        fsm.setFloat(data['param'] as string, data['value'] as number);
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'TimelineLite',
      enabled: this.enabled,
      duration: this.duration,
      loop: this.loop,
      playing: this.playing,
      time: this.time,
      finished: this.finished,
      tracks: this.tracks.map(t => ({ target: t.target, clips: t.clips.map(c => ({ ...c })) }))
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (typeof data.duration === 'number') this.duration = data.duration;
    if (typeof data.loop === 'boolean') this.loop = data.loop;
    if (typeof data.playing === 'boolean') this.playing = data.playing;
    if (typeof data.time === 'number') this.time = data.time;
    if (typeof data.finished === 'boolean') this.finished = data.finished;
    if (Array.isArray(data.tracks)) {
      this.tracks = data.tracks.map((t: TimelineTrack) => ({
        target: t.target,
        clips: [...(t.clips ?? [])]
      }));
    }
    this.firedThisPass.clear();
    this.origins.clear();
    this.emitted = [];
  }
}
