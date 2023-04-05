#define STEPSIZE .1
#define DENSCALE .1

void main() {
  // Compute the pixel's position in view space.
  vec2 fragCoord = gl_FragCoord.xy / resolution.xy;
  vec3 viewPos = vec3((fragCoord * 2.0 - 1.0), 0.5);
  viewPos.y *= -1.0; // Flip Y axis to match WebGL convention.

  vec3 camPos = vec3(.5 + m.x * .5, .5 + m.y * .5, -.25);
  vec3 camDir = vec3(1., 1., 1.);

  // Convert the pixel's position to world space.
  vec3 worldPos = camPos + viewPos * length(camDir);

  // Compute the ray direction in world space.
  vec3 rayDir = normalize(worldPos - camPos);

  // Initialize the color and transparency values.
  vec4 color = vec4(0.0);
  float alpha = 0.0;

  // Perform the ray-marching loop.
  for (float t = 0.0; t < 2.0; t += STEPSIZE) {
    // Compute the position along the ray.
    vec3 pos = camPos + rayDir * t;

    // Sample the density at the current position.
    float density = texture(test3d, pos).x * DENSCALE;

    // Accumulate the color and transparency values.
    vec4 sampleColor = vec4(1.0, 0.5, 0.2, 1.0);
    color += (1.0 - alpha) * sampleColor * density;
    alpha += (1.0 - alpha) * density;

    // Stop marching if the transparency reaches 1.0.
    if (alpha >= 1.0) {
      break;
    }
  }

  // Output the final color and transparency.
  o = vec4(color.rgb, alpha);
}
