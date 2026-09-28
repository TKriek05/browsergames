// On-screen controls for phones/tablets: a floating joystick on the left half
// and action buttons on the right. Feeds Input.setTouch().
import { h } from './ui.js';
import { BTN } from '../../../shared/messages.js';

const STICK_RADIUS = 52; // px

// buttons: [{ label: 'A', bit: BTN.A }]
export function createTouchControls(container, input, { buttons = [{ label: 'A', bit: BTN.A }] } = {}) {
  const root = h('div', { class: 'touch', 'aria-hidden': 'true' });
  const zone = h('div', { class: 'touch__zone' });
  const base = h('div', { class: 'touch__base' });
  const knob = h('div', { class: 'touch__knob' });
  base.append(knob);
  zone.append(base);
  const pad = h('div', { class: 'touch__buttons' });
  root.append(zone, pad);
  container.append(root);

  let stickId = null;
  let origin = { x: 0, y: 0 };
  let ax = 0;
  let ay = 0;
  let pressed = 0;
  const push = () => input.setTouch(ax, ay, pressed);

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const rect = zone.getBoundingClientRect();
    origin = { x: e.clientX, y: e.clientY };
    base.style.left = `${e.clientX - rect.left}px`;
    base.style.top = `${e.clientY - rect.top}px`;
    base.classList.add('is-active');
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    ax = dx / STICK_RADIUS;
    ay = dy / STICK_RADIUS;
    if (Math.hypot(ax, ay) < 0.15) ax = ay = 0;
    push();
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    ax = ay = 0;
    knob.style.transform = '';
    base.classList.remove('is-active');
    push();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  for (const b of buttons) {
    const btn = h('div', { class: 'touch__btn' }, b.label);
    const on = (e) => { pressed |= b.bit; btn.classList.add('is-down'); push(); e.preventDefault(); };
    const off = () => { pressed &= ~b.bit; btn.classList.remove('is-down'); push(); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    pad.append(btn);
  }

  return {
    destroy() {
      input.setTouch(0, 0, 0);
      root.remove();
    },
  };
}
