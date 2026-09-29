// Spetterveld controls: mouse look via pointer lock (click the field; if the
// browser refuses, drag with the left button), touch look by dragging on the
// right half, and the mouse button to fire. Turning is collected here and
// taken by the game with take().
const MOUSE_SENS = 0.0026; // rad per pixel
const TOUCH_SENS = 0.007;

export function createControls(canvas, touch) {
  const c = {
    locked: false,
    lockFailed: false,
    mouseFire: false,
    turn: 0,
    // Turning since the last call (radians).
    take() {
      const t = c.turn;
      c.turn = 0;
      return t;
    },
    destroy: null,
  };
  let lookId = null;
  let lookX = 0;
  const onClick = () => {
    if (touch || c.locked || c.lockFailed) return;
    try {
      const p = canvas.requestPointerLock?.();
      p?.catch?.(() => { c.lockFailed = true; });
    } catch {
      c.lockFailed = true;
    }
  };
  const onLockChange = () => {
    c.locked = document.pointerLockElement === canvas;
    if (!c.locked) c.mouseFire = false;
  };
  const onLockError = () => { c.lockFailed = true; };
  const onMove = (e) => {
    if (c.locked) c.turn += e.movementX * MOUSE_SENS;
    else if (c.lockFailed && e.buttons & 1 && e.pointerType === 'mouse') c.turn += e.movementX * MOUSE_SENS;
  };
  const onDown = (e) => {
    if (e.pointerType === 'touch') {
      if (lookId === null) {
        lookId = e.pointerId;
        lookX = e.clientX;
      }
      return;
    }
    if (e.button === 0 && (c.locked || c.lockFailed)) c.mouseFire = true;
  };
  const onTouchMove = (e) => {
    if (e.pointerId !== lookId) return;
    c.turn += (e.clientX - lookX) * TOUCH_SENS;
    lookX = e.clientX;
  };
  const onUp = (e) => {
    if (e.pointerId === lookId) lookId = null;
    if (e.pointerType !== 'touch' && e.button === 0) c.mouseFire = false;
  };
  const menu = (e) => e.preventDefault();
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onTouchMove);
  canvas.addEventListener('contextmenu', menu);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  c.destroy = () => {
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onTouchMove);
    canvas.removeEventListener('contextmenu', menu);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', onLockError);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  };
  return c;
}
