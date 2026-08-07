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

// The hood ribbons' baked cloth swing, as vertex modes (see RibbonBasis.js). Rows are vertex
// ids of the primitive this is active for. Zero modes means the primitive has no basis, which
// is every part but the hood.
uniform sampler2D u_ribbonBasis;
uniform float u_ribbonModes;
uniform float u_ribbonWeights[24];

// The texture's fixed columns, ahead of the modes. RibbonBasis.js packs them and states what
// each one holds. These must agree with RibbonBasis.firstMode and RibbonBasis.fans.
const int RIBBON_REST = 0;
const int RIBBON_FAN_A = 1;
const int RIBBON_FAN_B = 2;
const int RIBBON_MEAN = 3;
const int RIBBON_FIRST_MODE = 4;

out vec2 v_uv;
out vec3 v_worldNormal;
out vec3 v_worldPosition;
out vec4 v_shadow_uv;

// Where a vertex has swung to, relative to its bind position. Added BEFORE skinning, in bind
// space, so the ordinary palette carries it to world and the shadow pass below gets it for
// free rather than needing its own copy of the term.
//
// Takes the vertex rather than reading gl_VertexID, because deriving the normal below asks
// the same question about this vertex's neighbours.
vec3 ribbonDisplacement(int vertex) {
  vec3 displacement = texelFetch(u_ribbonBasis, ivec2(RIBBON_MEAN, vertex), 0).xyz;

  // The bound is constant because a loop bound cannot be a uniform here. U_ribbonModes
  // stops the loop early and RibbonBasis refuses a basis with more modes than this, so the
  // two must agree: RibbonBasis.maxModes is where the count is chosen and justified.
  for (int mode = 0; mode < 24; mode++) {
    if (float(mode) >= u_ribbonModes) break;

    displacement += u_ribbonWeights[mode] *
        texelFetch(u_ribbonBasis, ivec2(RIBBON_FIRST_MODE + mode, vertex), 0).xyz;
  }

  return displacement;
}

// One triangle of the stencil, added to the running normals before and after the cloth moved.
// The cross products are left un-normalised so each face counts for its own area.
void accumulateFan(float first, float second, vec3 restSelf, vec3 movedSelf,
    inout vec3 restNormal, inout vec3 movedNormal) {
  if (first < 0.0) return;

  int left = int(first);
  int right = int(second);

  vec3 restLeft = texelFetch(u_ribbonBasis, ivec2(RIBBON_REST, left), 0).xyz;
  vec3 restRight = texelFetch(u_ribbonBasis, ivec2(RIBBON_REST, right), 0).xyz;

  restNormal += cross(restLeft - restSelf, restRight - restSelf);
  movedNormal += cross(restLeft + ribbonDisplacement(left) - movedSelf,
      restRight + ribbonDisplacement(right) - movedSelf);
}

// Rotate a vector by the shortest rotation carrying one unit vector onto another, which is
// Rodrigues' formula with the angle read off the cross and dot products rather than given.
// Two opposed vectors leave no axis to turn about, so the vector is returned unchanged.
vec3 rotateBetween(vec3 vector, vec3 from, vec3 to) {
  vec3 axis = cross(from, to);
  float sine = length(axis);

  if (sine < 1e-6) return vector;

  vec3 unit = axis / sine;
  float cosine = dot(from, to);

  return vector * cosine + cross(unit, vector) * sine + unit * dot(unit, vector) * (1.0 - cosine);
}

// THE CLOTH'S NORMAL, REBUILT FROM ITS OWN POSITIONS. Nothing about the normal is baked: the
// stencil in columns 1 and 2 names up to three triangles this vertex is a corner of and
// crossing their edges before and after the swing says how far the surface turned.
//
// What is applied is that ROTATION, carried onto the normal the artist authored, rather than
// the derived normal itself. The bind pose is then untouched and the stencil's standing
// disagreement with the authored normal cancels instead of shipping as a constant error.
//
// A vertex whose faces all straddle the ribbon's boundary gets no stencil and keeps its
// authored normal: 8 of the 244 are in that position, all at the knot.
vec3 ribbonNormal(vec3 normal, vec3 restSelf, vec3 movedSelf) {
  vec3 first = texelFetch(u_ribbonBasis, ivec2(RIBBON_FAN_A, gl_VertexID), 0).xyz;
  vec3 second = texelFetch(u_ribbonBasis, ivec2(RIBBON_FAN_B, gl_VertexID), 0).xyz;

  vec3 restNormal = vec3(0.0);
  vec3 movedNormal = vec3(0.0);

  accumulateFan(first.x, first.y, restSelf, movedSelf, restNormal, movedNormal);
  accumulateFan(first.z, second.x, restSelf, movedSelf, restNormal, movedNormal);
  accumulateFan(second.y, second.z, restSelf, movedSelf, restNormal, movedNormal);

  if (length(restNormal) < 1e-9 || length(movedNormal) < 1e-9) return normal;

  return rotateBetween(normal, normalize(restNormal), normalize(movedNormal));
}

void main() {
  mat4 skinMatrix = a_boneWeights.x * u_bones[a_boneIndices.x] +
      a_boneWeights.y * u_bones[a_boneIndices.y] + a_boneWeights.z * u_bones[a_boneIndices.z] +
      a_boneWeights.w * u_bones[a_boneIndices.w];

  vec3 bindPosition = a_position;
  bool isRibbon = u_ribbonModes >= 0.5;

  if (isRibbon) bindPosition += ribbonDisplacement(gl_VertexID);

  vec4 worldPosition = u_modelMatrix * (skinMatrix * vec4(bindPosition, 1.0));

  // always pass the uv so the shadow pass can alpha-cut hair and lace
  v_uv = a_uv;

  // Left before the normal is derived, which the depth-only pass never reads.
  if (u_shadowMappingMode > 0.5) {
    gl_Position = u_lightProjectionMatrix * u_lightViewMatrix * worldPosition;
    return;
  }

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  vec3 bindNormal = isRibbon ? ribbonNormal(a_normal, a_position, bindPosition) : a_normal;

  // no non-uniform scale rides in the palette (bones rotate and translate),
  // so the skin matrix rotates normals directly
  v_worldNormal = (u_normalMatrix * vec4(mat3(skinMatrix) * bindNormal, 0.0)).xyz;
  v_worldPosition = worldPosition.xyz;
  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
