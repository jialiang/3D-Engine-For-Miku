#version 300 es

layout(location = 0) in vec3 a_position;

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

out vec4 v_shadow_uv;

void main() {
  vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
