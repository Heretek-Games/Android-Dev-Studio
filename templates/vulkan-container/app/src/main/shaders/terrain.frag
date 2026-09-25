#version 450
// Heretek Tier 2 — terrain fragment shader: biome splatting + directional light.
//
// Biome bands blend by height (sand → grass → alpine rock → snow) and by slope
// (steep faces become rock), with the same single directional light model as the
// instanced scene pass. Keeps the flat-colour placeholder replaced by a real
// material response for the terrain LOD mesh.

layout(location = 0) in vec3 vNormal;
layout(location = 1) in vec3 vWorldPos;

layout(location = 0) out vec4 fragColor;

void main() {
    const vec3 n = normalize(vNormal);
    const float slope = clamp(n.y, 0.0, 1.0);   // 1 = flat, 0 = vertical
    const float height = vWorldPos.y;

    const vec3 sand  = vec3(0.76, 0.70, 0.50);
    const vec3 grass = vec3(0.28, 0.44, 0.22);
    const vec3 rock  = vec3(0.42, 0.40, 0.38);
    const vec3 snow  = vec3(0.92, 0.94, 0.97);

    // Height bands: shoreline sand -> grass -> snow at altitude.
    vec3 base = mix(sand, grass, smoothstep(0.4, 3.0, height));
    base = mix(base, snow, smoothstep(9.0, 12.5, height));

    // Slope overrides: steep faces are rock regardless of altitude.
    base = mix(base, rock, 1.0 - smoothstep(0.55, 0.85, slope));

    // Micro-variation by height so large flats are not perfectly uniform.
    const float grain = sin(height * 3.1) * 0.02 + sin(vWorldPos.x * 0.7 + vWorldPos.z * 0.9) * 0.015;
    base = clamp(base + grain, 0.0, 1.0);

    // Single directional light (matches the instanced scene pass).
    const float ndl = max(dot(n, normalize(vec3(0.4, 1.0, 0.6))), 0.0);
    fragColor = vec4(base * (0.30 + 0.70 * ndl), 1.0);
}
