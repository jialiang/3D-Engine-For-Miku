#version 300 es

// Vertex shader for a static (unposed) glTF mesh.
// The vertices already sit in model space, so there is no skinning or morphing to do here,
// only the model, camera and light transforms shared with the rest of the engine.

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec3 a_normal;

//#include uniforms

out vec2 v_uv;
out vec3 v_worldNormal;
out vec3 v_worldPosition;
out vec4 v_shadow_uv;

void main() {
  vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);

  // always pass the uv so the shadow pass can alpha-cut hair and lace
  v_uv = a_uv;

  if (u_shadowMappingMode > 0.5) {
    gl_Position = u_lightProjectionMatrix * u_lightViewMatrix * worldPosition;
    return;
  }

  gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;

  v_worldNormal = (u_normalMatrix * vec4(a_normal, 0.0)).xyz;
  v_worldPosition = worldPosition.xyz;
  v_shadow_uv = u_lightTransformationMatrix * worldPosition;
}
