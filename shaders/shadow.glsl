// Simple shadow mapping with a soft, uniform PCF kernel:
// a plain depth compare projects the caster's real silhouette
// and the PCF softens the edge by a fixed amount everywhere.
//
// The softness is uniform (no contact hardening), which suits the stylised look.
//
// This file is shared by every shadow-receiving fragment shader: it is spliced
// in where a "//#include shadow" marker appears (see onload in index.js).

// radius of the soft edge, in shadow-map texels
const float pcfRadiusTexels = 8.0;

const float shadowBias = 0.00125;

// 32 samples on the unit disk in a Vogel (sunflower) spiral:
// evenly spaced by construction, so the extra taps genuinely fill the kernel and cut banding,
// rather than clumping the way a hand-picked point set can.
const int sampleCount = 32;
const vec2 sampleDisk[32] = vec2[](
    vec2(0.125000, 0.000000), vec2(-0.159645, 0.146248),
    vec2(0.024436, -0.278438), vec2(0.201222, 0.262459),
    vec2(-0.369268, -0.065318), vec2(0.349802, -0.222516),
    vec2(-0.117002, 0.435242), vec2(-0.223136, -0.429634),
    vec2(0.484115, 0.176798), vec2(-0.503641, 0.207896),
    vec2(0.242788, -0.518824), vec2(0.179414, 0.572001),
    vec2(-0.540757, -0.313380), vec2(0.634370, -0.139464),
    vec2(-0.387146, 0.550675), vec2(-0.089440, -0.690200),
    vec2(0.549072, 0.462758), vec2(-0.738878, 0.030555),
    vec2(0.538955, -0.536332), vec2(-0.036058, 0.779792),
    vec2(-0.512818, -0.614527), vec2(0.812360, 0.109302),
    vec2(-0.688311, 0.478909), vec2(0.188086, -0.836061),
    vec2(0.435033, 0.759191), vec2(-0.850448, -0.271316),
    vec2(0.826102, -0.381680), vec2(-0.357888, 0.855156),
    vec2(-0.319407, -0.888034), vec2(0.849909, 0.446688),
    vec2(-0.944035, 0.248845), vec2(0.536596, -0.834530)
);

// plain depth sampler: each tap reads a depth and is compared by hand below.
uniform highp sampler2D u_shadowTexture;

// how much light reaches the fragment: 1.0 fully lit, down to 0.33 fully shadowed
float shadowLightFactor(vec4 shadowPosition, vec2 texelSize) {
    vec3 shadowUv = shadowPosition.xyz / shadowPosition.w;

    // outside the map nothing is known about occluders, so fade the shadow out
    // toward the border instead of cutting hard where the light frustum ends
    vec2 borderDistance = min(shadowUv.xy, 1.0 - shadowUv.xy);
    float borderFade = smoothstep(0.0, 0.1, min(borderDistance.x, borderDistance.y));

    if (borderFade <= 0.0) return 1.0;

    float receiverDepth = shadowUv.z - shadowBias;
    vec2 radiusUv = pcfRadiusTexels * texelSize;

    float shadowedCount = 0.0;

    for (int i = 0; i < sampleCount; i++) {
        float occluderDepth = texture(u_shadowTexture, shadowUv.xy + sampleDisk[i] * radiusUv).r;

        if (receiverDepth > occluderDepth) shadowedCount += 1.0;
    }

    float inShadow = shadowedCount / float(sampleCount);

    return 1.0 - inShadow * 0.67 * borderFade;
}
