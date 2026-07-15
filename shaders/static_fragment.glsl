#version 300 es

precision highp float;

// Fragment shader for the static glTF model:
// the diffuse is tinted through a 1D toon curve (a lighting ramp) instead of smooth lambert,
// a specular highlight is added from the material's spec map
// and hard-edged parts (hair, lace) are alpha-cut so they need no sorting.

uniform sampler2D u_baseColorTexture;
uniform sampler2D u_toonRamp;
uniform sampler2D u_specTexture;

// per-draw flags:
// - whether a spec map is bound,
// - whether this is a soft blended overlay (the eye decals) rather than a solid alpha-cut part,
// - whether it uses alpha-to-coverage (the skirt lace: its net alpha becomes MSAA coverage,
//   an antialiased cutout instead of a hard cut or blend)
uniform float u_hasSpec;
uniform float u_isOverlay;
uniform float u_alphaToCoverage;

//#include uniforms

//#include shadow

in vec2 v_uv;
in vec3 v_worldNormal;
in vec3 v_worldPosition;
in vec4 v_shadow_uv;

out vec4 finalColor;

const float shininess = 20.0;
const float specularStrength = 0.6;

// the row of the toon-curve texture that holds the real DIVA ramp: a tinted
// shadow colour at u = 0 rising to white at u = 1. The upper rows hold
// unrelated helper curves, so this samples the centre of the bottom pair.
const float toonRampRow = 0.875;

// how strongly the model receives its OWN cast shadow, a touch below the
// floor's full strength so self-shadows on skin do not crush to black
const float selfShadowStrength = 0.8;

void main() {
  vec4 baseColor = texture(u_baseColorTexture, v_uv);

  // Alpha handling by part type. Alpha-to-coverage parts keep their full alpha
  // (it drives MSAA coverage downstream) and only drop fully-transparent texels.
  // Plain solid parts hard-cut at 0.5, turning hair/lace alpha edges into clean order-independent cutouts.
  // Overlays keep their soft alpha for blending.
  bool isCutout = u_alphaToCoverage < 0.5 && u_isOverlay < 0.5;

  if (u_alphaToCoverage > 0.5 && baseColor.a < 0.05) discard;
  if (isCutout && baseColor.a < 0.5) discard;

  // the shadow pass only needs the cutout above, then writes depth
  if (u_shadowMappingMode > 0.5) return;

  vec3 normalDirection = normalize(v_worldNormal);
  vec3 lightDirection = normalize(u_lightDirection);

  // How much the surface faces the light, indexing the toon curve.
  // Straight clamped N.L, not half-Lambert:
  // the DIVA ramp packs its tinted shadow into the low end and whites out by mid,
  // so half-Lambert would push the whole front-lit side to white and wash the model out.
  float toonU = clamp(dot(normalDirection, lightDirection), 0.0, 1.0);

  // received cast shadow, softened toward fully lit (see selfShadowStrength)
  float lightFactor = shadowLightFactor(v_shadow_uv, u_shadowMapTexelSize);
  lightFactor = mix(1.0, lightFactor, selfShadowStrength);

  // The ramp is a full colour lookup (tinted shadow -> white),
  // so it multiplies the base colour directly:
  // that is the whole cel-shading model here,
  // giving a shadow-tinted dark side and a hard terminator without any ambient fill.
  vec3 ramp = texture(u_toonRamp, vec2(toonU, toonRampRow)).rgb;

  vec3 color = baseColor.rgb * ramp * u_lightColor;

  // Blinn-Phong specular, coloured and masked by the material's spec map.
  // Faded out by the toon term so no highlight appears on the dark side of
  // the terminator, where the half-vector can still face the light.
  if (u_hasSpec > 0.5) {
    vec3 viewDirection = normalize(u_cameraPosition - v_worldPosition);
    vec3 halfway = normalize(lightDirection + viewDirection);
    float highlight = pow(max(dot(normalDirection, halfway), 0.0), shininess);

    highlight *= smoothstep(0.0, 0.2, toonU);

    vec3 specColor = texture(u_specTexture, v_uv).rgb;
    color += specColor * highlight * specularStrength * u_lightColor;
  }

  color *= lightFactor;

  // The canvas is composited premultiplied over the page backdrop,
  // so solid cutout parts must write alpha 1.0: propagating the texture's edge alpha
  // (0.5..1 after the cut) would let the backdrop bleed through the silhouette.
  // Overlays keep soft alpha for blending;
  // the alpha-to-coverage lace keeps its alpha because coverage is derived from it.
  float alpha = isCutout ? 1.0 : baseColor.a;

  finalColor = vec4(color, alpha);
}
