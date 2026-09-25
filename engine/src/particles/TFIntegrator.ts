/**
 * Transform-feedback particle integrator spike (Track 2.3, ADR-1790379192696).
 *
 * Raw-WebGL2 ping-pong integration of the Phase-1 CPU ring math
 * (pos += vel*dt; vel.y -= gravity*dt; vel *= damp; life -= dt) with
 * synchronous readback. three.js exposes no first-class TF API, so this
 * module owns its GL program + buffers outright and exchanges plain
 * Float32Arrays with ParticleSystem — production default stays CPU
 * (PlayCanvas split / Unreal mobile rule); TF activates only through an
 * explicit, self-tested opt-in. GLSL is float32: TF results match the CPU
 * reference within epsilon, never bit-identically (documented).
 */

export const TF_FRAGMENT_GLSL = `#version 300 es
precision highp float;
void main() {
}
`;

export const TF_INTEGRATE_GLSL = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aVel;
in float aLife;
uniform float uDt;
uniform float uGravity;
uniform float uDrag;
out vec3 vPos;
out vec3 vVel;
out float vLife;
void main() {
  float life = aLife - uDt;
  vec3 vel = aVel;
  vel.y -= uGravity * uDt;
  vel *= max(0.0, 1.0 - uDrag * uDt);
  vec3 pos = aPos + vel * uDt;
  vPos = pos;
  vVel = vel;
  vLife = life;
}
`;

export interface TFSelfTest {
  supported: boolean;
  pass: boolean;
  maxError: number;
  detail: string;
}

/** Capability probe (null/undefined GL = headless/SSR = unsupported). */
export function probeTransformFeedback(
  gl: WebGL2RenderingContext | null | undefined
): { supported: boolean; reason: string } {
  if (!gl) return { supported: false, reason: 'no WebGL2 context (headless or unsupported)' };
  try {
    const attribs = gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS) as number;
    if (attribs < 3) {
      return { supported: false, reason: `only ${attribs} TF separate attribs (< 3)` };
    }
    return { supported: true, reason: 'WebGL2 transform feedback available' };
  } catch (error) {
    return { supported: false, reason: `probe failed: ${String(error)}` };
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

export class TFIntegrator {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly locDt: WebGLUniformLocation | null;
  private readonly locGravity: WebGLUniformLocation | null;
  private readonly locDrag: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    const probe = probeTransformFeedback(gl);
    if (!probe.supported) throw new Error(`transform feedback unavailable: ${probe.reason}`);
    this.gl = gl;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, TF_INTEGRATE_GLSL);
    // WebGL2 refuses to link a vertex-only program (even with rasterizer
    // discard): attach a trivial fragment stage.
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, TF_FRAGMENT_GLSL);
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram returned null');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    // Attribute locations AND varyings must precede linking to take effect.
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.bindAttribLocation(program, 1, 'aVel');
    gl.bindAttribLocation(program, 2, 'aLife');
    gl.transformFeedbackVaryings(program, ['vPos', 'vVel', 'vLife'], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`program link failed: ${log}`);
    }
    this.program = program;
    this.locDt = gl.getUniformLocation(program, 'uDt');
    this.locGravity = gl.getUniformLocation(program, 'uGravity');
    this.locDrag = gl.getUniformLocation(program, 'uDrag');
  }

  public dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  /**
   * Integrates count particles in place (pos/vel 3N, life N) with explicit
   * gravity/drag. Synchronous readback by design (spike scale only).
   */
  public step(
    pos: Float32Array,
    vel: Float32Array,
    life: Float32Array,
    count: number,
    dt: number,
    gravity: number,
    drag: number
  ): void {
    const gl = this.gl;
    const n = Math.min(count, Math.floor(pos.length / 3), Math.floor(vel.length / 3), life.length);
    if (n <= 0) return;
    const makeBuffer = (data: Float32Array, size: number): WebGLBuffer => {
      const buf = gl.createBuffer();
      if (!buf) throw new Error('createBuffer returned null');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, size), gl.DYNAMIC_DRAW);
      return buf;
    };
    const srcPos = makeBuffer(pos, n * 3);
    const srcVel = makeBuffer(vel, n * 3);
    const srcLife = makeBuffer(life, n);
    const dstPos = gl.createBuffer();
    const dstVel = gl.createBuffer();
    const dstLife = gl.createBuffer();
    if (!dstPos || !dstVel || !dstLife) throw new Error('createBuffer returned null');
    const allocDst = (buf: WebGLBuffer, bytes: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    };
    allocDst(dstPos, n * 3 * 4);
    allocDst(dstVel, n * 3 * 4);
    allocDst(dstLife, n * 4);
    // Source VAO (locations were pinned pre-link in the constructor).
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bindAttrib = (index: number, buf: WebGLBuffer, size: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
    };
    bindAttrib(0, srcPos, 3);
    bindAttrib(1, srcVel, 3);
    bindAttrib(2, srcLife, 1);
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstPos);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, dstVel);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, dstLife);
    gl.useProgram(this.program);
    gl.uniform1f(this.locDt, dt);
    gl.uniform1f(this.locGravity, gravity);
    gl.uniform1f(this.locDrag, drag);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    // Synchronous readback into the caller arrays.
    const readInto = (buf: WebGLBuffer, dst: Float32Array, size: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, dst.subarray(0, size) as Float32Array);
    };
    readInto(dstPos, pos, n * 3);
    readInto(dstVel, vel, n * 3);
    readInto(dstLife, life, n);
    for (const buf of [srcPos, srcVel, srcLife, dstPos, dstVel, dstLife]) gl.deleteBuffer(buf);
    gl.deleteVertexArray(vao);
    gl.deleteTransformFeedback(tf);
  }

  /**
   * Live self-test: one transform pass over 4 known particles vs the CPU
   * semi-implicit Euler reference. Must run on real GL (studio/devices).
   */
  public selfTest(): TFSelfTest {
    const pos = new Float32Array([0, 0, 0, 1, 2, 3, -1, 0.5, 2, 0, 10, 0]);
    const vel = new Float32Array([0, 2, 0, 1, 0, 0, 0, -1, 0, 3, 0, 0]);
    const life = new Float32Array([1, 1, 1, 1]);
    const dt = 1 / 60;
    const gravity = 9.8;
    const drag = 0.5;
    // CPU reference (mirrors ParticleSystem.update integration order).
    const refPos = Float32Array.from(pos);
    const refVel = Float32Array.from(vel);
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < 4; i++) {
      refVel[i * 3 + 1] -= gravity * dt;
      refVel[i * 3] *= damp;
      refVel[i * 3 + 1] *= damp;
      refVel[i * 3 + 2] *= damp;
      refPos[i * 3] += refVel[i * 3] * dt;
      refPos[i * 3 + 1] += refVel[i * 3 + 1] * dt;
      refPos[i * 3 + 2] += refVel[i * 3 + 2] * dt;
    }
    try {
      this.step(pos, vel, life, 4, dt, gravity, drag);
    } catch (error) {
      return { supported: true, pass: false, maxError: Infinity, detail: `transform pass threw: ${String(error)}` };
    }
    let maxError = 0;
    for (let i = 0; i < 12; i++) maxError = Math.max(maxError, Math.abs(pos[i] - refPos[i]));
    for (let i = 0; i < 12; i++) maxError = Math.max(maxError, Math.abs(vel[i] - refVel[i]));
    // float32 GLSL vs float64 CPU: epsilon-scale agreement expected.
    const pass = maxError < 1e-4;
    return {
      supported: true,
      pass,
      maxError,
      detail: pass ? `TF matches CPU Euler (max err ${maxError.toExponential(2)})` : `TF diverged (max err ${maxError})`
    };
  }
}
