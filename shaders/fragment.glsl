#version 300 es

precision mediump float;

const int shadowMap_pcfRange = 2;
const float shadowMap_totalPcfSamples = 25.0;

uniform sampler2D u_materialTexture_0;
uniform sampler2D u_materialTexture_1;
uniform sampler2D u_materialTexture_2;
uniform sampler2D u_materialTexture_3;
uniform sampler2D u_materialTexture_4;
uniform sampler2D u_materialTexture_5;
uniform sampler2D u_materialTexture_6;
uniform sampler2D u_materialTexture_7;

uniform sampler2D u_shadowTexture;

in vec2 v_uv;
in vec4 v_color;
in vec3 v_lighting;
in vec4 v_shadow_uv;
in float v_shadowMappingMode;
in vec2 v_shadowMapTexelSize;

flat in int v_diffuseTextureIndex;
flat in int v_sphereTextureIndex;
flat in int v_sphereTextureType;
flat in int v_toonTextureIndex;

out vec4 finalColor;

void main() {
    if (v_shadowMappingMode > 0.5) return;

    vec4 baseColor = v_color;

    if (v_diffuseTextureIndex == 0) baseColor = texture(u_materialTexture_0, v_uv);
    else if (v_diffuseTextureIndex == 1) baseColor = texture(u_materialTexture_1, v_uv);
    else if (v_diffuseTextureIndex == 2) baseColor = texture(u_materialTexture_2, v_uv);
    else if (v_diffuseTextureIndex == 3) baseColor = texture(u_materialTexture_3, v_uv);
    else if (v_diffuseTextureIndex == 4) baseColor = texture(u_materialTexture_4, v_uv);
    else if (v_diffuseTextureIndex == 5) baseColor = texture(u_materialTexture_5, v_uv);
    else if (v_diffuseTextureIndex == 6) baseColor = texture(u_materialTexture_6, v_uv);
    else if (v_diffuseTextureIndex == 7) baseColor = texture(u_materialTexture_7, v_uv);

    vec3 shadow_uv = v_shadow_uv.xyz / v_shadow_uv.w;

    float currentDepth = shadow_uv.z - 0.006;
    float inShadow = 0.0;

    for (int x = -shadowMap_pcfRange; x <= shadowMap_pcfRange; x++) {
        for (int y = -shadowMap_pcfRange; y <= shadowMap_pcfRange; y++) {
            float projectedDepth = texture(u_shadowTexture, shadow_uv.xy + vec2(x, y) * v_shadowMapTexelSize).r;
            if (projectedDepth < currentDepth) inShadow += 1.0;
        }
    };

    float inShadowPercentage = inShadow / shadowMap_totalPcfSamples;
    float lightFactor = 1.0 - (inShadowPercentage * 0.33);

    finalColor = vec4(baseColor.rgb * v_lighting * lightFactor, baseColor.a);
}