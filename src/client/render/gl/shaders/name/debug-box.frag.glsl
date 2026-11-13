#version 300 es
precision highp float;

in vec2 vUV;
flat in int vBoxType;
flat in vec4 vColor;

uniform float uRenderPx; // a renderDpr() px in canvas px (1 unless fast mode)

out vec4 fragColor;

void main() {
  if (vColor.a <= 0.0) discard;

  if (vBoxType == 2) {
    // Center crosshair — draw a + shape, discard the four corner quadrants
    float cx = abs(vUV.x - 0.5);
    float cy = abs(vUV.y - 0.5);
    // Each arm is 0.15 wide (30% of half-width)
    if (cx > 0.15 && cy > 0.15) discard;
    fragColor = vColor;
  } else {
    // Wireframe border for name/flag boxes
    // 1.5 renderDpr() pixels, but at least one canvas pixel: the border has
    // no anti-aliasing, so a thinner one would miss whole pixel rows.
    float borderWidth = max(1.5 * uRenderPx, 1.0);
    vec2 pixelSize = fwidth(vUV);
    vec2 border = borderWidth * pixelSize;

    if (vUV.x > border.x && vUV.x < 1.0 - border.x &&
        vUV.y > border.y && vUV.y < 1.0 - border.y) {
      discard;
    }
    fragColor = vColor;
  }
}
