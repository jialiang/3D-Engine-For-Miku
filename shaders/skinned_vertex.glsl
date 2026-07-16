#version 300 es

// Vertex shader for the skinned glTF mesh: 4-bone matrix-palette skinning.
// Each vertex blends the palette matrices of its four influencing joints.
// A palette entry is jointWorld * inverseBind (identity while the pose is
// the bind pose), uploaded by BoneArrayUbo.

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec3 a_normal;
layout(location = 4) in ivec4 a_boneIndices;
layout(location = 5) in vec4 a_boneWeights;

//#include uniforms

// Sized for the largest rig we expect rather than this model's 143 joints:
// 192 mat4 = 12KB, inside the 16KB uniform-block minimum.
// Only the skinned joints ride in the palette, the full control rig
// stays CPU-side.
uniform Bone {
  mat4 u_bones[192];
};

out vec2 v_uv;
out vec3 v_worldNormal;
out vec3 v_worldPosition;
out vec4 v_shadow_uv;

void main() {
  mat4 skinMatrix = a_boneWeights.x * u_bones[a_boneIndices.x] +
      a_boneWeights.y * u_bones[a_boneIndices.y] + a_boneWeights.z * u_bones[a_boneIndices.z] +
      a_boneWeights.w * u_bones[a_boneIndices.w];

  vec4 worldPosition = u_modelMatrix * (skinMatrix * vec4(a_position, 1.0));

  // always pass the uv so the shadow pass can alpha-cut hair and lace
  v_uv = a_uv;

  if (u_shadowMappingMode > 0.5) {
    gl_Position = u_lightProjectionMatrix * u_lightViewMatrix * worldPosition;
    return;
  }

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  // no non-uniform scale rides in the palette (bones rotate and translate),
  // so the skin matrix rotates normals directly
  v_worldNormal = (u_normalMatrix * vec4(mat3(skinMatrix) * a_normal, 0.0)).xyz;
  v_worldPosition = worldPosition.xyz;
  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
