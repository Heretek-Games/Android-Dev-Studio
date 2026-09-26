#version 450
// Heretek Tier 2 — instanced scene vertex shader.
// Draw calls are issued indirectly after compute culling; the vertex shader
// reads the surviving instance index from the visible-index SSBO (category 0
// range, which starts at slot 0).

struct InstanceData {
    vec4 positionRadius;  // xyz = world position, w = bounding radius
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
    float time;                // seconds; used by the foliage pass
    uint foliageVisibleBase;   // visible-buffer slot base for category 1
    vec3 camPos;               // world-space camera eye (fragment PBR)
} pc;

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

layout(location = 0) out vec3 outNormal;
layout(location = 1) out vec3 outColor;
layout(location = 2) out vec3 outMaterial;  // x = metallic, y = roughness, z = unlit
layout(location = 3) out vec3 outWorldPos;

void main() {
    const uint instanceId = visibleBuffer.visibleIndices[gl_InstanceIndex];
    const InstanceData inst = instanceBuffer.instances[instanceId];

    const vec3 worldPosition = inPosition + inst.positionRadius.xyz;
    gl_Position = pc.viewProj * vec4(worldPosition, 1.0);

    outNormal = inNormal;
    outColor = inst.color.rgb;
    outMaterial = inst.material.xyz;
    outWorldPos = worldPosition;
}
