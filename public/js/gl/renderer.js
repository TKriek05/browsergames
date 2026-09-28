// A tiny WebGL renderer for our low-poly 3D games (no libraries):
// flat-shaded vertex-colour meshes with one directional light, fog, emissive
// (glowing) parts, a gradient sky with an optional sun (plain or retro
// striped) and puffy clouds, and point particles. WebGL 1 + GLSL ES 1.00, so it runs on practically every device.
// Rendered at a low resolution and scaled up pixelated for a retro look.
import { create, perspective, lookAt, multiply, transform4, invert } from './mat4.js';
import { FLOATS_PER_VERTEX, rgb } from './mesh.js';

const MESH_VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aEmit;
attribute float aTint;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uTint;
varying vec3 vColor;
varying vec3 vNormal;
varying float vEmit;
varying float vDist;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  vDist = -(uView * world).z;
  vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
  vColor = mix(aColor, uTint * (0.35 + 0.65 * aColor), aTint);
  vEmit = aEmit;
}`;

const MESH_FS = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
varying float vEmit;
varying float vDist;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uAlpha;
uniform float uFlash;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, -uLightDir), 0.0);
  vec3 lit = vColor * (uAmbient + uLightColor * diff);
  lit = mix(lit, vColor * 1.15, vEmit);
  float fog = clamp((vDist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0) * (1.0 - 0.6 * vEmit);
  vec3 c = mix(lit, uFogColor, fog);
  gl_FragColor = vec4(mix(c, vec3(1.0), uFlash), uAlpha);
}`;

const SKY_VS = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.9999, 1.0);
}`;

const SKY_FS = `
precision mediump float;
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
attribute vec3 aPos;
attribute vec4 aColor;
attribute float aSize;
uniform mat4 uViewProj;
uniform float uScale;
varying vec4 vColor;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.1, gl_Position.w));
  vColor = aColor;
}`;

const POINTS_FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

export function createRenderer3D(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance' });
  if (!gl) return null;

  const meshes = new Set();
  const view = create();
  const proj = create();
  const viewProj = create();
  const invViewProj = create();
  const tmp4 = new Float32Array(4);
  const tmpB = new Float32Array(4);
  const white = [1, 1, 1];
  const cam = { x: 0, y: 10, z: 10, tx: 0, ty: 0, tz: 0, fov: 1, near: 1, far: 1000 };
  const scene = {
    light: [-0.4, -1, -0.3], lightColor: [0.85, 0.85, 0.85], ambient: [0.42, 0.42, 0.5],
    fogColor: [0.1, 0.05, 0.2], fog: [200, 800],
    skyTop: [0.1, 0.05, 0.25], skyBottom: [0.9, 0.4, 0.6], sun: null, sunTop: [1, 0.9, 0.3], sunBottom: [1, 0.2, 0.6],
    sunRetro: 0, clouds: new Float32Array(64), cloudCount: 0, cloudColor: [1, 1, 1], cloudShade: [0.85, 0.88, 0.95],
    flash: 0,
  };
  let progs = null;
  let skyBuf = null;
  let pointBuf = null;
  let pointCap = 0;
  let lost = false;

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    const a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      a[info.name] = gl.getAttribLocation(p, info.name);
    }
    return { p, u, a };
  }

  function init() {
    progs = { mesh: compile(MESH_VS, MESH_FS), sky: compile(SKY_VS, SKY_FS), points: compile(POINTS_VS, POINTS_FS) };
    skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    pointBuf = gl.createBuffer();
    pointCap = 0;
    for (const m of meshes) upload(m);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  function upload(m) {
    m.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.data, m.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // allow a restore
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    current = null;
    init();
  });
  init();

  let current = null;
  function use(prog) {
    if (current === prog) return;
    // Attribute arrays are global state: switch cleanly between layouts.
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    current = prog;
    gl.useProgram(prog.p);
  }

  function bindMeshAttribs(prog) {
    const stride = FLOATS_PER_VERTEX * 4;
    const a = prog.a;
    gl.enableVertexAttribArray(a.aPos);
    gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(a.aNormal);
    gl.vertexAttribPointer(a.aNormal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(a.aColor);
    gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(a.aEmit);
    gl.vertexAttribPointer(a.aEmit, 1, gl.FLOAT, false, stride, 36);
    gl.enableVertexAttribArray(a.aTint);
    gl.vertexAttribPointer(a.aTint, 1, gl.FLOAT, false, stride, 40);
  }

  const r = {
    gl,
    get lost() { return lost; },
    scene,
    cam,

    // Upload a Float32Array from MeshBuilder.build(). Kept in memory so it
    // survives a lost WebGL context.
    mesh(data) {
      const m = { data, vbo: null, count: data.length / FLOATS_PER_VERTEX, dynamic: false };
      meshes.add(m);
      if (!lost) upload(m);
      return m;
    },

    // Replace a mesh's vertices (e.g. destroyed crates).
    update(m, data) {
      m.data = data;
      m.count = data.length / FLOATS_PER_VERTEX;
      m.dynamic = true;
      if (lost) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    },

    free(m) {
      meshes.delete(m);
      if (m.vbo && !lost) gl.deleteBuffer(m.vbo);
    },

    camera(x, y, z, tx, ty, tz, fov = 1.0, near = 1, far = 1000) {
      Object.assign(cam, { x, y, z, tx, ty, tz, fov, near, far });
    },

    begin() {
      if (lost) return false;
      const w = canvas.width;
      const h = canvas.height;
      gl.viewport(0, 0, w, h);
      perspective(proj, cam.fov, w / h, cam.near, cam.far);
      lookAt(view, cam.x, cam.y, cam.z, cam.tx, cam.ty, cam.tz);
      multiply(viewProj, proj, view);
      gl.depthMask(true);
      gl.clearColor(scene.fogColor[0], scene.fogColor[1], scene.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      r._sky(w / h);

      const mp = progs.mesh;
      use(mp);
      gl.uniformMatrix4fv(mp.u.uViewProj, false, viewProj);
      gl.uniformMatrix4fv(mp.u.uView, false, view);
      const L = scene.light;
      const len = Math.hypot(L[0], L[1], L[2]) || 1;
      gl.uniform3f(mp.u.uLightDir, L[0] / len, L[1] / len, L[2] / len);
      gl.uniform3fv(mp.u.uLightColor, scene.lightColor);
      gl.uniform3fv(mp.u.uAmbient, scene.ambient);
      gl.uniform3fv(mp.u.uFogColor, scene.fogColor);
      gl.uniform2fv(mp.u.uFog, scene.fog);
      gl.uniform1f(mp.u.uFlash, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    },

    _sky(aspect) {
      const sp = progs.sky;
      use(sp);
      // Where the horizon ends up on screen: project a far point straight ahead at eye height.
      const fx = cam.tx - cam.x;
      const fz = cam.tz - cam.z;
      const fl = Math.hypot(fx, fz) || 1;
      transform4(tmp4, viewProj, cam.x + (fx / fl) * cam.far * 0.9, cam.y, cam.z + (fz / fl) * cam.far * 0.9);
      const horizon = tmp4[3] > 0 ? Math.max(-1, Math.min(1, tmp4[1] / tmp4[3])) : -1;
      gl.uniform3fv(sp.u.uTop, scene.skyTop);
      gl.uniform3fv(sp.u.uBottom, scene.skyBottom);
      gl.uniform1f(sp.u.uHorizon, horizon);
      gl.uniform1f(sp.u.uAspect, aspect);
      gl.uniform1f(sp.u.uSunRetro, scene.sunRetro);
      gl.uniform1f(sp.u.uCloudCount, scene.cloudCount);
      if (scene.cloudCount) {
        gl.uniform4fv(sp.u['uClouds[0]'], scene.clouds);
        gl.uniform3fv(sp.u.uCloudColor, scene.cloudColor);
        gl.uniform3fv(sp.u.uCloudShade, scene.cloudShade);
        gl.uniform1f(sp.u.uYaw, Math.atan2(fz, fx));
        gl.uniform1f(sp.u.uTanHalf, Math.tan(cam.fov / 2));
      }
      let sunOn = 0;
      if (scene.sun) {
        const [sx, sy, sz, rad] = scene.sun; // world direction + angular radius
        transform4(tmp4, viewProj, cam.x + sx * cam.far * 0.9, cam.y + sy * cam.far * 0.9, cam.z + sz * cam.far * 0.9);
        if (tmp4[3] > 0) {
          sunOn = 1;
          gl.uniform4f(sp.u.uSun, tmp4[0] / tmp4[3], tmp4[1] / tmp4[3], rad / Math.tan(cam.fov / 2), 1);
          gl.uniform3fv(sp.u.uSunTop, scene.sunTop);
          gl.uniform3fv(sp.u.uSunBottom, scene.sunBottom);
        }
      }
      if (!sunOn) gl.uniform4f(sp.u.uSun, 0, 0, 1, 0);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.enableVertexAttribArray(sp.a.aPos);
      gl.vertexAttribPointer(sp.a.aPos, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    },

    // Draw a mesh with a model matrix. tint: [r, g, b] for tintable faces.
    draw(m, model, tint = white, alpha = 1, flash = 0) {
      if (lost || !m.count) return;
      const mp = progs.mesh;
      use(mp);
      gl.uniformMatrix4fv(mp.u.uModel, false, model);
      gl.uniform3fv(mp.u.uTint, tint);
      gl.uniform1f(mp.u.uAlpha, alpha);
      gl.uniform1f(mp.u.uFlash, flash);
      if (alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      bindMeshAttribs(mp);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      if (alpha < 1) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
    },

    // Additive glowing points. data: Float32Array of [x, y, z, r, g, b, a, size] × count.
    points(data, count, scale = 1) {
      if (lost || !count) return;
      const pp = progs.points;
      use(pp);
      gl.uniformMatrix4fv(pp.u.uViewProj, false, viewProj);
      gl.uniform1f(pp.u.uScale, (canvas.height / 2 / Math.tan(cam.fov / 2)) * scale);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      if (data.length > pointCap) {
        pointCap = data.length;
        gl.bufferData(gl.ARRAY_BUFFER, pointCap * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 8));
      const stride = 32;
      gl.enableVertexAttribArray(pp.a.aPos);
      gl.vertexAttribPointer(pp.a.aPos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(pp.a.aColor);
      gl.vertexAttribPointer(pp.a.aColor, 4, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(pp.a.aSize);
      gl.vertexAttribPointer(pp.a.aSize, 1, gl.FLOAT, false, stride, 28);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },

    // World position → canvas pixel coordinates (null when behind the camera).
    project(x, y, z, out) {
      transform4(tmp4, viewProj, x, y, z);
      if (tmp4[3] <= 0.01) return null;
      out.x = (tmp4[0] / tmp4[3] * 0.5 + 0.5) * canvas.width;
      out.y = (1 - (tmp4[1] / tmp4[3] * 0.5 + 0.5)) * canvas.height;
      out.depth = tmp4[3];
      return out;
    },

    // Canvas pixel → point on the horizontal plane y = planeY (for mouse aiming).
    groundPoint(px, py, planeY, out) {
      if (!invert(invViewProj, viewProj)) return null;
      const nx = (px / canvas.width) * 2 - 1;
      const ny = 1 - (py / canvas.height) * 2;
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
    setColors({ sky, fog, light, sun, clouds } = {}) {
      if (sky) { scene.skyTop = rgb(sky[0]); scene.skyBottom = rgb(sky[1]); }
      if (fog) { scene.fogColor = rgb(fog[0]); scene.fog = [fog[1], fog[2]]; }
      if (light) { scene.light = light.dir; scene.lightColor = rgb(light.color); scene.ambient = rgb(light.ambient); }
      if (sun !== undefined) {
        scene.sun = sun ? sun.dir.concat([sun.radius]) : null;
        if (sun) { scene.sunTop = rgb(sun.top); scene.sunBottom = rgb(sun.bottom); scene.sunRetro = sun.retro ? 1 : 0; }
      }
      if (clouds !== undefined) {
        scene.cloudCount = clouds ? Math.min(16, clouds.count) : 0;
        if (clouds) {
          scene.cloudColor = rgb(clouds.color ?? '#ffffff');
          scene.cloudShade = rgb(clouds.shade ?? '#d8def0');
          // Deterministic spread around the horizon (no Math.random: same sky every time).
          let seed = clouds.seed ?? 7;
          const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          for (let i = 0; i < 16; i++) {
            scene.clouds[i * 4] = (i / 16) * Math.PI * 2 + next() * 0.3;
            scene.clouds[i * 4 + 1] = 0.05 + next() * (clouds.height ?? 0.28);
            scene.clouds[i * 4 + 2] = 0.1 + next() * 0.12;
            scene.clouds[i * 4 + 3] = 0;
          }
        }
      }
    },

    destroy() {
      for (const m of meshes) if (m.vbo && !lost) gl.deleteBuffer(m.vbo);
      meshes.clear();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return r;
}
