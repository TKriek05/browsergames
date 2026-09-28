// Game canvas that scales with its container while keeping the aspect ratio.
//
// pixelated: true  → the backing store is the logical resolution (e.g. 320×180)
//                    and CSS scales it up with image-rendering: pixelated. We
//                    prefer integer scale factors in *device* pixels, so every
//                    game pixel is equally big and crisp on any devicePixelRatio.
// pixelated: false → the backing store follows the CSS size × devicePixelRatio
//                    for sharp vector drawing (board games); draw in logical units.

export function createGameCanvas(container, { width, height, pixelated = true }) {
  const canvas = document.createElement('canvas');
  canvas.className = pixelated ? 'game-canvas game-canvas--pixel' : 'game-canvas';
  canvas.width = width;
  canvas.height = height;
  container.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = !pixelated;

  const view = { canvas, ctx, width, height, scale: 1, destroy, toLogical };

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const availW = container.clientWidth;
    const availH = container.clientHeight;
    if (!availW || !availH) return;

    let cssScale = Math.min(availW / width, availH / height);
    if (pixelated) {
      // Integer scale in device pixels when that still fills most of the space.
      const devScale = Math.floor(cssScale * dpr);
      if (devScale >= 1 && devScale / (cssScale * dpr) >= 0.85) cssScale = devScale / dpr;
    }
    const cssW = Math.floor(width * cssScale);
    const cssH = Math.floor(height * cssScale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    view.scale = cssScale;

    if (!pixelated) {
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(bw / width, 0, 0, bh / height, 0, 0);
      ctx.imageSmoothingEnabled = true;
    }
  }

  const ro = new ResizeObserver(fit);
  ro.observe(container);
  // devicePixelRatio changes (zoom, moving to another monitor) do not always resize.
  let mq = null;
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', onDpr);
  };
  const onDpr = () => { fit(); watchDpr(); };
  watchDpr();
  fit();

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }

  function destroy() {
    ro.disconnect();
    mq?.removeEventListener('change', onDpr);
    canvas.remove();
  }

  return view;
}

// Offscreen canvas for static layers (backgrounds, walls): draw once, blit every frame.
export function createLayer(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}
