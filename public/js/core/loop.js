// Game loop: requestAnimationFrame with a fixed timestep for logic and an
// interpolation factor (alpha) for rendering. rAF stops in background tabs;
// when the tab comes back we skip the missed time instead of fast-forwarding.

const MAX_FRAME_S = 0.25;

export function createLoop({ step = 1 / 60, update, render }) {
  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const now = ts / 1000;
    let dt = last ? now - last : 0;
    last = now;
    if (dt > MAX_FRAME_S) dt = step; // tab was hidden or the device hiccuped
    acc += dt;
    while (acc >= step) {
      update(step);
      acc -= step;
    }
    render(acc / step);
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      last = 0;
      acc = 0;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    get running() {
      return running;
    },
  };
}
