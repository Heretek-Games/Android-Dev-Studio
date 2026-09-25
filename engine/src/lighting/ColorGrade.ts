/**
 * Color grading LUTs (Track 2.1, ADR-1790375806194).
 *
 * Unity/Godot LUT semantics adopted: a size³ lattice over RGB space,
 * trilinear sampling, and a mix amount over the ungraded color. LUTs are
 * authored offline (OpenImageIO-class tooling); the runner ships procedural
 * `neutral` (identity) and `sunset` (warm-highlight) presets so headless
 * runs need no binary assets. Renderer fullscreen-hookup is Phase 2 — this
 * module is the data + sampler + budget surface with headless rules.
 */

export type LutPreset = 'neutral' | 'sunset';

export interface ColorGradeOptions {
  size?: number;
  amount?: number;
  preset?: LutPreset;
  /** Explicit lattice (size³ x [r,g,b]); overrides preset when valid. */
  data?: number[];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export class ColorGrade {
  public readonly size: number;
  public readonly data: Float32Array;
  public amount: number;

  constructor(options?: ColorGradeOptions) {
    this.size = Math.max(2, Math.floor(options?.size ?? 32));
    this.amount = Math.min(1, Math.max(0, options?.amount ?? 1));
    const preset = options?.preset ?? 'neutral';
    this.data = new Float32Array(this.size ** 3 * 3);
    if (options?.data && options.data.length === this.size ** 3 * 3) {
      for (let i = 0; i < options.data.length; i++) {
        this.data[i] = clamp01(options.data[i]);
      }
    } else if (preset === 'sunset') {
      this.fillSunset();
    } else {
      this.fillNeutral();
    }
  }

  private lattice(fn: (r: number, g: number, b: number) => [number, number, number]): void {
    const n = this.size;
    let i = 0;
    for (let bi = 0; bi < n; bi++) {
      for (let gi = 0; gi < n; gi++) {
        for (let ri = 0; ri < n; ri++) {
          const [r, g, b] = fn(ri / (n - 1), gi / (n - 1), bi / (n - 1));
          this.data[i++] = clamp01(r);
          this.data[i++] = clamp01(g);
          this.data[i++] = clamp01(b);
        }
      }
    }
  }

  private fillNeutral(): void {
    this.lattice((r, g, b) => [r, g, b]);
  }

  /** Warm highlights, cooled shadows (sunset look-dev mood). */
  private fillSunset(): void {
    this.lattice((r, g, b) => {
      const warmth = r * r;
      const depth = (1 - b) * (1 - b);
      return [r + warmth * 0.06 + 0.015, g + warmth * 0.015, b - depth * 0.05];
    });
  }

  /** Trilinear sample of the lattice. */
  public sample(r: number, g: number, b: number): [number, number, number] {
    const n = this.size;
    const fx = clamp01(r) * (n - 1);
    const fy = clamp01(g) * (n - 1);
    const fz = clamp01(b) * (n - 1);
    const x0 = Math.min(n - 2, Math.floor(fx));
    const y0 = Math.min(n - 2, Math.floor(fy));
    const z0 = Math.min(n - 2, Math.floor(fz));
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    const at = (x: number, y: number, z: number): [number, number, number] => {
      const i = (z * n * n + y * n + x) * 3;
      return [this.data[i], this.data[i + 1], this.data[i + 2]];
    };
    const lerp = (a: number, b2: number, t: number): number => a + (b2 - a) * t;
    const mix3 = (a: [number, number, number], b2: [number, number, number], t: number): [number, number, number] => [
      lerp(a[0], b2[0], t), lerp(a[1], b2[1], t), lerp(a[2], b2[2], t)
    ];
    const c000 = at(x0, y0, z0);
    const c100 = at(x0 + 1, y0, z0);
    const c010 = at(x0, y0 + 1, z0);
    const c110 = at(x0 + 1, y0 + 1, z0);
    const c001 = at(x0, y0, z0 + 1);
    const c101 = at(x0 + 1, y0, z0 + 1);
    const c011 = at(x0, y0 + 1, z0 + 1);
    const c111 = at(x0 + 1, y0 + 1, z0 + 1);
    return mix3(
      mix3(mix3(c000, c100, tx), mix3(c010, c110, tx), ty),
      mix3(mix3(c001, c101, tx), mix3(c011, c111, tx), ty),
      tz
    );
  }

  /** Graded color: mix(ungraded, sampled, amount). */
  public grade(r: number, g: number, b: number): [number, number, number] {
    const [sr, sg, sb] = this.sample(r, g, b);
    return [
      r + (sr - r) * this.amount,
      g + (sg - g) * this.amount,
      b + (sb - b) * this.amount
    ];
  }

  /** Max abs delta of the neutral preset over a probe grid (identity check). */
  public static neutralDrift(size = 8): number {
    const lut = new ColorGrade({ size, preset: 'neutral' });
    let worst = 0;
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      const [r, g, b] = lut.sample(v, 1 - v, v * v);
      worst = Math.max(worst, Math.abs(r - v), Math.abs(g - (1 - v)), Math.abs(b - v * v));
    }
    return worst;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'ColorGrade',
      size: this.size,
      amount: this.amount,
      data: Array.from(this.data)
    };
  }

  public static fromData(data: Record<string, any>): ColorGrade {
    return new ColorGrade({
      size: typeof data.size === 'number' ? data.size : 32,
      amount: typeof data.amount === 'number' ? data.amount : 1,
      data: Array.isArray(data.data) ? data.data : undefined
    });
  }
}
