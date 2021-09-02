#version 300 es

precision highp float;

in vec4 v_color;

out vec4 finalColor;

void main() {
  finalColor =  v_color;
}