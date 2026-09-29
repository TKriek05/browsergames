// 3D renderer for our low-poly games, built on three.js (vendored in
// public/vendor/three, MIT). The games keep a small immediate-mode API:
// upload MeshBuilder data once (mesh), then per frame begin() → draw() per
// object → points() for particles. Behind it the renderer reuses pooled
// three.js objects and renders the frame right after the game's render()
// (a microtask), with real-time shadows from the sun, flat-shaded Lambert
// light, fog, emissive (glowing) parts, a gradient sky with an optional sun
// (plain or retro striped) and clouds, and soft round particles.
import * as THREE from '../../vendor/three/three.module.js';
import { create, perspective, lookAt, multiply, transform4, invert } from './mat4.js';
import { FLOATS_PER_VERTEX, rgb } from './mesh.js';

// Our colours are plain sRGB numbers used as-is (like the old renderer).
THREE.ColorManagement.enabled = false;

// three.js Lambert divides by π: these intensities keep "colour × light" as before.
const LIGHT_SCALE = Math.PI;
const SHADOW_INTENSITY = 0.72; // 1 = only ambient light in the shadow
const SHADOW_FIT = 0.85; // shadow area (half size) = camera distance × this …
const SHADOW_MIN = 110; // … but at least / at most this many world units
const SHADOW_MAX = 520;
const SHADOW_AHEAD = 0.3; // centre the shadow area this far ahead of the camera target (× span)
const WHITE = [1, 1, 1];

const FOG_GLSL = `
#ifdef USE_FOG
  float fogFactor = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0) * (1.0 - 0.6 * vEmit);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uFlash);`;

const SKY_VS = `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const SKY_FS = `
varying vec2 vPos;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uHorizon;
uniform vec4 uSun; // ndc x, ndc y, radius (in ndc y units), enabled
uniform float uSunRetro;
uniform float uAspect;
uniform vec3 uSunTop;
uniform vec3 uSunBottom;
uniform vec4 uClouds[16]; // heading (rad), elevation (tan), width (rad), unused
uniform float uCloudCount;
uniform vec3 uCloudColor;
uniform vec3 uCloudShade;
uniform float uYaw;
uniform float uTanHalf;
void main() {
  float t = clamp((vPos.y - uHorizon) / max(0.001, 1.0 - uHorizon), 0.0, 1.0);
  vec3 c = mix(uBottom, uTop, sqrt(t));
  if (uSun.w > 0.5) {
    vec2 d = vec2((vPos.x - uSun.x) * uAspect, vPos.y - uSun.y);
    float r = length(d) / uSun.z;
    float k = (vPos.y - (uSun.y - uSun.z)) / (2.0 * uSun.z);
    bool gap = uSunRetro > 0.5 && k < 0.5 && fract(k * 9.0) < (0.5 - k) * 0.9;
    if (r < 1.0 && vPos.y > uHorizon && !gap) c = uSunRetro > 0.5 ? mix(uSunBottom, uSunTop, clamp(k, 0.0, 1.0)) : uSunTop;
    else c += uSunBottom * 0.25 * max(0.0, 1.0 - (r - 1.0) * 1.5);
  }
  if (uCloudCount > 0.5 && vPos.y > uHorizon) {
    float ang = uYaw + atan(vPos.x * uTanHalf * uAspect);
    float elev = (vPos.y - uHorizon) * uTanHalf;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCloudCount) break;
      vec4 cl = uClouds[i];
      float da = mod(ang - cl.x + 3.14159265, 6.2831853) - 3.14159265;
      vec2 p = vec2(da / cl.z, (elev - cl.y) / (cl.z * 0.5));
      float puff = min(min(length(p - vec2(-0.45, 0.0)) / 0.5, length(p - vec2(0.05, 0.2)) / 0.62), length(p - vec2(0.55, 0.02)) / 0.45);
      if (p.y > -0.28 && puff < 1.0) c = mix(uCloudShade, uCloudColor, clamp(p.y * 1.6 + 0.55, 0.0, 1.0));
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const POINTS_VS = `
attribute vec4 pcolor;
attribute float psize;
uniform float uScale;
varying vec4 vColor;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, psize * uScale / max(0.1, gl_Position.w));
  vColor = pcolor;
}`;

const POINTS_FS = `
varying vec4 vColor;
void main() {
  // Round, soft-edged dots instead of squares.
  float r = length(gl_PointCoord - vec2(0.5));
  if (r > 0.5) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.32, 0.5, r)));
}`;

// Lambert with our vertex layout: tintable faces, emissive faces and the
// per-draw flash. One shader program for all of them.
function meshMaterial(transparent) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent, depthWrite: !transparent });
  const u = { uTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float emit;\nattribute float tintAmt;\nuniform vec3 uTint;\nvarying float vEmit;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, uTint * (0.35 + 0.65 * vColor.rgb), tintAmt);\nvEmit = emit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlash;\nvarying float vEmit;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.15, vEmit);\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', FOG_GLSL);
  };
  mat.customProgramCacheKey = () => 'arcade-mesh';
  return mat;
}

function geometryOf(data) {
  const g = new THREE.BufferGeometry();
  const ib = new THREE.InterleavedBuffer(data, FLOATS_PER_VERTEX);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  g.setAttribute('color', new THREE.InterleavedBufferAttribute(ib, 3, 6));
  g.setAttribute('emit', new THREE.InterleavedBufferAttribute(ib, 1, 9));
  g.setAttribute('tintAmt', new THREE.InterleavedBufferAttribute(ib, 1, 10));
  if (data.length) g.computeBoundingSphere();
  return g;
}

function hasWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // only a probe: free it right away
    return !!gl;
  } catch {
    return false;
  }
}

export function createRenderer3D(canvas) {
  if (!hasWebGL2()) return null; // three.js needs WebGL 2: the games fall back to 2D
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !!canvas.smooth, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1); // canvas.js already sizes the canvas in device pixels
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const smallScreen = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768) < 700;
  const shadowSize = smallScreen ? 1024 : 2048;

  // --- Scene: the world, and an overlay (e.g. a first-person gun) drawn after a depth clear.
  const scene = new THREE.Scene();
  const overlay = new THREE.Scene();
  const fog = new THREE.Fog(0x000000, 200, 800);
  scene.fog = fog;
  overlay.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1000);
  const sun = new THREE.DirectionalLight(0xffffff, LIGHT_SCALE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.intensity = SHADOW_INTENSITY;
  sun.shadow.radius = 2;
  sun.shadow.bias = -0.0005;
  const ambient = new THREE.AmbientLight(0xffffff, LIGHT_SCALE);
  scene.add(sun, sun.target, ambient);
  const overSun = new THREE.DirectionalLight(0xffffff, LIGHT_SCALE);
  const overAmbient = new THREE.AmbientLight(0xffffff, LIGHT_SCALE);
  overlay.add(overSun, overSun.target, overAmbient);

  const skyUniforms = {
    uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uHorizon: { value: 0 },
    uSun: { value: new THREE.Vector4(0, 0, 1, 0) }, uSunRetro: { value: 0 }, uAspect: { value: 1 },
    uSunTop: { value: new THREE.Color() }, uSunBottom: { value: new THREE.Color() },
    uClouds: { value: new Float32Array(64) }, uCloudCount: { value: 0 },
    uCloudColor: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color() },
    uYaw: { value: 0 }, uTanHalf: { value: 1 },
  };
  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: skyUniforms, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1e6;
  scene.add(sky);

  // --- Our own camera maths (project, groundPoint, sky), same as the game code expects.
  const view = create();
  const proj = create();
  const viewProj = create();
  const invViewProj = create();
  const tmp4 = new Float32Array(4);
  const tmpB = new Float32Array(4);
  const tmpSize = new THREE.Vector2();
  const cam = { x: 0, y: 10, z: 10, tx: 0, ty: 0, tz: 0, fov: 1, near: 1, far: 1000 };
  const state = {
    light: [-0.4, -1, -0.3], lightColor: [0.85, 0.85, 0.85], ambient: [0.42, 0.42, 0.5],
    fogColor: [0.1, 0.05, 0.2], sun: null, shadow: null,
  };

  // --- Pools, reused every frame (no allocations while playing).
  const meshes = new Set();
  const pools = { world: { list: [], used: 0, scene }, over: { list: [], used: 0, scene: overlay } };
  const pointPools = { world: { list: [], used: 0, scene }, over: { list: [], used: 0, scene: overlay } };
  const emptyGeo = new THREE.BufferGeometry();
  let pass = pools.world;
  let pointPass = pointPools.world;
  let order = 0;
  let frameOpen = false;
  let lost = false;

  canvas.addEventListener('webglcontextlost', () => { lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });

  function takeMesh(pool) {
    let o = pool.list[pool.used];
    if (!o) {
      o = new THREE.Mesh(emptyGeo);
      o.matrixAutoUpdate = false;
      o.userData.opaque = meshMaterial(false);
      o.userData.clear = meshMaterial(true);
      o.material = o.userData.opaque;
      pool.list.push(o);
      pool.scene.add(o);
    }
    pool.used++;
    return o;
  }

  function takePoints(pool) {
    let p = pool.list[pool.used];
    if (!p) {
      const make = (blending) => new THREE.ShaderMaterial({
        vertexShader: POINTS_VS, fragmentShader: POINTS_FS, uniforms: { uScale: { value: 1 } },
        transparent: true, depthWrite: false, blending,
      });
      p = new THREE.Points(new THREE.BufferGeometry());
      p.userData.cap = 0;
      p.userData.normal = make(THREE.NormalBlending);
      p.userData.additive = make(THREE.AdditiveBlending);
      p.frustumCulled = false;
      p.matrixAutoUpdate = false;
      pool.list.push(p);
      pool.scene.add(p);
    }
    pool.used++;
    return p;
  }

  function hideUnused(pool) {
    for (let i = pool.used; i < pool.list.length; i++) pool.list[i].visible = false;
    pool.used = 0;
  }

  // The sun's shadow follows the camera: an area around (and a bit ahead of)
  // what the camera looks at, snapped to shadow-map texels against shimmering.
  const lightDir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centre = new THREE.Vector3();
  function placeSun() {
    const L = state.light;
    lightDir.set(L[0], L[1], L[2]).normalize();
    const fx = cam.tx - cam.x;
    const fz = cam.tz - cam.z;
    const flat = Math.hypot(fx, fz) || 1;
    const dist = Math.hypot(fx, cam.ty - cam.y, fz);
    const span = state.shadow?.span ?? Math.min(SHADOW_MAX, Math.max(SHADOW_MIN, dist * SHADOW_FIT));
    const ahead = span * (state.shadow?.ahead ?? SHADOW_AHEAD);
    centre.set(cam.tx + (fx / flat) * ahead, cam.ty, cam.tz + (fz / flat) * ahead);
    right.set(0, 1, 0).cross(lightDir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.copy(lightDir).cross(right).normalize();
    const texel = (2 * span) / shadowSize;
    const cr = Math.round(centre.dot(right) / texel) * texel;
    const cu = Math.round(centre.dot(up) / texel) * texel;
    const cd = centre.dot(lightDir);
    centre.copy(right).multiplyScalar(cr).addScaledVector(up, cu).addScaledVector(lightDir, cd);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(lightDir, -span * 2);
    const sc = sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = span * 4;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = texel * 1.5;
    overSun.position.copy(sun.position);
    overSun.target.position.copy(sun.target.position);
  }

  function updateSky(aspect) {
    const fx = cam.tx - cam.x;
    const fz = cam.tz - cam.z;
    const fl = Math.hypot(fx, fz) || 1;
    // Where the horizon ends up on screen: project a far point straight ahead at eye height.
    transform4(tmp4, viewProj, cam.x + (fx / fl) * cam.far * 0.9, cam.y, cam.z + (fz / fl) * cam.far * 0.9);
    skyUniforms.uHorizon.value = tmp4[3] > 0 ? Math.max(-1, Math.min(1, tmp4[1] / tmp4[3])) : -1;
    skyUniforms.uAspect.value = aspect;
    skyUniforms.uYaw.value = Math.atan2(fz, fx);
    skyUniforms.uTanHalf.value = Math.tan(cam.fov / 2);
    const s = skyUniforms.uSun.value;
    s.set(0, 0, 1, 0);
    if (state.sun) {
      const [sx, sy, sz, rad] = state.sun; // world direction + angular radius
      transform4(tmp4, viewProj, cam.x + sx * cam.far * 0.9, cam.y + sy * cam.far * 0.9, cam.z + sz * cam.far * 0.9);
      if (tmp4[3] > 0) s.set(tmp4[0] / tmp4[3], tmp4[1] / tmp4[3], rad / Math.tan(cam.fov / 2), 1);
    }
  }

  // Renders the frame that begin() opened, once the game's render() is done.
  function flush() {
    if (!frameOpen) return;
    frameOpen = false;
    const overlayUsed = pools.over.used > 0 || pointPools.over.used > 0;
    for (const pool of [pools.world, pools.over, pointPools.world, pointPools.over]) hideUnused(pool);
    pass = pools.world;
    pointPass = pointPools.world;
    if (lost) return;
    renderer.clear();
    renderer.render(scene, camera);
    if (overlayUsed) {
      renderer.clearDepth();
      renderer.render(overlay, camera);
    }
  }

  const r = {
    shadows: true, // real shadows from the sun: games skip their painted blob shadows
    get lost() { return lost; },

    // Upload a Float32Array from MeshBuilder.build().
    mesh(data) {
      const m = { data, geo: geometryOf(data), count: data.length / FLOATS_PER_VERTEX };
      meshes.add(m);
      return m;
    },

    // Replace a mesh's vertices (e.g. destroyed crates).
    update(m, data) {
      const attr = m.geo.getAttribute('position');
      if (attr && attr.data.array.length === data.length) {
        attr.data.array.set(data);
        attr.data.needsUpdate = true;
        if (data.length) m.geo.computeBoundingSphere();
      } else {
        m.geo.dispose();
        m.geo = geometryOf(data);
      }
      m.data = data;
      m.count = data.length / FLOATS_PER_VERTEX;
    },

    free(m) {
      meshes.delete(m);
      m.geo.dispose();
    },

    camera(x, y, z, tx, ty, tz, fov = 1.0, near = 1, far = 1000) {
      Object.assign(cam, { x, y, z, tx, ty, tz, fov, near, far });
    },

    begin() {
      if (lost) return false;
      const w = canvas.width;
      const h = canvas.height;
      const size = renderer.getSize(tmpSize);
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      perspective(proj, cam.fov, w / h, cam.near, cam.far);
      lookAt(view, cam.x, cam.y, cam.z, cam.tx, cam.ty, cam.tz);
      multiply(viewProj, proj, view);
      camera.fov = (cam.fov * 180) / Math.PI;
      camera.aspect = w / h;
      camera.near = cam.near;
      camera.far = cam.far;
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      camera.updateProjectionMatrix();
      renderer.setClearColor(fog.color, 1);
      updateSky(w / h);
      placeSun();
      if (!frameOpen) queueMicrotask(flush);
      frameOpen = true;
      order = 0;
      pass = pools.world;
      pointPass = pointPools.world;
      return true;
    },

    // Everything drawn after this appears over the world (e.g. the gun in a first-person view).
    clearDepth() {
      pass = pools.over;
      pointPass = pointPools.over;
    },

    // Draw a mesh with a model matrix. tint: [r, g, b] for tintable faces.
    draw(m, model, tint = WHITE, alpha = 1, flash = 0) {
      if (!frameOpen || !m.count) return;
      const o = takeMesh(pass);
      const overlayPass = pass === pools.over;
      o.geometry = m.geo;
      o.matrix.fromArray(model);
      o.matrixWorldNeedsUpdate = true;
      const mat = alpha < 1 ? o.userData.clear : o.userData.opaque;
      o.material = mat;
      mat.opacity = alpha;
      mat.userData.u.uTint.value.setRGB(tint[0], tint[1], tint[2]);
      mat.userData.u.uFlash.value = flash;
      o.castShadow = alpha >= 1 && !overlayPass;
      o.receiveShadow = !overlayPass;
      o.renderOrder = ++order;
      o.visible = true;
    },

    // Round points. data: Float32Array of [x, y, z, r, g, b, a, size] × count.
    // additive: glowing (sparks, fire); otherwise normal alpha blending (dust, smoke).
    points(data, count, scale = 1, additive = false) {
      if (!frameOpen || !count) return;
      const p = takePoints(pointPass);
      if (p.userData.cap < count) {
        const cap = Math.max(64, count * 2);
        p.geometry.dispose();
        const g = new THREE.BufferGeometry();
        const ib = new THREE.InterleavedBuffer(new Float32Array(cap * 8), 8);
        ib.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
        g.setAttribute('pcolor', new THREE.InterleavedBufferAttribute(ib, 4, 3));
        g.setAttribute('psize', new THREE.InterleavedBufferAttribute(ib, 1, 7));
        p.geometry = g;
        p.userData.cap = cap;
        p.userData.ib = ib;
      }
      const ib = p.userData.ib;
      ib.array.set(data.subarray(0, count * 8));
      ib.clearUpdateRanges();
      ib.addUpdateRange(0, count * 8);
      ib.needsUpdate = true;
      p.geometry.setDrawRange(0, count);
      const mat = additive ? p.userData.additive : p.userData.normal;
      mat.uniforms.uScale.value = (canvas.height / 2 / Math.tan(cam.fov / 2)) * scale;
      p.material = mat;
      p.renderOrder = ++order;
      p.visible = true;
    },

    // World position → logical canvas coordinates (null when behind the camera).
    // Logical = the game's HUD units, also when the canvas renders at screen resolution.
    project(x, y, z, out) {
      transform4(tmp4, viewProj, x, y, z);
      if (tmp4[3] <= 0.01) return null;
      const lw = canvas.logicalWidth || canvas.width;
      const lh = lw * (canvas.height / canvas.width);
      out.x = (tmp4[0] / tmp4[3] * 0.5 + 0.5) * lw;
      out.y = (1 - (tmp4[1] / tmp4[3] * 0.5 + 0.5)) * lh;
      out.depth = tmp4[3];
      return out;
    },

    // Logical canvas point → point on the horizontal plane y = planeY (for mouse aiming).
    groundPoint(px, py, planeY, out) {
      if (!invert(invViewProj, viewProj)) return null;
      const lw = canvas.logicalWidth || canvas.width;
      const lh = lw * (canvas.height / canvas.width);
      const nx = (px / lw) * 2 - 1;
      const ny = 1 - (py / lh) * 2;
      transform4(tmp4, invViewProj, nx, ny, -1);
      transform4(tmpB, invViewProj, nx, ny, 1);
      const ax = tmp4[0] / tmp4[3], ay = tmp4[1] / tmp4[3], az = tmp4[2] / tmp4[3];
      const bx = tmpB[0] / tmpB[3], by = tmpB[1] / tmpB[3], bz = tmpB[2] / tmpB[3];
      if (Math.abs(by - ay) < 1e-6) return null;
      const t = (planeY - ay) / (by - ay);
      if (t < 0) return null;
      out.x = ax + (bx - ax) * t;
      out.z = az + (bz - az) * t;
      return out;
    },

    // sun: { dir, radius, top, bottom, retro? } (retro = striped synthwave sun).
    // clouds: { count ≤ 16, color, shade, seed? } or null.
    // shadow: { span?, ahead? } to size the shadow area by hand (optional).
    setColors({ sky: skyColors, fog: fogSpec, light, sun: sunSpec, clouds, shadow } = {}) {
      if (skyColors) {
        skyUniforms.uTop.value.setRGB(...rgb(skyColors[0]));
        skyUniforms.uBottom.value.setRGB(...rgb(skyColors[1]));
      }
      if (fogSpec) {
        state.fogColor = rgb(fogSpec[0]);
        fog.color.setRGB(...state.fogColor);
        fog.near = fogSpec[1];
        fog.far = fogSpec[2];
      }
      if (light) {
        state.light = light.dir;
        state.lightColor = rgb(light.color);
        state.ambient = rgb(light.ambient);
        for (const l of [sun, overSun]) l.color.setRGB(...state.lightColor);
        for (const a of [ambient, overAmbient]) a.color.setRGB(...state.ambient);
      }
      if (shadow !== undefined) state.shadow = shadow;
      if (sunSpec !== undefined) {
        state.sun = sunSpec ? sunSpec.dir.concat([sunSpec.radius]) : null;
        if (sunSpec) {
          skyUniforms.uSunTop.value.setRGB(...rgb(sunSpec.top));
          skyUniforms.uSunBottom.value.setRGB(...rgb(sunSpec.bottom));
          skyUniforms.uSunRetro.value = sunSpec.retro ? 1 : 0;
        }
      }
      if (clouds !== undefined) {
        skyUniforms.uCloudCount.value = clouds ? Math.min(16, clouds.count) : 0;
        if (clouds) {
          skyUniforms.uCloudColor.value.setRGB(...rgb(clouds.color ?? '#ffffff'));
          skyUniforms.uCloudShade.value.setRGB(...rgb(clouds.shade ?? '#d8def0'));
          // Deterministic spread around the horizon (no Math.random: same sky every time).
          let seed = clouds.seed ?? 7;
          const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const cl = skyUniforms.uClouds.value;
          for (let i = 0; i < 16; i++) {
            cl[i * 4] = (i / 16) * Math.PI * 2 + next() * 0.3;
            cl[i * 4 + 1] = 0.05 + next() * (clouds.height ?? 0.28);
            cl[i * 4 + 2] = 0.1 + next() * 0.12;
            cl[i * 4 + 3] = 0;
          }
        }
      }
    },

    destroy() {
      frameOpen = false;
      for (const m of meshes) m.geo.dispose();
      meshes.clear();
      for (const pool of [pools.world, pools.over]) {
        for (const o of pool.list) {
          o.userData.opaque.dispose();
          o.userData.clear.dispose();
        }
      }
      for (const pool of [pointPools.world, pointPools.over]) {
        for (const p of pool.list) {
          p.geometry.dispose();
          p.userData.normal.dispose();
          p.userData.additive.dispose();
        }
      }
      skyGeo.dispose();
      sky.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return r;
}
