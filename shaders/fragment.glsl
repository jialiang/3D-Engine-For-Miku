#version 300 es

precision highp float;
precision highp sampler2DArray;

// all material textures share one texture array, and a layer index of
// 255 marks a material that has no texture at all
uniform sampler2DArray u_materialTextures;

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

uniform Shadow {
    float u_shadowMappingMode;
    vec2 u_shadowMapTexelSize;
};

//#include shadow

in vec2 v_uv;
in vec4 v_color;
in vec3 v_worldNormal;
in vec3 v_worldPosition;
in vec4 v_shadow_uv;

flat in int v_material;
flat in int v_diffuseTextureIndex;
flat in int v_sphereTextureIndex;
flat in int v_sphereTextureType;
flat in int v_toonTextureIndex;

out vec4 finalColor;

void main() {
    if (u_shadowMappingMode > 0.5) return;

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

    float lightFactor = shadowLightFactor(v_shadow_uv, u_shadowMapTexelSize);

    // wrap ("half-Lambert") lighting: the falloff extends past 90
    // degrees instead of clipping to black, faking the bounce light a
    // bright environment would throw back onto the unlit side
    float lightIntensity =
        dot(normalDirection, normalize(u_lightDirection)) * 0.5 + 0.5;

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
