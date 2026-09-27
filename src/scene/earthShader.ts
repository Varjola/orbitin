export const earthVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const earthFragmentShader = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMask;
  uniform vec3 uSunDirRender;
  uniform float uTextureUOffset;
  uniform float uTextureVFlip;
  uniform float uAmbient;
  uniform float uDaylightExposure;
  uniform float uTerminatorSoft;
  uniform float uNightIntensity;
  uniform vec3 uNightTint;
  uniform vec3 uSunExtinction;
  uniform float uChapmanK;
  // 0 imagery, 1 map, 2 lab.
  uniform float uStyle;
  uniform sampler2D uMapTexture;
  uniform float uMapAmbient;
  uniform vec3 uLabColor;
  uniform vec3 uLabEquatorColor;

  varying vec2 vUv;
  varying vec3 vWorldNormal;

  vec3 srgbToLinear(vec3 value) {
    vec3 low = value / 12.92;
    vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), value));
  }

  void main() {
    if (uStyle > 1.5) {
      // Lab: a plain ball in soft light, day and night still readable, with
      // a thin equator ring (the uv row at v = 0.5).
      vec3 normal = normalize(vWorldNormal);
      float soft = 0.72 + 0.28 * max(dot(normal, normalize(uSunDirRender)), 0.0);
      float equatorDistance = abs(vUv.y - 0.5) / max(fwidth(vUv.y), 1e-5);
      float equator = 1.0 - smoothstep(0.5, 1.5, equatorDistance);
      gl_FragColor = vec4(mix(uLabColor * soft, uLabEquatorColor, equator * 0.7), 1.0);
      #include <colorspace_fragment>
      return;
    }
    // Texture-space alignment only; the mesh transform stays physical. The v
    // flip corrects the asset's UV layout, not Earth's orientation.
    float correctedV = mix(vUv.y, 1.0 - vUv.y, uTextureVFlip);
    // No fract() around u: wrapS is RepeatWrapping, so the sampler already
    // wraps, and fract() breaks the UV derivative at the wrap - which selects
    // the smallest mip for that one column and draws a seam down the globe.
    vec2 correctedUv = vec2(vUv.x + uTextureUOffset, correctedV);
    // KTX2Loader uploads the sRGB day texture with an sRGB internal format;
    // sampling performs the single required decode before linear lighting.
    vec3 dayLinear = texture2D(uDayMap, correctedUv).rgb;
    float nightMask = texture2D(uNightMask, correctedUv).r;
    vec3 normal = normalize(vWorldNormal);
    float ndl = dot(normal, normalize(uSunDirRender));
    float lit = max(ndl, 0.0);
    // Sunlight crossing the atmosphere at a low angle loses its blue first,
    // so the ground warms towards the terminator. Relative to the overhead
    // Sun, so the imagery keeps its colour at midday.
    float airMass = 1.0 / (uChapmanK + (1.0 - uChapmanK) * lit);
    vec3 sunColor = exp(-uSunExtinction * (airMass - 1.0));
    float day = smoothstep(-uTerminatorSoft, uTerminatorSoft, ndl);
    // Exposure scales the direct term only, so lifting the sunlit side never
    // brightens the night side out from under the city lights.
    vec3 color;
    if (uStyle > 0.5) {
      // Map: an atlas drawn in the browser (CanvasTexture, flipY and sRGB),
      // lit with more ambient so the night side stays readable; no lights.
      vec3 mapLinear = texture2D(uMapTexture, vec2(vUv.x + uTextureUOffset, vUv.y)).rgb;
      color = mapLinear * (uMapAmbient + (1.0 - uMapAmbient) * lit * sunColor);
    } else {
      vec3 daylight = dayLinear * (uAmbient + uDaylightExposure * (1.0 - uAmbient) * lit * sunColor);
      float cityLights = nightMask * (1.0 - day) * uNightIntensity;
      color = daylight + cityLights * uNightTint;
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`
