#version 450
// Heretek Tier 2 — wind-animated foliage vertex shader.
//
// Reads the category-1 range of the visible-index SSBO (the compute culler
// compacted foliage instances there) and deforms each blade with a two-frequency
// sway driven by the shared time push constant: the base stays anchored, the tip
// bends. Blade shape: thin, tall, pivot at the ground.

struct InstanceData {
    vec4 positionRadius;  // xyz = world position, w = bounding radius (half height)
    vec4 color;           // rgb = tint, a = category
    vec4 material;        // x = metallic, y = roughness, z = unlit flag, w = pad
};

layout(std430, binding = 0) readonly buffer InstanceBuffer {
    InstanceData instances[];
} instanceBuffer;

layout(std430, binding = 1) readonly buffer VisibleIndexBuffer {
    uint visibleIndices[];
} visibleBuffer;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    float time;
    uint foliageVisibleBase;
} pc;

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

layout(location = 0) out vec3 outNormal;
layout(location = 1) out vec3 outColor;

void main() {
    const uint instanceId = visibleBuffer.visibleIndices[pc.foliageVisibleBase + gl_InstanceIndex];
    const InstanceData inst = instanceBuffer.instances[instanceId];

    const float halfHeight = max(inst.positionRadius.w, 0.05);
    const float bladeHeight = halfHeight * 2.0;

    // Pivot at the base: local y in [0, bladeHeight] (cube spans [-0.5, 0.5]).
    vec3 local = vec3(inPosition.x * 0.55, (inPosition.y + 0.5) * bladeHeight, inPosition.z * 0.55);
    const float heightFactor = clamp(local.y / bladeHeight, 0.0, 1.0);

    // Two-frequency wind: a slow gust plus a faster flutter, phase-offset per blade.
    const float phase = inst.positionRadius.x * 0.7 + inst.positionRadius.z * 1.1;
    const float gust = sin(pc.time * 1.6 + phase) * 0.35;
    const float flutter = sin(pc.time * 5.3 + phase * 1.7) * 0.08;
    const float bend = (gust + flutter) * heightFactor * heightFactor;
    local.x += bend;
    local.z += bend * 0.45;

    const vec3 worldPosition = local + inst.positionRadius.xyz;
    gl_Position = pc.viewProj * vec4(worldPosition, 1.0);

    outNormal = normalize(inNormal + vec3(bend * 0.8, 0.0, bend * 0.4));
    outColor = inst.color.rgb;
}
