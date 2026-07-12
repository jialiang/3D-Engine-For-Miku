#version 300 es

precision highp float;
precision highp sampler2DArray;

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

// all material textures share one texture array, and a layer index of
// 255 marks a material that has no texture at all
uniform sampler2DArray u_materialTextures;

uniform sampler2D u_shadowTexture;
uniform sampler2DArray u_toonTextures;

uniform Material {
    vec4 u_diffuseColor[32];
    vec4 u_diffuseTextureIndex[32];
    vec4 u_sphereTextureIndex[32];
    vec4 u_sphereTextureType[32];
    vec4 u_toonTextureIndex[32];
    vec4 u_ambientColor[32];
    vec4 u_specularity[32];
    vec4 u_specularColor[32];
};

uniform Light {
    vec3 u_lightColor;
    vec3 u_lightDirection;
    mat4 u_lightProjectionMatrix;
    mat4 u_lightViewMatrix;
    mat4 u_lightTransformationMatrix;
};

uniform Camera {
    mat4 u_projectionMatrix;
    mat4 u_viewMatrix;
    vec3 u_cameraPosition;
};

in vec2 v_uv;
in vec4 v_color;
in vec3 v_worldNormal;
in vec3 v_worldPosition;
in vec4 v_shadow_uv;
in float v_shadowMappingMode;
in vec2 v_shadowMapTexelSize;

flat in int v_material;
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

    vec3 normalDirection = normalize(v_worldNormal);

    vec4 baseColor = v_color;

    if (v_diffuseTextureIndex != 255) {
        baseColor = texture(u_materialTextures, vec3(v_uv, v_diffuseTextureIndex));
    }

    // MMD sphere maps: fake environment highlights looked up by the
    // view-space normal (.sph multiplies, .spa adds)
    if (v_sphereTextureIndex != 255) {
        vec3 viewNormal = normalize((u_viewMatrix * vec4(normalDirection, 0.0)).xyz);
        vec2 sphere_uv = vec2(0.5 + viewNormal.x * 0.5, 0.5 - viewNormal.y * 0.5);
        vec3 sphereColor = texture(u_materialTextures, vec3(sphere_uv, v_sphereTextureIndex)).rgb;

        if (v_sphereTextureType == 1) baseColor.rgb *= sphereColor;
        if (v_sphereTextureType == 0) baseColor.rgb += sphereColor;
    }

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

    float lightIntensity = dot(normalDirection, normalize(u_lightDirection));

    if (lightIntensity < 0.1) lightIntensity = 0.1;

    vec3 ambientLight = u_ambientColor[v_material].rgb;
    vec3 lighting = u_lightColor * lightIntensity + ambientLight;

    vec2 toon_uv = vec2(0.0, lightIntensity * 0.5 + 0.5);
    vec4 toonColor = texture(u_toonTextures, vec3(toon_uv, v_toonTextureIndex));

    lighting = lighting * 0.75 + lighting * toonColor.rgb * 0.25;

    // Phong specular highlight, sized by the material's shininess
    // (zero shininess means the material has no specular term)
    float shininess = u_specularity[v_material].x;
    vec3 specular = vec3(0.0);

    if (shininess > 0.0) {
        vec3 viewDirection = normalize(u_cameraPosition - v_worldPosition);
        vec3 reflection = reflect(-normalize(u_lightDirection), normalDirection);
        float highlight = pow(max(dot(reflection, viewDirection), 0.0), shininess);

        // a low shininess makes a very broad highlight, which reads as
        // plastic on large smooth surfaces like skin, so scale strength
        // down as the highlight gets broader (raise to damp more)
        float broadnessDamping = 16.0;
        float strength = shininess / (shininess + broadnessDamping);

        specular = u_specularColor[v_material].rgb * u_lightColor * highlight * strength;
    }

    finalColor = vec4((baseColor.rgb * lighting + specular) * lightFactor, baseColor.a);
}
