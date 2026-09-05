import { toRgb } from "../core/palette";
import type { State, Camera } from "./state";
import type { Viewport } from "./camera";

let offscreen: OffscreenCanvas | null = null;
let offCtx: OffscreenCanvasRenderingContext2D | null = null;
let cachedW = 0;
let cachedH = 0;

function ensureOffscreen(w: number, h: number) {
  if (w === cachedW && h === cachedH && offscreen) return;
  offscreen = new OffscreenCanvas(w, h);
  offCtx = offscreen.getContext("2d")!;
  cachedW = w;
  cachedH = h;
}

export function render(viewport: Viewport, s: State, _canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const { cw, ch } = viewport;
  const { grid, cam, mode, errors, warnings, stamp, sim, ir } = s;
  const { width, height, data } = grid;

  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(0, 0, cw, ch);

  ensureOffscreen(width, height);
  const imgData = offCtx!.createImageData(width, height);
  const px = new Uint32Array(imgData.data.buffer);

  const isRun = mode === "run";
  const cur = sim.cur;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = data[y * width + x];
      if (idx === 0) {
        px[y * width + x] = 0x00000000;
        continue;
      }
      const [r, g, b] = toRgb(idx);
      let rO = r, gO = g, bO = b;
      if (isRun && idx >= 2 && idx <= 9) {
        const netVal = cur[idx - 2] || 0;
        const bright = netVal ? 1.0 : 0.3;
        rO = Math.round(r * bright);
        gO = Math.round(g * bright);
        bO = Math.round(b * bright);
      } else if (isRun && idx === 18 && cur && ir) {
        const bulb = ir.bulbs.find(bl => {
          const bx = x >= bl.cells[0][0] && x <= bl.cells[bl.cells.length - 1][0];
          const by = y >= bl.cells[0][1] && y <= bl.cells[bl.cells.length - 1][1];
          return bx && by;
        });
        if (bulb && cur[bulb.net]) {
          rO = 0xff; gO = 0xff; bO = 0;
        }
      }
      px[y * width + x] = (0xff << 24) | ((bO & 0xff) << 16) | ((gO & 0xff) << 8) | (rO & 0xff);
    }
  }
  offCtx!.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen!, cam.ox, cam.oy, width * cam.scale, height * cam.scale);

  if (stamp && mode === "edit") {
    ctx.globalAlpha = 0.5;
    const color = stampColor(stamp.pixels[0][0]);
    ctx.fillStyle = color;
    drawStampGhost(ctx, cam, s);
    ctx.globalAlpha = 1.0;
  }

  // Подсветка — только слабый тинт без обводки, чтобы не перекрашивать
  // саму клетку: иначе свежий провод под WARN_IDLE_NET выглядит
  // оранжевым вместо красного.
  for (const e of errors) {
    overlayCells(ctx, cam, e.cells, "rgba(255,0,0,0.15)");
  }
  for (const w of warnings) {
    overlayCells(ctx, cam, w.cells, "rgba(255,200,0,0.12)");
  }

  ctx.strokeStyle = "#ff4444";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, cw, ch);
}

function overlayCells(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  cells: [number, number][],
  fill: string,
): void {
  ctx.fillStyle = fill;
  for (const [cx, cy] of cells) {
    ctx.fillRect(cx * cam.scale + cam.ox, cy * cam.scale + cam.oy, cam.scale, cam.scale);
  }
}

function stampColor(idx: number): string {
  if (idx === 0) return "#ffffff";
  const [r, g, b] = toRgb(idx);
  return `rgb(${r},${g},${b})`;
}

function drawStampGhost(ctx: CanvasRenderingContext2D, cam: Camera, s: State) {
  const stamp = s.stamp!;
  for (let dy = 0; dy < stamp.h; dy++) {
    for (let dx = 0; dx < stamp.w; dx++) {
      const px = stamp.pixels[dy][dx];
      if (px === 0) continue;
      const gx = s.ghostX + dx;
      const gy = s.ghostY + dy;
      if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) continue;
      ctx.fillRect(gx * cam.scale + cam.ox, gy * cam.scale + cam.oy, cam.scale, cam.scale);
    }
  }
}
