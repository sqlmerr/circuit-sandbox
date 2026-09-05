import { createGrid2D, setPixel, type Grid2D } from "../types";

export function makeGrid(width: number, height: number): Grid2D {
  return createGrid2D(width, height);
}

export function wire(g: Grid2D, x: number, y: number, net: number): void {
  setPixel(g, x, y, net + 2);
}

export function rect(
  g: Grid2D,
  x0: number,
  y0: number,
  idx: number,
  w: number,
  h: number,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(g, x0 + dx, y0 + dy, idx);
    }
  }
}
