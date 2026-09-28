// Game canvas that scales with its container while keeping the aspect ratio.
//
// pixelated: true  → the backing store is the logical resolution (e.g. 320×180)
//                    and CSS scales it up with image-rendering: pixelated. We
//                    prefer integer scale factors in *device* pixels, so every
//                    game pixel is equally big and crisp on any devicePixelRatio.
// pixelated: false → the backing store follows the CSS size × devicePixelRatio
//                    for sharp vector drawing (board games); draw in logical units.
// gl: true         → 3D games: a WebGL canvas (view.glCanvas) with a transparent
//                    2D HUD canvas (view.canvas) on top. With pixelated: true the
//                    3D image is rendered at the logical resolution and scaled up
//                    blocky; with pixelated: false it follows the screen resolution
//                    (smooth, capped for speed). Draw the HUD in logical units.

// Most device pixels a smooth WebGL canvas may have (≈ 1920 × 1080).
const MAX_GL_PIXELS = 2_100_000;
const MAX_GL_DPR = 2;

export function createGameCanvas(container, { width, height, pixelated = true, gl = false }) {
  const canvas = document.createElement('canvas');
  canvas.className = pixelated ? 'game-canvas game-canvas--pixel' : 'game-canvas';
  canvas.width = width;
  canvas.height = height;
  let glCanvas = null;
  let root = canvas;
  if (gl) {
    root = document.createElement('div');
    root.className = 'game-stack';
    glCanvas = document.createElement('canvas');
    glCanvas.className = pixelated ? 'game-canvas game-canvas--pixel game-canvas--gl' : 'game-canvas game-canvas--gl';
    glCanvas.width = width;
    glCanvas.height = height;
    // Read by the renderer: logical size (for project/groundPoint) and antialiasing.
    glCanvas.logicalWidth = width;
    glCanvas.smooth = !pixelated;
    canvas.classList.add('game-canvas--hud');
    root.append(glCanvas, canvas);
  }
  container.append(root);
  const ctx = canvas.getContext('2d', { alpha: gl });
  ctx.imageSmoothingEnabled = !pixelated;

  const view = { canvas, ctx, glCanvas, width, height, scale: 1, destroy, toLogical };

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
    for (const el of glCanvas ? [root, glCanvas, canvas] : [canvas]) {
      el.style.width = `${cssW}px`;
      el.style.height = `${cssH}px`;
    }
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
      if (glCanvas) {
        const k = Math.min(1, Math.sqrt(MAX_GL_PIXELS / (cssW * cssH * dpr * dpr)));
        const d = Math.min(dpr, MAX_GL_DPR) * k;
        const gw = Math.max(width, Math.round(cssW * d));
        const gh = Math.max(height, Math.round(cssH * d));
        if (glCanvas.width !== gw || glCanvas.height !== gh) {
          glCanvas.width = gw;
          glCanvas.height = gh;
        }
      }
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
    root.remove();
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

// Offscreen layer at the canvas' real resolution for smooth (non-pixelated)
// games: draw(ctx) in logical units; it is redrawn when the canvas resizes.
export function createSharpLayer(view, draw) {
  let layer = null;
  let w = 0;
  let h = 0;
  return {
    blit(ctx) {
      const cw = view.canvas.width;
      const ch = view.canvas.height;
      if (!layer || w !== cw || h !== ch) {
        w = cw;
        h = ch;
        layer = layer ?? document.createElement('canvas');
        layer.width = cw;
        layer.height = ch;
        const lctx = layer.getContext('2d');
        lctx.setTransform(cw / view.width, 0, 0, ch / view.height, 0, 0);
        draw(lctx);
      }
      ctx.drawImage(layer, 0, 0, view.width, view.height);
    },
  };
}
