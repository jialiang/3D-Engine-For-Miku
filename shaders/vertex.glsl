#version 300 es

precision highp sampler2DArray;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec3 a_normal;
layout(location = 4) in vec3 a_morph;
layout(location = 5) in int a_material;

layout(location = 6) in float a_boneWeight;
layout(location = 7) in vec3 a_distanceFromBone_1;
layout(location = 8) in vec3 a_distanceFromBone_2;
layout(location = 9) in int a_boneIndex_1;
layout(location = 10) in int a_boneIndex_2;

uniform Model {
  mat4 u_modelMatrix;
  mat4 u_normalMatrix;
};

uniform Bone {
  vec4 u_boneTranslation[150];
  vec4 u_boneRotation[150];
};

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

uniform Camera {
  mat4 u_projectionMatrix;
  mat4 u_viewMatrix;
};

uniform Light {
  vec3 u_lightColor;
  vec3 u_lightPosition;
  mat4 u_lightProjectionMatrix;
  mat4 u_lightViewMatrix;
  mat4 u_lightTransformationMatrix;
};

uniform Shadow {
  float u_shadowMappingMode;
  vec2 u_shadowMapTexelSize;
};

uniform sampler2DArray u_toonTextures;

out vec2 v_uv;
out vec4 v_color;
out vec3 v_lighting;
out vec4 v_shadow_uv;
out float v_shadowMappingMode;
out vec2 v_shadowMapTexelSize;

flat out int v_diffuseTextureIndex;
flat out int v_sphereTextureIndex;
flat out int v_sphereTextureType;
flat out int v_toonTextureIndex;

// multiply quaternion by vector
// used to find the new position of a vertex after being rotated by a quaternion
vec3 multiplyVecByQuat(vec3 vector, vec4 quaternion) {
  return vector + 2.0 * cross(cross(vector, quaternion.xyz) - quaternion.w * vector, quaternion.xyz);
}

void main() {
  vec3 boneTranslation_1 = u_boneTranslation[a_boneIndex_1].xyz;
  vec3 boneTranslation_2 = u_boneTranslation[a_boneIndex_2].xyz;

  vec4 boneRotation_1 = u_boneRotation[a_boneIndex_1];
  vec4 boneRotation_2 = u_boneRotation[a_boneIndex_2];

  vec3 positionTransformedByBone1  = multiplyVecByQuat(
    a_distanceFromBone_1 + a_morph,
    boneRotation_1
  ) + boneTranslation_1;

  vec3 positionTransformedByBone2 = multiplyVecByQuat(
    a_distanceFromBone_2 + a_morph,
    boneRotation_2
  ) + boneTranslation_2;

  vec3 normalRotatedByBone1 = multiplyVecByQuat(a_normal, boneRotation_1);
  vec3 normalRotatedByBone2 = multiplyVecByQuat(a_normal, boneRotation_2);

  vec3 position = mix(positionTransformedByBone2, positionTransformedByBone1, a_boneWeight);
  vec3 normal = normalize(mix(normalRotatedByBone2, normalRotatedByBone1, a_boneWeight));

  vec4 worldPosition = (u_modelMatrix * vec4(position, 1.0));
  vec4 worldNormal = (u_normalMatrix * vec4(normal, 1.0));

  if (u_shadowMappingMode > 0.5) {
    gl_Position = u_lightProjectionMatrix * u_lightViewMatrix * worldPosition;
    return;
  }

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  v_uv = a_uv;
  v_color = u_diffuseColor[a_material];

  v_diffuseTextureIndex = int(u_diffuseTextureIndex[a_material].x);
  v_sphereTextureIndex = int(u_sphereTextureIndex[a_material].x);
  v_sphereTextureType = int(u_sphereTextureType[a_material].x);
  v_toonTextureIndex = int(u_toonTextureIndex[a_material].x);

  v_shadowMappingMode = u_shadowMappingMode;
  v_shadowMapTexelSize = u_shadowMapTexelSize;

  vec3 normalDirection = normalize(worldNormal.xyz);
  vec3 lightDirection = normalize(u_lightPosition - worldPosition.xyz);

  float lightIntensity = dot(normalDirection, lightDirection);

  if (lightIntensity < 0.1) lightIntensity = 0.1;

  vec3 ambientLight = u_ambientColor[a_material].rgb;

  v_lighting = u_lightColor * lightIntensity + ambientLight;

  vec2 toon_uv = vec2(0.0, lightIntensity * 0.5 + 0.5);
  vec4 toonColor = texture(u_toonTextures, vec3(toon_uv, v_toonTextureIndex));

  v_lighting = v_lighting * 0.75 + v_lighting * toonColor.rgb * 0.25;

  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
