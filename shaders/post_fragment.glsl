#version 300 es

precision mediump float;

uniform sampler2D u_texture;

in vec2 uv;

out vec4 finalColor;

void main(void) {
    finalColor = texture(u_texture, uv);
}
