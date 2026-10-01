import type { PictureFrame } from "@sse/engine-client";

import {
  PEAKING_INK,
  PEAKING_STEP,
  STRIPE_DARK_ALPHA,
  STRIPE_LIGHT_ALPHA,
  STRIPE_PERIOD,
  ZEBRA_LEVEL,
} from "./pictureAids";
import { PICTURE, type Rect } from "./pictureGeometry";

// One view of a camera's picture, drawn with WebGL2 (the camera pictures, D28): the
// frame as it came (UYVY, BT.709 video range, or RGBA) goes to the graphics card as it
// is, and the shader turns it into the screen's colours, scales the part shown, and lays
// the aids over it, in the picture's own pixels as `pictureAids.ts` works them out:
// zebras at 95 % in slanted stripes, peaking where a neighbour differs by more than 12 %.
// `pictureAids.ts` stays the reference the page tests hold the shader to.

export interface DrawOptions {
  /** The part shown, in the picture's 1920 × 1080 pixels. */
  part: Rect;
  /** Between the picture's pixels, or each as it is (1:1 at whole zooms, the loupe). */
  smooth: boolean;
  zebras: boolean;
  peaking: boolean;
}

export interface PictureDrawer {
  draw(frame: PictureFrame, options: DrawOptions): void;
  dispose(): void;
}

const VERTEX = `#version 300 es
void main() {
  // One triangle over the whole view.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D picture;   // UYVY: width/2 x height, U Y0 V Y1; RGBA: width x height
uniform int uyvy;            // 1 for UYVY, 0 for RGBA
uniform vec2 frameSize;      // the frame's own pixels
uniform vec4 part;           // the part shown, in the picture's 1920 x 1080 pixels
uniform vec2 viewSize;       // the view's pixels
uniform int smoothing;
uniform int zebras;
uniform int peaking;
uniform float zebraLevel;
uniform float peakingStep;

out vec4 colour;

const vec2 PICTURE = vec2(${PICTURE.width}.0, ${PICTURE.height}.0);

// A pixel of the frame in full-range RGB, rounded to 8 bits as a canvas holds it.
vec3 rgbAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(frameSize) - 1);
  vec3 rgb;
  if (uyvy == 1) {
    vec4 t = texelFetch(picture, ivec2(p.x / 2, p.y), 0) * 255.0;
    float y = ((p.x & 1) == 0 ? t.g : t.a) - 16.0;
    float cb = t.r - 128.0;
    float cr = t.b - 128.0;
    float luma = y / 219.0;
    float pb = cb / 224.0;
    float pr = cr / 224.0;
    rgb = vec3(luma + 1.5748 * pr, luma - 0.1873 * pb - 0.4681 * pr, luma + 1.8556 * pb);
  } else {
    rgb = texelFetch(picture, p, 0).rgb;
  }
  return floor(clamp(rgb, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
}

float brightness(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 here = vec2(gl_FragCoord.x, viewSize.y - gl_FragCoord.y);
  vec2 inPicture = part.xy + here / viewSize * part.zw;
  vec2 inFrame = inPicture * frameSize / PICTURE;
  ivec2 pixel = ivec2(floor(inFrame));

  vec3 rgb;
  if (smoothing == 1) {
    vec2 at = inFrame - 0.5;
    ivec2 base = ivec2(floor(at));
    vec2 f = at - vec2(base);
    vec3 top = mix(rgbAt(base), rgbAt(base + ivec2(1, 0)), f.x);
    vec3 bottom = mix(rgbAt(base + ivec2(0, 1)), rgbAt(base + ivec2(1, 1)), f.x);
    rgb = mix(top, bottom, f.y);
  } else {
    rgb = rgbAt(pixel);
  }

  if (zebras == 1 && brightness(rgbAt(pixel)) >= zebraLevel) {
    bool light = ((pixel.x + pixel.y) % ${STRIPE_PERIOD}) < ${STRIPE_PERIOD / 2};
    rgb = light
      ? mix(rgb, vec3(1.0), ${STRIPE_LIGHT_ALPHA}.0 / 255.0)
      : mix(rgb, vec3(0.0), ${STRIPE_DARK_ALPHA}.0 / 255.0);
  }
  if (peaking == 1) {
    float level = brightness(rgbAt(pixel));
    ivec2 last = ivec2(frameSize) - 1;
    bool sharp =
      (pixel.x < last.x && abs(brightness(rgbAt(pixel + ivec2(1, 0))) - level) > peakingStep) ||
      (pixel.x > 0 && abs(brightness(rgbAt(pixel - ivec2(1, 0))) - level) > peakingStep) ||
      (pixel.y < last.y && abs(brightness(rgbAt(pixel + ivec2(0, 1))) - level) > peakingStep) ||
      (pixel.y > 0 && abs(brightness(rgbAt(pixel - ivec2(0, 1))) - level) > peakingStep);
    if (sharp) rgb = vec3(${PEAKING_INK[0]}.0, ${PEAKING_INK[1]}.0, ${PEAKING_INK[2]}.0) / 255.0;
  }
  colour = vec4(rgb, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface Resources {
  program: WebGLProgram;
  texture: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function prepare(gl: WebGL2RenderingContext): Resources | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  const texture = gl.createTexture();
  if (!vertex || !fragment || !program || !texture) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const names = [
    "picture",
    "uyvy",
    "frameSize",
    "part",
    "viewSize",
    "smoothing",
    "zebras",
    "peaking",
    "zebraLevel",
    "peakingStep",
  ];
  return {
    program,
    texture,
    uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])),
  };
}

/** A drawer for `canvas`; `null` where the screen has no WebGL2. */
export function createPictureDrawer(canvas: HTMLCanvasElement): PictureDrawer | null {
  // The drawn picture is kept, so the page tests can read it back.
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, alpha: false });
  if (!gl) return null;
  let resources = prepare(gl);
  if (!resources) return null;
  let uploaded: PictureFrame | null = null;
  let last: { frame: PictureFrame; options: DrawOptions } | null = null;

  const lost = (event: Event) => event.preventDefault();
  const restored = () => {
    resources = prepare(gl);
    uploaded = null;
    if (last) draw(last.frame, last.options);
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);

  function draw(frame: PictureFrame, options: DrawOptions) {
    last = { frame, options };
    if (!resources || gl!.isContextLost() || frame.format === "jpeg") return;
    const { program, texture, uniforms } = resources;
    const context = gl!;
    context.useProgram(program);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, texture);
    const uyvy = frame.format === "uyvy";
    if (uploaded !== frame) {
      context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA8,
        uyvy ? frame.width / 2 : frame.width,
        frame.height,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        frame.pixels
      );
      uploaded = frame;
    }
    context.viewport(0, 0, canvas.width, canvas.height);
    context.uniform1i(uniforms.picture!, 0);
    context.uniform1i(uniforms.uyvy!, uyvy ? 1 : 0);
    context.uniform2f(uniforms.frameSize!, frame.width, frame.height);
    const { part } = options;
    context.uniform4f(uniforms.part!, part.x, part.y, part.width, part.height);
    context.uniform2f(uniforms.viewSize!, canvas.width, canvas.height);
    context.uniform1i(uniforms.smoothing!, options.smooth ? 1 : 0);
    context.uniform1i(uniforms.zebras!, options.zebras ? 1 : 0);
    context.uniform1i(uniforms.peaking!, options.peaking ? 1 : 0);
    context.uniform1f(uniforms.zebraLevel!, ZEBRA_LEVEL);
    context.uniform1f(uniforms.peakingStep!, PEAKING_STEP);
    context.drawArrays(context.TRIANGLES, 0, 3);
  }

  return {
    draw,
    dispose() {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      // The context goes with its canvas. It is not lost here: React's StrictMode mounts a
      // view twice on the same canvas, and the second drawer takes the same context.
    },
  };
}
