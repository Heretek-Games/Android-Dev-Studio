#version 450
// Heretek Tier 2 — instanced scene fragment shader (Track C.3 PBR).
// Cook-Torrance GGX specular over the Lambert diffuse base, single
// directional light. unlit flag renders flat albedo (stylized/cel fallback).

layout(location = 0) in vec3 outNormal;
layout(location = 1) in vec3 outColor;
layout(location = 2) in vec3 outMaterial;  // x = metallic, y = roughness, z = unlit
layout(location = 3) in vec3 outWorldPos;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    float time;
    uint foliageVisibleBase;
    vec3 camPos;
} pc;

layout(location = 0) out vec4 fragColor;

const float PI = 3.14159265;
const vec3 LIGHT_DIR = normalize(vec3(0.4, 1.0, 0.6));
const vec3 LIGHT_COLOR = vec3(1.0);
const vec3 F0_DIELECTRIC = vec3(0.04);

float ggxDistribution(float ndh, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = ndh * ndh * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + 1e-6);
}

float smithGeometry(float ndl, float ndv, float roughness) {
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float g1 = ndl / (ndl * (1.0 - k) + k + 1e-6);
    float g2 = ndv / (ndv * (1.0 - k) + k + 1e-6);
    return g1 * g2;
}

void main() {
    const vec3 n = normalize(outNormal);
    const vec3 albedo = outColor;
    if (outMaterial.z > 0.5) {
        fragColor = vec4(albedo, 1.0);
        return;
    }

    const float metallic = clamp(outMaterial.x, 0.0, 1.0);
    const float roughness = clamp(outMaterial.y, 0.04, 1.0);
    const vec3 v = normalize(pc.camPos - outWorldPos);
    const vec3 l = LIGHT_DIR;
    const vec3 h = normalize(l + v);

    const float ndl = max(dot(n, l), 0.0);
    const float ndv = max(dot(n, v), 1e-3);
    const float ndh = max(dot(n, h), 0.0);

    const vec3 f0 = mix(F0_DIELECTRIC, albedo, metallic);
    const vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
    const float D = ggxDistribution(ndh, roughness);
    const float G = smithGeometry(ndl, ndv, roughness);
    const vec3 specular = (D * G * F) / (4.0 * ndv * ndl + 1e-3);

    const vec3 diffuse = (1.0 - metallic) * albedo / PI;
    // Ambient term preserves the legacy 0.25 floor for matte surfaces.
    const vec3 ambient = albedo * 0.25 * (1.0 - metallic * 0.5);
    fragColor = vec4(ambient + (diffuse + specular) * LIGHT_COLOR * ndl, 1.0);
}
