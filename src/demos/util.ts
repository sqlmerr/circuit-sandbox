import { createGrid2D, setPixel, type Grid2D } from "../core/types";

export function makeGrid(width: number, height: number): Grid2D {
  return createGrid2D(width, height);
}

export function rect(g: Grid2D, x0: number, y0: number, idx: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(g, x0 + dx, y0 + dy, idx);
    }
  }
}

export function wire(g: Grid2D, x: number, y: number, net: number): void {
  setPixel(g, x, y, net + 2);
}

export function hWire(g: Grid2D, x0: number, x1: number, y: number, net: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) wire(g, x, y, net);
}

export function vWire(g: Grid2D, x: number, y0: number, y1: number, net: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) wire(g, x, y, net);
}
