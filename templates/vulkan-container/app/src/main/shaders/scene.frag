#version 450
// Heretek Tier 2 — instanced scene fragment shader (single directional light).

layout(location = 0) in vec3 outNormal;
layout(location = 1) in vec3 outColor;

layout(location = 0) out vec4 fragColor;

void main() {
    const vec3 n = normalize(outNormal);
    const float ndl = max(dot(n, normalize(vec3(0.4, 1.0, 0.6))), 0.0);
    fragColor = vec4(outColor * (0.25 + 0.75 * ndl), 1.0);
}
