import { toRgb, WIRE_INDEX } from "../core/palette";
import type { State, Camera } from "./state";
import type { Viewport } from "./camera";

const WIRE_ON_BRIGHTNESS = 1.5;
const BULB_OFF_BRIGHTNESS = 0.3;

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
  const { grid, cam, mode, errors, warnings, stamp, sim, ir, netMap } = s;
  const { width, height, data } = grid;

  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(0, 0, cw, ch);

  ensureOffscreen(width, height);
  const imgData = offCtx!.createImageData(width, height);
  const px = new Uint32Array(imgData.data.buffer);

  const isRun = mode === "run";
  const cur = sim.cur;

  // Лампочки: по факту горят все клетки тела. Клетки тела в IR — не сортированы
  // (порядок flood-fill), поэтому bbox считаем один раз до пиксельного цикла.
  const bulbBoxes: { minX: number; minY: number; maxX: number; maxY: number; net: number }[] = [];
  if (isRun && ir) {
    for (const b of ir.bulbs) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [cx, cy] of b.cells) {
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      if (minX <= maxX) bulbBoxes.push({ minX, minY, maxX, maxY, net: b.net });
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = data[i];
      if (idx === 0) {
        px[i] = 0x00000000;
        continue;
      }
      const [r, g, b] = toRgb(idx);
      let rO = r, gO = g, bO = b;
      if (isRun && idx === WIRE_INDEX) {
        // Провод горит по значению своей сети (сеть = связная область через netMap):
        // при 1 — осветляем, при 0 — дефолтный цвет (без затемнения).
        const net = netMap ? netMap[i] : -1;
        const netVal = net >= 0 ? (cur[net] || 0) : 0;
        if (netVal) {
          rO = Math.min(255, Math.round(r * WIRE_ON_BRIGHTNESS));
          gO = Math.min(255, Math.round(g * WIRE_ON_BRIGHTNESS));
          bO = Math.min(255, Math.round(b * WIRE_ON_BRIGHTNESS));
        }
      } else if (isRun && netMap && ir) {
        const bulb = bulbBoxes.find(bb => x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY);
        if (bulb) {
          // Лампочка: при 1 — жёлтый свет, при 0 — тускло (× BULB_OFF_BRIGHTNESS).
          if (cur[bulb.net]) {
            rO = 0xff; gO = 0xff; bO = 0;
          } else {
            rO = Math.min(255, Math.round(r * BULB_OFF_BRIGHTNESS));
            gO = Math.min(255, Math.round(g * BULB_OFF_BRIGHTNESS));
            bO = Math.min(255, Math.round(b * BULB_OFF_BRIGHTNESS));
          }
        }
      }
      px[i] = (0xff << 24) | ((bO & 0xff) << 16) | ((gO & 0xff) << 8) | (rO & 0xff);
    }
  }
  offCtx!.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen!, cam.ox, cam.oy, width * cam.scale, height * cam.scale);

  if (stamp && mode === "edit") {
    ctx.globalAlpha = 0.5;
    const color = stampColor(firstStampPixel(stamp.pixels));
    ctx.fillStyle = color;
    drawStampGhost(ctx, cam, s);
    ctx.globalAlpha = 1.0;
  }

  if (s.tool === "brush" && mode === "edit") {
    drawBrushGhost(ctx, cam, s);
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

const EMPTY_STAMP = 0;

// Цвет призрака — по первому «настоящему» пикселю штампа (не пустота и не стирание).
function firstStampPixel(pixels: number[][]): number {
  for (const row of pixels) {
    for (const p of row) {
      if (p > EMPTY_STAMP) return p;
    }
  }
  return EMPTY_STAMP;
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
      if (px <= EMPTY_STAMP) continue;
      const gx = s.ghostX + dx;
      const gy = s.ghostY + dy;
      if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) continue;
      ctx.fillRect(gx * cam.scale + cam.ox, gy * cam.scale + cam.oy, cam.scale, cam.scale);
    }
  }
}

const BRUSH_GHOST_ALPHA = 0.5;

// Призрак кисти: один прозрачный квадрат активного цвета под курсором (ПКМ —
// «стереть», цвет пустоты). Если клетка уже того же цвета, рисунок ничего не
// изменит — тогда заливки нет, только рамка, чтобы курсор не «исчезал».
function drawBrushGhost(ctx: CanvasRenderingContext2D, cam: Camera, s: State) {
  const { ghostX: gx, ghostY: gy } = s;
  if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) return;
  const idx = s.ghostErase ? EMPTY_STAMP : s.brushColor;
  const sx = gx * cam.scale + cam.ox;
  const sy = gy * cam.scale + cam.oy;
  if (s.grid.data[gy * s.grid.width + gx] !== idx) {
    ctx.globalAlpha = BRUSH_GHOST_ALPHA;
    ctx.fillStyle = stampColor(idx);
    ctx.fillRect(sx, sy, cam.scale, cam.scale);
    ctx.globalAlpha = 1.0;
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 0.5, sy + 0.5, cam.scale - 1, cam.scale - 1);
}
