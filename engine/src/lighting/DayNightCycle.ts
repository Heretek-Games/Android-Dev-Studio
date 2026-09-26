import { Component } from '../core/Component.js';
import { LightComponent } from '../components/LightComponent.js';

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

export interface DayNightCycleOptions {
  /** Full cycle length in seconds (default 240: Genshin-paced days). */
  dayLengthSeconds?: number;
  /** Start time, 0..1 (0 = midnight, 0.25 = sunrise, 0.5 = noon). */
  startTimeOfDay?: number;
}

export interface SunState {
  /** Radians above the horizon (+day) or below (−night). */
  elevation: number;
  /** Sun color hex at this time. */
  color: string;
  /** Sun intensity multiplier (0 at deep night). */
  intensity: number;
  /** Ambient intensity multiplier. */
  ambient: number;
  phase: DayPhase;
}

/**
 * DayNightCycle — time-of-day sun rig (Track E.3).
 *
 * Pure time → sun-state function drives one directional sun plus one
 * ambient light (refs handed in by game code; no renderer coupling, fully
 * headless-testable). Quest logic reads phase() for dawn/dusk-gated beats.
 */
export class DayNightCycle extends Component {
  public dayLengthSeconds: number;
  public timeOfDay: number = 0;

  private sun: LightComponent | null = null;
  private ambient: LightComponent | null = null;

  constructor(options?: DayNightCycleOptions) {
    super();
    const dayLength = options?.dayLengthSeconds ?? 240;
    this.dayLengthSeconds = Number.isFinite(dayLength) && dayLength > 0 ? dayLength : 240;
    const start = options?.startTimeOfDay ?? 0.3;
    this.timeOfDay = Number.isFinite(start) ? ((start % 1) + 1) % 1 : 0.3;
  }

  /** Bind the lights this rig drives (called by game code after scene build). */
  public bind(sun: LightComponent | null, ambient: LightComponent | null): void {
    this.sun = sun;
    this.ambient = ambient;
    this.apply();
  }

  /** Pure function: time-of-day → sun state (no component state touched). */
  public static sunStateAt(timeOfDay: number): SunState {
    const t = ((timeOfDay % 1) + 1) % 1;
    // Sun angle: sunrise t=0.25, noon t=0.5, sunset t=0.75.
    const elevation = Math.sin((t - 0.25) * Math.PI * 2) * (Math.PI / 2.2);
    const dayness = Math.max(0, Math.sin((t - 0.25) * Math.PI * 2));
    const duskness =
      Math.max(0, 1 - Math.abs(t - 0.25) / 0.06) + Math.max(0, 1 - Math.abs(t - 0.75) / 0.06);
    const color =
      dayness > 0.55 ? '#fff7ed'
      : Math.min(1, duskness) > 0.25 ? '#fb923c'
      : '#1e3a8a';
    const intensity = dayness <= 0 ? 0.06 : 0.25 + dayness * 1.75;
    const ambient = 0.12 + dayness * 0.48;
    const phase: DayPhase =
      t < 0.2 || t >= 0.8 ? 'night'
      : t < 0.3 ? 'dawn'
      : t < 0.7 ? 'day'
      : 'dusk';
    return { elevation, color, intensity, ambient, phase };
  }

  public phase(): DayPhase {
    return DayNightCycle.sunStateAt(this.timeOfDay).phase;
  }

  public override update(deltaTime: number): void {
    if (this.dayLengthSeconds <= 0) return;
    this.timeOfDay = (this.timeOfDay + deltaTime / this.dayLengthSeconds) % 1;
    this.apply();
  }

  private apply(): void {
    const state = DayNightCycle.sunStateAt(this.timeOfDay);
    if (this.sun) {
      this.sun.color = state.color;
      this.sun.intensity = state.intensity;
    }
    if (this.ambient) {
      this.ambient.intensity = state.ambient;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'DayNightCycle',
      enabled: this.enabled,
      dayLengthSeconds: this.dayLengthSeconds,
      timeOfDay: this.timeOfDay
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.dayLengthSeconds !== undefined) this.dayLengthSeconds = data.dayLengthSeconds;
    if (data.timeOfDay !== undefined) this.timeOfDay = data.timeOfDay;
  }
}
