// Raak de Roos bots: work out the aim that hits the middle (gravity, wind and
// a moving target included), then miss a little: easy bots aim shakily and
// half forget the wind, hard bots are steady.
import { ARC, solveAim, targetOffset } from '../../shared/games/archery.js';

export const BOT_THINK_S = { easy: 3.2, normal: 2.4, hard: 1.8 };
const LEVELS = {
  easy: { shake: 0.009, wind: 0.6, draw: [0.85, 1] },
  normal: { shake: 0.005, wind: 0.85, draw: [0.95, 1] },
  hard: { shake: 0.0024, wind: 1, draw: [1, 1] },
};

// Roughly normal noise (sum of three uniforms), standard deviation ≈ 1.
const noise = (rng) => (rng() + rng() + rng() - 1.5) * 2;

export function planArrow(game, a, level, rng) {
  const cfg = LEVELS[level] ?? LEVELS.normal;
  const draw = cfg.draw[0] + (cfg.draw[1] - cfg.draw[0]) * rng();
  const wind = game.wind * cfg.wind;
  const t0 = game.endTime;
  // Where will the target be when the arrow arrives? Two passes are plenty.
  let tx = targetOffset(a.lane, t0 + 1, game.moving);
  let aim = solveAim(game.distance, tx, ARC.TARGET_H, draw, wind);
  if (game.moving) {
    tx = targetOffset(a.lane, t0 + aim.t, game.moving);
    aim = solveAim(game.distance, tx, ARC.TARGET_H, draw, wind);
  }
  return {
    yaw: aim.yaw + noise(rng) * cfg.shake,
    pitch: aim.pitch + noise(rng) * cfg.shake,
    draw,
  };
}
