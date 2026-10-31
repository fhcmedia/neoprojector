import { useEffect, useRef } from "react"
import { Renderer, Program, Mesh, Plane, Transform } from "ogl"
import { sharedTime } from "../clock"

// Vendored from gradflow@0.1.0 (node_modules/gradflow/dist/index.mjs). The
// ONLY change vs upstream is the clock: u_time reads sharedTime() so every
// instance, in every webview window, paints the same frame at the same
// instant. See docs/superpowers/specs/2026-06-12-background-sync-design.md.

type RGB = { r: number; g: number; b: number }
export type GradflowConfig = {
  color1: string | RGB
  color2: string | RGB
  color3: string | RGB
  speed: number
  scale: number
  type: "linear" | "conic" | "animated" | "wave" | "silk" | "smoke" | "stripe"
  noise: number
}

const TYPE_NUMBER: Record<string, number> = {
  linear: 0, conic: 1, animated: 2, wave: 3, silk: 4, smoke: 5, stripe: 6,
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "")
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const n = parseInt(v, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function rgb01(c: string | RGB): [number, number, number] {
  const { r, g, b } = typeof c === "string" ? hexToRgb(c) : c
  return [r / 255, g / 255, b / 255]
}

const VERTEX = `
  attribute vec2 position;
  varying vec2 vUv;

  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

// VERBATIM from gradflow — do not edit the GLSL.
const FRAGMENT = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform float u_time;
  uniform vec3 u_color1;
  uniform vec3 u_color2;
  uniform vec3 u_color3;
  uniform float u_speed;
  uniform float u_scale;
  uniform int u_type;
  uniform float u_noise;
  uniform vec2 u_resolution;

  varying vec2 vUv;

  #define PI 3.14159265359


  // @Utility
  float noise(vec2 st) {
    return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // @Gradient Types
  vec3 linearGradient(vec2 uv, float time) {
    float t = (uv.y * u_scale) + sin(uv.x * PI + time) * 0.1;
    t = clamp(t, 0.0, 1.0);

    return t < 0.5
      ? mix(u_color1, u_color2, t * 2.0)
      : mix(u_color2, u_color3, (t - 0.5) * 2.0);
  }

  vec3 conicGradient(vec2 uv, float time) {
    vec2 center = vec2(0.5);
    vec2 pos = uv - center;

    float angle = atan(pos.y, pos.x);
    float normalizedAngle = (angle + PI) / (2.0 * PI);

    float t = fract(normalizedAngle * u_scale + time * 0.3);
    float smoothT = t;

    vec3 color;
    if (smoothT < 0.33) {
      color = mix(u_color1, u_color2, smoothstep(0.0, 0.33, smoothT));
    } else if (smoothT < 0.66) {
      color = mix(u_color2, u_color3, smoothstep(0.33, 0.66, smoothT));
    } else {
      color = mix(u_color3, u_color1, smoothstep(0.66, 1.0, smoothT));
    }

    float dist = length(pos);
    color += sin(dist * 8.0 + time * 1.5) * 0.03;

    return color;
  }

  #define S(a,b,t) smoothstep(a,b,t)

  mat2 Rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
  }

  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
    return fract(sin(p) * 43758.5453);
  }

  float advancedNoise(in vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    vec2 u = f * f * (3.0 - 2.0 * f);
    float n = mix(mix(dot(-1.0 + 2.0 * hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
                      dot(-1.0 + 2.0 * hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
                  mix(dot(-1.0 + 2.0 * hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                      dot(-1.0 + 2.0 * hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
    return 0.5 + 0.5 * n;
  }

  vec3 animatedGradient(vec2 uv, float time) {
    float ratio = u_resolution.x / u_resolution.y;
    vec2 tuv = uv;
    tuv -= 0.5;

    float degree = advancedNoise(vec2(time * 0.1 * u_speed, tuv.x * tuv.y));
    tuv.y *= 1.0 / ratio;
    tuv *= Rot(radians((degree - 0.5) * 720.0 * u_scale + 180.0));
    tuv.y *= ratio;

    float frequency = 5.0 * u_scale;
    float amplitude = 30.0;
    float speed = time * 2.0 * u_speed;
    tuv.x += sin(tuv.y * frequency + speed) / amplitude;
    tuv.y += sin(tuv.x * frequency * 1.5 + speed) / (amplitude * 0.5);

    vec3 layer1 = mix(u_color1, u_color2, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));
    vec3 layer2 = mix(u_color2, u_color3, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));

    vec3 finalComp = mix(layer1, layer2, S(0.05, -0.2, tuv.y));

    return finalComp;
  }

  vec3 waveGradient(vec2 uv, float time) {
    float y = uv.y;

    float wave1 = sin(uv.x * PI * u_scale * 0.8 + time * u_speed * 0.5) * 0.1;
    float wave2 = sin(uv.x * PI * u_scale * 0.5 + time * u_speed * 0.3) * 0.15;
    float wave3 = sin(uv.x * PI * u_scale * 1.2 + time * u_speed * 0.8) * 0.2;

    float flowingY = y + wave1 + wave2 + wave3;
    float pattern = smoothstep(0.0, 1.0, clamp(flowingY, 0.0, 1.0));

    vec3 color;
    if (pattern < 0.33) {
      float t = smoothstep(0.0, 0.33, pattern);
      color = mix(u_color1, u_color2, t);
    } else if (pattern < 0.66) {
      float t = smoothstep(0.33, 0.66, pattern);
      color = mix(u_color2, u_color3, t);
    } else {
      float t = smoothstep(0.66, 1.0, pattern);
      color = mix(u_color3, u_color1, t);
    }

    float variation = sin(uv.x * PI * 2.0 + time * u_speed) *
                      cos(uv.y * PI * 1.5 + time * u_speed * 0.7) * 0.02;
    color += variation;

    return clamp(color, 0.0, 1.0);
  }

  vec3 silkGradient(vec2 uv, float time) {
    vec2 fragCoord = uv * u_resolution;
    vec2 invResolution = 1.0 / u_resolution.xy;
    vec2 centeredUv = (fragCoord * 2.0 - u_resolution.xy) * invResolution;

    centeredUv *= u_scale;

    float dampening = 1.0 / (1.0 + u_scale * 0.1);

    float d = -time * u_speed * 0.5;
    float a = 0.0;

    for (float i = 0.0; i < 8.0; ++i) {
        a += cos(i - d - a * centeredUv.x) * dampening;
        d += sin(centeredUv.y * i + a) * dampening;
    }

    d += time * u_speed * 0.5;

    vec3 patterns = vec3(
      cos(centeredUv.x * d + a) * 0.5 + 0.5,
      cos(centeredUv.y * a + d) * 0.5 + 0.5,
      cos((centeredUv.x + centeredUv.y) * (d + a) * 0.5) * 0.5 + 0.5
    );

    vec3 color1Mix = mix(u_color1, u_color2, patterns.x);
    vec3 color2Mix = mix(u_color2, u_color3, patterns.y);
    vec3 color3Mix = mix(u_color3, u_color1, patterns.z);

    vec3 finalColor = mix(color1Mix, color2Mix, patterns.z);
    finalColor = mix(finalColor, color3Mix, patterns.x * 0.5);

    vec3 originalPattern = vec3(cos(centeredUv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
    originalPattern = cos(originalPattern * cos(vec3(d, a, 2.5)) * 0.5 + 0.5);

    return mix(finalColor, originalPattern * finalColor, 0.3);
  }

  vec3 smokeGradient(vec2 uv, float time) {
    float mr = min(u_resolution.x, u_resolution.y);
    vec2 fragCoord = uv * u_resolution;
    vec2 p = (2.0 * fragCoord.xy - u_resolution.xy) / mr;

    p *= u_scale;

    float iTime = time * u_speed;

    for(int i = 1; i < 10; i++) {
      vec2 newp = p;
      float fi = float(i);
      newp.x += 0.6 / fi * sin(fi * p.y + iTime + 0.3 * fi) + 1.0;
      newp.y += 0.6 / fi * sin(fi * p.x + iTime + 0.3 * (fi + 10.0)) - 1.4;
      p = newp;
    }

    float redPattern = 1.0;
    float greenPattern = 1.0 - sin(p.y);
    float bluePattern = sin(p.x + p.y);

    greenPattern = clamp(greenPattern, 0.0, 1.0);
    bluePattern = bluePattern * 0.5 + 0.5;

    vec3 color;

    vec3 color12 = mix(u_color1, u_color2, greenPattern);

    color = mix(color12, u_color3, bluePattern);

    return clamp(color, 0.0, 1.0);
  }

  vec3 stripeGradient(vec2 uv, float time) {
    vec2 p = ((uv * u_resolution * 2.0 - u_resolution.xy) / (u_resolution.x + u_resolution.y) * 2.0) * u_scale;
    float t = time * 0.7, a = 4.0 * p.y - sin(-p.x * 3.0 + p.y - t);
    a = smoothstep(cos(a) * 0.7, sin(a) * 0.7 + 1.0, cos(a - 4.0 * p.y) - sin(a + 3.0 * p.x));

    vec2 warped = (cos(a) * p + sin(a) * vec2(-p.y, p.x)) * 0.5 + 0.5;
    vec3 color = mix(u_color1, u_color2, warped.x);

    color = mix(color, u_color3, warped.y);
    color *= color + 0.6 * sqrt(color);

    return clamp(color, 0.0, 1.0);
  }

  // @Main
  void main() {
    vec2 uv = vUv;
    float time = u_time * u_speed;

    vec3 color;

    if (u_type == 0) {
      color = linearGradient(uv, time);
    } else if (u_type == 1) {
      color = conicGradient(uv, time);
    } else if (u_type == 2) {
      color = animatedGradient(uv, time);
    } else if (u_type == 3) {
      color = waveGradient(uv, time);
    } else if (u_type == 4) {
      color = silkGradient(uv, time);
    } else if (u_type == 5) {
      color = smokeGradient(uv, time);
    } else if (u_type == 6) {
      color = stripeGradient(uv, time);
    } else {
      color = animatedGradient(uv, time);
    }

    if (u_noise > 0.001) {
      float grain = noise(uv * 200.0 + time * 0.1);
      color *= (1.0 - u_noise * 0.4 + u_noise * grain * 0.4);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`

export type GradflowHandle = { destroy: () => void }

// mountGradflow drives `canvas` until destroyed, filling the canvas's
// layout box and tracking window resizes. The caller owns the canvas — an
// output window shows it full-screen; a Stage keeps it offscreen so
// mirrors can blit from it (preserveDrawingBuffer: true). getConfig is
// read every frame so live edits apply without a remount.
export function mountGradflow(
  canvas: HTMLCanvasElement,
  getConfig: () => GradflowConfig,
  opts: {
    preserveDrawingBuffer?: boolean
    // Called once, right after the first frame is drawn at a real size —
    // until then the canvas is blank, so crossfades wait for this before
    // revealing the new background.
    onFirstFrame?: () => void
  } = {},
): GradflowHandle {
  const renderer = new Renderer({
    canvas,
    dpr: Math.min(window.devicePixelRatio, 2),
    alpha: false,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
  })
  const gl = renderer.gl
  const geometry = new Plane(gl, { width: 2, height: 2 })
  const c0 = getConfig()
  const program = new Program(gl, {
    vertex: VERTEX,
    fragment: FRAGMENT,
    uniforms: {
      u_time: { value: 0 },
      u_color1: { value: rgb01(c0.color1) },
      u_color2: { value: rgb01(c0.color2) },
      u_color3: { value: rgb01(c0.color3) },
      u_speed: { value: c0.speed },
      u_scale: { value: c0.scale },
      u_type: { value: TYPE_NUMBER[c0.type] ?? 2 },
      u_noise: { value: c0.noise },
      u_resolution: { value: [1, 1] },
    },
  })
  const mesh = new Mesh(gl, { geometry, program })
  const scene = new Transform()
  mesh.setParent(scene)

  // Size from the parent box, which is layout-driven and never mutated by
  // us (we only set the canvas's own style via setSize), so observing it is
  // loop-free. A ResizeObserver — not a one-shot measure + window-resize
  // listener — is what makes this correct in a freshly-created webview: the
  // splash mounts before its stylesheet applies, so the first measure is 0,
  // and that window never fires a resize event. The observer delivers the
  // real size the moment layout settles.
  const measure = () => {
    const box = canvas.parentElement ?? canvas
    const rect = box.getBoundingClientRect()
    const w = rect.width || box.clientWidth || canvas.clientWidth || 1
    const h = rect.height || box.clientHeight || canvas.clientHeight || 1
    renderer.setSize(w, h)
    program.uniforms.u_resolution.value = [w, h]
  }
  measure()
  let observer: ResizeObserver | null = null
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => measure())
    observer.observe(canvas.parentElement ?? canvas)
  } else {
    window.addEventListener("resize", measure, { passive: true })
  }

  let raf = 0
  let firstFrameSent = false
  const frame = () => {
    const c = getConfig()
    program.uniforms.u_time.value = sharedTime()
    program.uniforms.u_color1.value = rgb01(c.color1)
    program.uniforms.u_color2.value = rgb01(c.color2)
    program.uniforms.u_color3.value = rgb01(c.color3)
    program.uniforms.u_speed.value = c.speed
    program.uniforms.u_scale.value = c.scale
    program.uniforms.u_type.value = TYPE_NUMBER[c.type] ?? 2
    program.uniforms.u_noise.value = c.noise
    renderer.render({ scene })
    if (!firstFrameSent && canvas.width > 1 && canvas.height > 1) {
      firstFrameSent = true
      opts.onFirstFrame?.()
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    destroy() {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener("resize", measure)
      // NB: do NOT loseContext() here. React StrictMode runs effects
      // mount → cleanup → mount in dev; a lost context cannot be re-
      // acquired from the same canvas, so the second mount would throw
      // on shader compile. The original GradFlow let the context be
      // GC'd with the canvas — match that.
    },
  }
}

// GradflowGL is the direct, single-instance React wrapper used by
// BackgroundView (output window, library tab, editor, picker, splash).
export function GradflowGL({
  config,
  className,
  onReady,
}: {
  config: GradflowConfig
  className?: string
  // Fired once the first frame is on the canvas (see onFirstFrame).
  onReady?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cfgRef = useRef(config)
  cfgRef.current = config
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // A failed background must never take its window down — degrade to
    // the black fallback instead.
    try {
      const handle = mountGradflow(canvas, () => cfgRef.current, {
        onFirstFrame: () => onReadyRef.current?.(),
      })
      return () => handle.destroy()
    } catch (err) {
      console.error("GradflowGL: renderer mount failed", err)
      // Nothing will ever draw — let a crossfade move on to black.
      onReadyRef.current?.()
    }
  }, [])
  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  )
}
