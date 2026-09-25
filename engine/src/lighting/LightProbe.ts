/**
 * Light probes — SH-9 irradiance volumes for stylized bounce
 * (Track 2.1, ADR-1790375806194).
 *
 * Adopts the three.js SH-9 probe model (basis order + constants) with a
 * stylized analytic bake from scene lights (no path tracing): ambient feeds
 * the uniform term, directionals feed uniform + directional lobe, points
 * feed distance falloff. Deterministic and headless-testable; sampling
 * blends probes by inverse-square distance. Not physical radiometry —
 * art-directed bounce for toon shading (Guilty Gear / Hoyoverse lesson).
 */

/** SH basis constants (Sloan/three.js order: L00, L1y, L1z, L1x, L2xy, L2yz, L20, L2xz, L2x2-y2). */
export const SH_C0 = 0.282095;
export const SH_C1 = 0.488603;

export type SHCoeffs = number[]; // 9 bands x [r, g, b] flattened (27 numbers)

export function emptySH(): SHCoeffs {
  return new Array(27).fill(0);
}

/** Adds a uniform irradiance E (per channel) to the ambient term. */
export function shAddUniform(sh: SHCoeffs, r: number, g: number, b: number): void {
  sh[0] += r / SH_C0;
  sh[1] += g / SH_C0;
  sh[2] += b / SH_C0;
}

/** Adds a directional lobe E along a normalized direction. */
export function shAddLobe(
  sh: SHCoeffs,
  dx: number, dy: number, dz: number,
  r: number, g: number, b: number
): void {
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  sh[3] += (r * ny) / SH_C1;
  sh[4] += (g * ny) / SH_C1;
  sh[5] += (b * ny) / SH_C1;
  sh[6] += (r * nz) / SH_C1;
  sh[7] += (g * nz) / SH_C1;
  sh[8] += (b * nz) / SH_C1;
  sh[9] += (r * nx) / SH_C1;
  sh[10] += (g * nx) / SH_C1;
  sh[11] += (b * nx) / SH_C1;
}

/** Evaluates irradiance along a normalized direction. */
export function shEvaluate(
  sh: SHCoeffs,
  dx: number, dy: number, dz: number
): [number, number, number] {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  // L2 bands are zero in our bake (uniform + lobe only); evaluated anyway.
  const basis = [
    SH_C0,
    SH_C1 * y, SH_C1 * z, SH_C1 * x,
    1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1),
    1.092548 * x * z, 0.546274 * (x * x - y * y)
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let band = 0; band < 9; band++) {
    r += sh[band * 3] * basis[band];
    g += sh[band * 3 + 1] * basis[band];
    b += sh[band * 3 + 2] * basis[band];
  }
  return [r, g, b];
}

export type BakedLightKind = 'directional' | 'point' | 'ambient';

export interface BakedLight {
  kind: BakedLightKind;
  color: [number, number, number];
  intensity: number;
  /** Direction TOWARD the light (directional). */
  direction?: [number, number, number];
  /** World position (point). */
  position?: [number, number, number];
}

export interface ProbeDef {
  position: [number, number, number];
  /** Influence radius (inverse-square blend). Default 8. */
  radius?: number;
}

export interface ProbeSample {
  color: [number, number, number];
  covered: boolean;
}

export interface LightProbeVolumeOptions {
  probes?: ProbeDef[];
}

/**
 * Probe volume: bakes SH from analytic lights, samples blended irradiance.
 * Pure subsystem (NavGrid precedent): no Component, JSON round-trips.
 */
export class LightProbeVolume {
  public probes: Array<{ position: [number, number, number]; radius: number; sh: SHCoeffs }> = [];

  constructor(options?: LightProbeVolumeOptions) {
    for (const p of options?.probes ?? []) {
      this.addProbe(p.position, p.radius ?? 8);
    }
  }

  public addProbe(position: [number, number, number], radius = 8): number {
    this.probes.push({ position: [...position] as [number, number, number], radius: Math.max(0.1, radius), sh: emptySH() });
    return this.probes.length - 1;
  }

  public clear(): void {
    this.probes = [];
  }

  /** Bakes every probe from analytic lights (resets previous bake). */
  public bake(lights: BakedLight[]): void {
    for (const probe of this.probes) {
      probe.sh = emptySH();
      for (const light of lights) {
        if (light.kind === 'ambient') {
          shAddUniform(
            probe.sh,
            light.color[0] * light.intensity,
            light.color[1] * light.intensity,
            light.color[2] * light.intensity
          );
        } else if (light.kind === 'directional') {
          const dir = light.direction ?? [0, 1, 0];
          const half: [number, number, number] = [
            (light.color[0] * light.intensity) / 2,
            (light.color[1] * light.intensity) / 2,
            (light.color[2] * light.intensity) / 2
          ];
          shAddUniform(probe.sh, half[0], half[1], half[2]);
          shAddLobe(probe.sh, dir[0], dir[1], dir[2], half[0], half[1], half[2]);
        } else {
          const pos = light.position ?? probe.position;
          const d = Math.hypot(
            pos[0] - probe.position[0],
            pos[1] - probe.position[1],
            pos[2] - probe.position[2]
          );
          const falloff = 1 / (1 + d * d);
          shAddUniform(
            probe.sh,
            light.color[0] * light.intensity * falloff,
            light.color[1] * light.intensity * falloff,
            light.color[2] * light.intensity * falloff
          );
        }
      }
    }
  }

  /** Blended irradiance at a point (inverse-square over in-radius probes). */
  public sample(x: number, y: number, z: number): ProbeSample {
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    for (const probe of this.probes) {
      const d = Math.hypot(
        x - probe.position[0], y - probe.position[1], z - probe.position[2]
      );
      if (d > probe.radius) continue;
      const w = 1 / (1 + d * d);
      const [cr, cg, cb] = shEvaluate(probe.sh, 0, 1, 0);
      r += cr * w;
      g += cg * w;
      b += cb * w;
      wsum += w;
    }
    if (wsum <= 0) return { color: [0, 0, 0], covered: false };
    return { color: [r / wsum, g / wsum, b / wsum], covered: true };
  }

  /** Fraction of points covered by at least one probe. */
  public coverage(points: Array<[number, number, number]>): number {
    if (points.length === 0) return 1;
    let covered = 0;
    for (const [x, y, z] of points) {
      if (this.sample(x, y, z).covered) covered++;
    }
    return covered / points.length;
  }

  public toJSON(): Record<string, any> {
    return {
      type: 'LightProbeVolume',
      probes: this.probes.map(p => ({
        position: [...p.position],
        radius: p.radius,
        sh: [...p.sh]
      }))
    };
  }

  public fromJSON(data: Record<string, any>): void {
    this.probes = [];
    if (Array.isArray(data.probes)) {
      for (const p of data.probes) {
        if (!Array.isArray(p.position)) continue;
        this.probes.push({
          position: [p.position[0] ?? 0, p.position[1] ?? 0, p.position[2] ?? 0],
          radius: typeof p.radius === 'number' ? p.radius : 8,
          sh: Array.isArray(p.sh) && p.sh.length === 27 ? [...p.sh] : emptySH()
        });
      }
    }
  }
}
