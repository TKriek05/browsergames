// Raak de Roos (archery): values, the arrow flight and scoring, shared by
// the server (which decides) and the client (which shows your arrow at once
// and lets the bots' and others' arrows fly the same way).
// Lane coordinates in metres: x to the right, y up, z down the range. The
// bow is at (0, EYE, 0), the target face stands at z = distance.

export const ARC = {
  EYE: 1.5,
  TARGET_H: 1.3, // centre of the face
  FACE_R: 0.61, // a 122 cm face: 10 rings of 6.1 cm
  RING: 0.061,
  LANE_W: 3.4,
  LANES: 6,
  GRAVITY: 9.81,
  SPEED_MIN: 30, // arrow speed at the weakest draw …
  SPEED_MAX: 62, // … and at full draw (m/s)
  MIN_DRAW: 0.3, // below this the arrow is not shot
  WIND_K: 0.16, // sideways pull per m/s of wind (the arrow drifts with it)
  DT: 1 / 120,
  MAX_T: 3,
  ARROWS: 3, // per end
  ARROW_GAP_S: 1.2,
  SHOOT_S: 45,
  INTRO_S: 3,
  SCORE_S: 4.5,
  END_HOLD_S: 6,
  MAX_YAW: 0.3,
  MAX_PITCH: 0.35,
  MOVE_AMP: 0.9, // a moving target slides this far left and right …
  MOVE_W: 0.9, // … at this angular speed (rad/s)
  TIME_SLACK_S: 0.4, // how far back a client's release time may lie
};

export const WIND_MAX = { uit: 0, licht: 2.5, normaal: 5, sterk: 8 };

// Distances for `ends` ends: from close to far.
export function endDistances(ends) {
  const near = 18;
  const far = 70;
  return Array.from({ length: ends }, (_, i) => Math.round(ends === 1 ? 30 : near + ((far - near) * i) / (ends - 1)));
}

// Horizontal offset of a moving target at `t` seconds into the end.
export function targetOffset(lane, t, moving) {
  return moving ? ARC.MOVE_AMP * Math.sin(ARC.MOVE_W * t + lane * 1.7) : 0;
}

export const arrowSpeed = (draw) => ARC.SPEED_MIN + (ARC.SPEED_MAX - ARC.SPEED_MIN) * draw;

// Fly one arrow. Returns { hit, x, y, z, t } where (x, y) is where it crossed
// the target plane (hit = true) or where it came down (hit = false, y = 0).
// path (optional array) gets [x, y, z] every `every` steps for the animation.
export function flyArrow(dist, yaw, pitch, draw, wind, path = null, every = 6) {
  const v = arrowSpeed(draw);
  const cp = Math.cos(pitch);
  let vx = v * cp * Math.sin(yaw);
  let vy = v * Math.sin(pitch);
  let vz = v * cp * Math.cos(yaw);
  let x = 0;
  let y = ARC.EYE;
  let z = 0;
  let t = 0;
  const dt = ARC.DT;
  let step = 0;
  if (path) path.push([x, y, z]);
  while (t < ARC.MAX_T) {
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    const nz = z + vz * dt;
    if (nz >= dist) {
      // Crosses the target plane in this step: interpolate.
      const k = (dist - z) / (nz - z);
      const res = { hit: true, x: x + (nx - x) * k, y: y + (ny - y) * k, z: dist, t: t + dt * k };
      if (res.y <= 0) return land(x, y, z, nx, ny, nz, t, dt, path);
      if (path) path.push([res.x, res.y, res.z]);
      return res;
    }
    if (ny <= 0) return land(x, y, z, nx, ny, nz, t, dt, path);
    vx += ARC.WIND_K * (wind - vx) * dt;
    vy -= ARC.GRAVITY * dt;
    x = nx;
    y = ny;
    z = nz;
    t += dt;
    if (path && ++step % every === 0) path.push([x, y, z]);
  }
  return { hit: false, x, y: 0, z, t };
}

function land(x, y, z, nx, ny, nz, t, dt, path) {
  const k = y / (y - ny);
  const res = { hit: false, x: x + (nx - x) * k, y: 0, z: z + (nz - z) * k, t: t + dt * k };
  if (path) path.push([res.x, 0, res.z]);
  return res;
}

// Score of a hit at (dx, dy) from the centre of the face: 10 … 1, 0 = miss.
// X = the inner half of the 10 (counts for ties).
export function ringScore(dx, dy) {
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > ARC.FACE_R) return { score: 0, x: false };
  const ring = 10 - Math.floor(r / ARC.RING);
  return { score: Math.max(1, ring), x: r < ARC.RING / 2 };
}

// Aim that sends an arrow at draw `draw` to (tx, ty) on the target plane
// (bots). Solves pitch first (the wind only pushes sideways), then yaw.
export function solveAim(dist, tx, ty, draw, wind) {
  let lo = -0.2;
  let hi = ARC.MAX_PITCH;
  let pitch = 0;
  for (let i = 0; i < 26; i++) {
    pitch = (lo + hi) / 2;
    const r = flyArrow(dist, 0, pitch, draw, 0);
    if (r.hit && r.y > ty) hi = pitch;
    else lo = pitch;
  }
  let ylo = -ARC.MAX_YAW;
  let yhi = ARC.MAX_YAW;
  let yaw = 0;
  let t = 0;
  for (let i = 0; i < 26; i++) {
    yaw = (ylo + yhi) / 2;
    const r = flyArrow(dist, yaw, pitch, draw, wind);
    t = r.t;
    if (r.x > tx) yhi = yaw;
    else ylo = yaw;
  }
  return { yaw, pitch, t };
}
