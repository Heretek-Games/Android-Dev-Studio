/**
 * Cinematic camera math (Track 2.2, ADR-1790378702418).
 *
 * Adopted patterns, built small and deterministic: critically-damped
 * SmoothDamp follow (Unity Mathf.SmoothDamp semantics), Catmull-Rom dolly
 * paths (Cinemachine dolly math), sum-of-sines trauma noise (Godot/three.js
 * shake recipe, table-free for headless determinism), SmoothStep blend
 * easings. Pure functions — trivially headless-tested.
 */

/** Cubic Hermite SmoothStep. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Critically-damped smoothing step. Returns [value, velocity] (caller keeps
 * the velocity across frames — Unity SmoothDamp parity).
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  deltaTime: number
): [number, number] {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * deltaTime;
  const newVelocity = (velocity - omega * temp) * exp;
  const newValue = target + (change + temp) * exp;
  return [newValue, newVelocity];
}

/** Catmull-Rom point over waypoints (clamped ends), t in 0..1. */
export function catmullRomPoint(
  path: Array<[number, number, number]>,
  t: number
): [number, number, number] {
  const n = path.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return [...path[0]] as [number, number, number];
  const clamped = Math.min(1, Math.max(0, t));
  const segs = n - 1;
  const f = clamped * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const u = f - i;
  const p0 = path[Math.max(0, i - 1)];
  const p1 = path[i];
  const p2 = path[Math.min(n - 1, i + 1)];
  const p3 = path[Math.min(n - 1, i + 2)];
  const cr = (a: number, b: number, c: number, d: number): number => {
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  };
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])];
}

/**
 * Deterministic handheld noise in -1..1 (sum of incommensurate sines —
 * smooth, table-free, identical on every platform for the same input).
 */
export function traumaNoise(t: number, seed: number): number {
  return (
    Math.sin(t * 1.7 + seed * 12.9) * 0.55 +
    Math.sin(t * 3.9 + seed * 78.2) * 0.3 +
    Math.sin(t * 8.3 + seed * 37.7) * 0.15
  );
}

/** Shortest-arc angle lerp factor target for yaw tracking. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
