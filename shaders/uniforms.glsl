// The engine-wide uniform blocks, shared by every shader so the block layouts can never drift apart.
// Spliced in where a "//#include uniforms" marker appears (see onload in index.js).
// A shader may leave some blocks unused. Block and member activity is decided per program, not per stage.

uniform Model {
  mat4 u_modelMatrix;
  mat4 u_normalMatrix;
};

uniform Camera {
  mat4 u_projectionMatrix;
  mat4 u_viewMatrix;
  vec3 u_cameraPosition;
};

uniform Light {
  vec3 u_lightColor;
  vec3 u_lightDirection;
  mat4 u_lightProjectionMatrix;
  mat4 u_lightViewMatrix;
  mat4 u_lightTransformationMatrix;
};

uniform Shadow {
  float u_shadowMappingMode;
  vec2 u_shadowMapTexelSize;
};
