// Paddle movement for Paddle Party and Stenenbreker. Shared by server and
// client prediction: plain arithmetic, rounded to float32.
const f = Math.fround;

export const PADDLE_SPEED = 175;

// s: { p } (centre along the paddle's axis). axis: -1..1 (quantized input).
export function stepPaddle(s, axis, dt, min, max, speed = PADDLE_SPEED) {
  const a = axis < -1 ? -1 : axis > 1 ? 1 : axis;
  let p = s.p + a * speed * dt;
  if (p < min) p = min;
  if (p > max) p = max;
  s.p = f(p);
}
