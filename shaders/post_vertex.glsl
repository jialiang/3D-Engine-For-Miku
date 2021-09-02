#version 300 es

layout(location = 0) in vec3 a_position;

out vec2 uv;

void main(void) {
    uv = vec2((a_position.x + 1.0) / 2.0, (a_position.y + 1.0) / 2.0);

    gl_Position = vec4(a_position, 1.0);
}