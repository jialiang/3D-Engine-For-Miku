#version 300 es

layout(location = 0) in vec3 a_position;

//#include uniforms

out vec4 v_shadow_uv;

void main() {
  vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
