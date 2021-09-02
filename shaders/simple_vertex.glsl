#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;

layout(location = 3) in vec3 a_normal;

uniform Model {
  mat4 u_modelMatrix;
  mat4 u_normalMatrix;
};

uniform Camera {
  mat4 u_projectionMatrix;
  mat4 u_viewMatrix;
};

out vec4 v_color;

void main() {
  gl_PointSize = 25.0;
  gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(a_position, 1.0);

  v_color = a_color;
}