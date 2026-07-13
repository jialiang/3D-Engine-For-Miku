// Percentage-Closer Soft Shadows (PCSS), following the NVIDIA paper:
// https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf
//
// 1. blocker search: average the distance of occluders around the fragment
// 2. penumbra estimation with the paper's parallel-planes formula:
//    wPenumbra = (dReceiver - dBlocker) * wLight / dBlocker
// 3. percentage-closer filtering with a kernel sized by the penumbra
//
// This file is shared by every shadow-receiving fragment shader: it is
// spliced in where a "//#include shadow" marker appears (see onload in
// index.html). The sample counts (36 for the search, 64 for the filter)
// are the ones the paper reports.

const int blockerSearchGridSize = 6;
const int pcfGridSize = 8;

// the paper's wLight: how wide the area light is, in world units
// (the model is about 20 units tall), this is the one artistic knob
// and larger values give softer shadows
const float lightWorldSize = 3.0;

// the light frustum set up in index.html and Light.js: mat4.ortho with
// projectionSize 30 and near 0.1, far 100 (ortho depth is linear, so
// these constants also convert [0, 1] depths back to distances)
const float lightNearDistance = 0.1;
const float lightFarDistance = 100.0;
const float lightFrustumHeight = 30.0;

// practical guards the paper leaves out: keep the sparse filter kernel
// from spreading so wide that it bands, and never sharper than 1 texel
const float minFilterRadiusTexels = 1.0;
const float maxFilterRadiusTexels = 24.0;

// depth offset to stop surfaces from shadowing themselves
const float shadowBias = 0.006;

uniform sampler2D u_shadowTexture;

float depthToDistance(float depth) {
    return lightNearDistance + depth * (lightFarDistance - lightNearDistance);
}

// a stable pseudo random value per screen pixel
// (interleaved gradient noise, Jimenez 2014)
float interleavedGradientNoise(vec2 fragmentCoordinate) {
    return fract(52.9829189 * fract(dot(fragmentCoordinate, vec2(0.06711056, 0.00583715))));
}

// rotating the sample grid by a random angle per pixel turns the
// banding a regular grid produces into unobtrusive noise
mat2 randomSampleRotation() {
    float angle = interleavedGradientNoise(gl_FragCoord.xy) * 6.28318;
    float sine = sin(angle);
    float cosine = cos(angle);

    return mat2(cosine, sine, -sine, cosine);
}

// how far one world unit reaches in shadow map UV, per axis
// (the frustum is lightFrustumHeight tall and aspect ratio times
// that wide, and the texel size vector encodes the same aspect ratio)
vec2 uvPerWorldUnit(vec2 texelSize) {
    return vec2(texelSize.x / texelSize.y, 1.0) / lightFrustumHeight;
}

// average distance of the shadow casters around the fragment,
// or -1.0 when nothing blocks the light
float averageBlockerDistance(vec2 uv, float receiverDistance, vec2 texelSize, mat2 rotation) {
    // the search region is the light projected through the receiver
    // onto the shadow map plane, as described in the paper
    float searchWidth = lightWorldSize * (receiverDistance - lightNearDistance) / receiverDistance;
    vec2 searchRadiusUv = 0.5 * searchWidth * uvPerWorldUnit(texelSize);

    float gridCenter = float(blockerSearchGridSize - 1) * 0.5;

    float distanceSum = 0.0;
    float blockerCount = 0.0;

    for (int x = 0; x < blockerSearchGridSize; x++) {
        for (int y = 0; y < blockerSearchGridSize; y++) {
            vec2 offset = rotation * ((vec2(x, y) - gridCenter) / gridCenter) * searchRadiusUv;
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
float shadowedFraction(vec2 uv, float receiverDistance, vec2 filterRadiusUv, mat2 rotation) {
    float gridCenter = float(pcfGridSize - 1) * 0.5;

    float shadowedCount = 0.0;

    for (int x = 0; x < pcfGridSize; x++) {
        for (int y = 0; y < pcfGridSize; y++) {
            vec2 offset = rotation * ((vec2(x, y) - gridCenter) / gridCenter) * filterRadiusUv;
            float sampleDistance = depthToDistance(texture(u_shadowTexture, uv + offset).r);

            if (sampleDistance < receiverDistance) shadowedCount += 1.0;
        }
    }

    return shadowedCount / float(pcfGridSize * pcfGridSize);
}

// how much light reaches the fragment: 1.0 fully lit,
// down to 0.33 fully shadowed
float shadowLightFactor(vec4 shadowPosition, vec2 texelSize) {
    vec3 shadowUv = shadowPosition.xyz / shadowPosition.w;

    // outside the shadow map nothing is known about occluders, so the
    // shadow fades out toward the border instead of ending in a hard
    // cut where the light frustum ends
    vec2 borderDistance = min(shadowUv.xy, 1.0 - shadowUv.xy);
    float borderFade = smoothstep(0.0, 0.1, min(borderDistance.x, borderDistance.y));

    if (borderFade <= 0.0) return 1.0;

    mat2 rotation = randomSampleRotation();

    float receiverDistance = depthToDistance(shadowUv.z - shadowBias);
    float blockerDistance =
        averageBlockerDistance(shadowUv.xy, receiverDistance, texelSize, rotation);

    if (blockerDistance < 0.0) return 1.0;

    // the paper's penumbra estimate, wLight scaled by how far the
    // receiver sits behind its occluder
    float penumbraWidth = (receiverDistance - blockerDistance) * lightWorldSize / blockerDistance;

    // the ortho projection maps world sizes onto the shadow map 1:1
    vec2 filterRadiusUv = 0.5 * penumbraWidth * uvPerWorldUnit(texelSize);

    vec2 minRadiusUv = minFilterRadiusTexels * texelSize;
    vec2 maxRadiusUv = maxFilterRadiusTexels * texelSize;
    filterRadiusUv = clamp(filterRadiusUv, minRadiusUv, maxRadiusUv);

    float inShadowPercentage =
        shadowedFraction(shadowUv.xy, receiverDistance, filterRadiusUv, rotation);

    return 1.0 - inShadowPercentage * 0.67 * borderFade;
}
