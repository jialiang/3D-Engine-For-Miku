#version 300 es

precision highp float;

uniform Shadow {
    float u_shadowMappingMode;
    vec2 u_shadowMapTexelSize;
};

//#include shadow

in vec4 v_shadow_uv;

out vec4 finalColor;

void main() {
    float shadowStrength = 1.0 - shadowLightFactor(v_shadow_uv, u_shadowMapTexelSize);

    finalColor = vec4(0.0, 0.0, 0.0, shadowStrength);
}
