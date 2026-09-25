#version 450
// Heretek Tier 2 — terrain mesh vertex shader.
// Static heightmap-displaced geometry (no instancing/SSBOs); all LOD leaves
// share one vertex/index buffer pair and are drawn via indirect commands.

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
} pc;

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

layout(location = 0) out vec3 outNormal;
layout(location = 1) out vec3 outColor;

void main() {
    gl_Position = pc.viewProj * vec4(inPosition, 1.0);
    outNormal = inNormal;
    // Base grass tone; biome splatting (grass/rock/snow) lands with the
    // terrain shading pass.
    outColor = vec3(0.30, 0.42, 0.24);
}
