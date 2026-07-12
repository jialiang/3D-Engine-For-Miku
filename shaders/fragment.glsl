#version 300 es

precision mediump float;

// Percentage-Closer Soft Shadows (PCSS), following the NVIDIA paper:
// https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf
//
// 1. blocker search: average the distance of occluders around the fragment
// 2. penumbra estimation with the paper's parallel-planes formula:
//    wPenumbra = (dReceiver - dBlocker) * wLight / dBlocker
// 3. percentage-closer filtering with a kernel sized by the penumbra
//
// the sample counts (36 for the search, 64 for the filter) are the ones
// the paper reports

const int blockerSearchGridSize = 6;
const int pcfGridSize = 8;

// the paper's wLight: how wide the area light is, in world units
// (the model is about 20 units tall), this is the one artistic knob
// and larger values give softer shadows
const float lightWorldSize = 3.0;

// the light frustum set up in Light.js: mat4.ortho, 25 world units tall
// with near 0.1 and far 100, ortho depth is linear so these constants
// also convert [0, 1] depth values back to distances from the light
const float lightNearDistance = 0.1;
const float lightFarDistance = 100.0;
const float lightFrustumHeight = 25.0;

// practical guards the paper leaves out: keep the sparse filter kernel
// from spreading so wide that it bands, and never sharper than 1 texel
const float minFilterRadiusTexels = 1.0;
const float maxFilterRadiusTexels = 24.0;

// depth offset to stop surfaces from shadowing themselves
const float shadowBias = 0.006;

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

float depthToDistance(float depth) {
    return lightNearDistance + depth * (lightFarDistance - lightNearDistance);
}

// how far one world unit reaches in shadow map UV, per axis
// (the frustum is lightFrustumHeight tall and aspect ratio times
// that wide, and the texel size vector encodes the same aspect ratio)
vec2 uvPerWorldUnit() {
    return vec2(v_shadowMapTexelSize.x / v_shadowMapTexelSize.y, 1.0) / lightFrustumHeight;
}

// average distance of the shadow casters around the fragment,
// or -1.0 when nothing blocks the light
float averageBlockerDistance(vec2 uv, float receiverDistance) {
    // the search region is the light projected through the receiver
    // onto the shadow map plane, as described in the paper
    float searchWidth = lightWorldSize * (receiverDistance - lightNearDistance) / receiverDistance;
    vec2 searchRadiusUv = 0.5 * searchWidth * uvPerWorldUnit();

    float gridCenter = float(blockerSearchGridSize - 1) * 0.5;

    float distanceSum = 0.0;
    float blockerCount = 0.0;

    for (int x = 0; x < blockerSearchGridSize; x++) {
        for (int y = 0; y < blockerSearchGridSize; y++) {
            vec2 offset = (vec2(x, y) - gridCenter) / gridCenter * searchRadiusUv;
            float sampleDistance = depthToDistance(texture(u_shadowTexture, uv + offset).r);

            if (sampleDistance < receiverDistance) {
                distanceSum += sampleDistance;
                blockerCount += 1.0;
            }
        }
    }

    if (blockerCount == 0.0) return -1.0;

    return distanceSum / blockerCount;
}

// fraction of the filter window that is in shadow
float shadowedFraction(vec2 uv, float receiverDistance, vec2 filterRadiusUv) {
    float gridCenter = float(pcfGridSize - 1) * 0.5;

    float shadowedCount = 0.0;

    for (int x = 0; x < pcfGridSize; x++) {
        for (int y = 0; y < pcfGridSize; y++) {
            vec2 offset = (vec2(x, y) - gridCenter) / gridCenter * filterRadiusUv;
            float sampleDistance = depthToDistance(texture(u_shadowTexture, uv + offset).r);

            if (sampleDistance < receiverDistance) shadowedCount += 1.0;
        }
    }

    return shadowedCount / float(pcfGridSize * pcfGridSize);
}

void main() {
    if (v_shadowMappingMode > 0.5) return;

    vec4 baseColor = v_color;

    if (v_diffuseTextureIndex == 0) baseColor = texture(u_materialTexture_0, v_uv);
    // else if (v_diffuseTextureIndex == 1) baseColor = texture(u_materialTexture_1, v_uv);
    // else if (v_diffuseTextureIndex == 2) baseColor = texture(u_materialTexture_2, v_uv);
    // else if (v_diffuseTextureIndex == 3) baseColor = texture(u_materialTexture_3, v_uv);
    // else if (v_diffuseTextureIndex == 4) baseColor = texture(u_materialTexture_4, v_uv);
    // else if (v_diffuseTextureIndex == 5) baseColor = texture(u_materialTexture_5, v_uv);
    // else if (v_diffuseTextureIndex == 6) baseColor = texture(u_materialTexture_6, v_uv);
    // else if (v_diffuseTextureIndex == 7) baseColor = texture(u_materialTexture_7, v_uv);

    vec3 shadow_uv = v_shadow_uv.xyz / v_shadow_uv.w;
    float receiverDistance = depthToDistance(shadow_uv.z - shadowBias);

    float blockerDistance = averageBlockerDistance(shadow_uv.xy, receiverDistance);

    float inShadowPercentage = 0.0;

    if (blockerDistance >= 0.0) {
        // the paper's penumbra estimate, wLight scaled by how far the
        // receiver sits behind its occluder
        float penumbraWidth =
            (receiverDistance - blockerDistance) * lightWorldSize / blockerDistance;

        // the ortho projection maps world sizes onto the shadow map 1:1
        vec2 filterRadiusUv = 0.5 * penumbraWidth * uvPerWorldUnit();

        vec2 minRadiusUv = minFilterRadiusTexels * v_shadowMapTexelSize;
        vec2 maxRadiusUv = maxFilterRadiusTexels * v_shadowMapTexelSize;
        filterRadiusUv = clamp(filterRadiusUv, minRadiusUv, maxRadiusUv);

        inShadowPercentage = shadowedFraction(shadow_uv.xy, receiverDistance, filterRadiusUv);
    }

    float lightFactor = 1.0 - (inShadowPercentage * 0.67);

    finalColor = vec4(baseColor.rgb * v_lighting * lightFactor, baseColor.a);
}
