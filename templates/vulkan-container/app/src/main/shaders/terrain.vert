#version 450
// Heretek Tier 2 — terrain mesh vertex shader.
// Static heightmap-displaced geometry (no instancing/SSBOs); all LOD leaves
// share one vertex/index buffer pair and are drawn via indirect commands.
//
// Outputs world position + normal so the fragment stage can splat biomes by
// height and slope (see terrain.frag).

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
} pc;

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vWorldPos;

void main() {
    gl_Position = pc.viewProj * vec4(inPosition, 1.0);
    vNormal = inNormal;
    vWorldPos = inPosition;
}
