// Paddle Party: field layout shared by server and client.
// A square field; side 0 = bottom, 1 = top, 2 = left, 3 = right.
export const PF = {
  size: 176,
  corner: 14, // solid corner blocks
  paddleLen: 34,
  paddleThick: 4,
  inset: 6, // paddle distance from its edge
  ballR: 2.5,
};
export const SIDE_NAMES = ['ONDER', 'BOVEN', 'LINKS', 'RECHTS'];
export const paddleMin = () => PF.corner + PF.paddleLen / 2;
export const paddleMax = () => PF.size - PF.corner - PF.paddleLen / 2;
export const isHorizontal = (side) => side < 2;
// Which input axis drives a side's paddle.
export const sideAxis = (side, ax, ay) => (isHorizontal(side) ? ax : ay);
