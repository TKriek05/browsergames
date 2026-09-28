// Unified input: keyboard, gamepad and on-screen touch controls produce one
// state object { ax, ay, buttons, aim } that games sample every fixed tick.
import { BTN } from '../../../shared/messages.js';

// Default mapping (event.code = physical key, so it works on AZERTY too).
const DEFAULT_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  A: ['Space', 'KeyJ', 'Enter'],
  B: ['ShiftLeft', 'KeyK'],
  X: ['KeyL', 'KeyE'],
  Y: ['KeyQ'],
};

const DEADZONE = 0.18;

export class Input {
  constructor(keys = DEFAULT_KEYS) {
    this.keys = keys;
    this.down = new Set();
    this.touch = { ax: 0, ay: 0, buttons: 0 };
    this.state = { ax: 0, ay: 0, buttons: 0, aim: 0 };
    this.lastSource = 'keyboard';

    this._keydown = (e) => {
      if (isTyping(e.target)) return;
      // Let Space/Enter activate a focused button (HUD, dialogs).
      if ((e.code === 'Space' || e.code === 'Enter') && e.target?.closest?.('button, a, dialog')) return;
      if (this._handles(e.code)) {
        e.preventDefault(); // no page scrolling with arrows/space while playing
        this.down.add(e.code);
        this.lastSource = 'keyboard';
      }
    };
    this._keyup = (e) => this.down.delete(e.code);
    this._blur = () => this.down.clear();
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', this._blur);
  }

  _handles(code) {
    for (const list of Object.values(this.keys)) if (list.includes(code)) return true;
    return false;
  }

  _pressed(action) {
    const list = this.keys[action];
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (this.down.has(list[i])) return true;
    return false;
  }

  // Called by the touch controls.
  setTouch(ax, ay, buttons) {
    this.touch.ax = ax;
    this.touch.ay = ay;
    this.touch.buttons = buttons;
    this.lastSource = 'touch';
  }

  // Sample all sources. Returns the same (reused) object every call.
  sample() {
    let ax = (this._pressed('right') ? 1 : 0) - (this._pressed('left') ? 1 : 0);
    let ay = (this._pressed('down') ? 1 : 0) - (this._pressed('up') ? 1 : 0);
    let buttons = 0;
    if (this._pressed('A')) buttons |= BTN.A;
    if (this._pressed('B')) buttons |= BTN.B;
    if (this._pressed('X')) buttons |= BTN.X;
    if (this._pressed('Y')) buttons |= BTN.Y;

    // Gamepad (first connected pad, standard mapping).
    // The Gamepad API needs a secure context (https or localhost).
    const pads = window.isSecureContext && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const gx = Math.abs(pad.axes[0] ?? 0) > DEADZONE ? pad.axes[0] : 0;
      const gy = Math.abs(pad.axes[1] ?? 0) > DEADZONE ? pad.axes[1] : 0;
      const b = pad.buttons;
      const dx = (b[15]?.pressed ? 1 : 0) - (b[14]?.pressed ? 1 : 0);
      const dy = (b[13]?.pressed ? 1 : 0) - (b[12]?.pressed ? 1 : 0);
      if (gx || gy || dx || dy) {
        ax = gx || dx;
        ay = gy || dy;
        this.lastSource = 'gamepad';
      }
      if (b[0]?.pressed) buttons |= BTN.A;
      if (b[1]?.pressed) buttons |= BTN.B;
      if (b[2]?.pressed) buttons |= BTN.X;
      if (b[3]?.pressed) buttons |= BTN.Y;
      if (b[4]?.pressed) buttons |= BTN.L;
      if (b[5]?.pressed) buttons |= BTN.R;
      if (b[9]?.pressed) buttons |= BTN.START;
      break;
    }

    if (this.touch.ax || this.touch.ay) {
      ax = this.touch.ax;
      ay = this.touch.ay;
    }
    buttons |= this.touch.buttons;

    // Keep diagonal speed equal to straight speed.
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    const s = this.state;
    s.ax = ax;
    s.ay = ay;
    s.buttons = buttons;
    if (ax || ay) s.aim = Math.atan2(ay, ax);
    return s;
  }

  destroy() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('blur', this._blur);
  }
}

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function isTouchDevice() {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}
