import { setPixel, copyGrid2D, type Grid2D } from "../core/types";
import type { State, Action } from "./state";

function clone(s: State): Grid2D {
  return copyGrid2D(s.grid);
}

export function stampGrid(s: State, gx: number, gy: number): Grid2D | null {
  const st = s.stamp;
  if (!st) return null;
  let g = clone(s);
  let changed = false;
  for (let dy = 0; dy < st.h; dy++) {
    for (let dx = 0; dx < st.w; dx++) {
      const px = st.pixels[dy][dx];
      if (px === 0) continue;
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      if (g.data[y * g.width + x] !== px) changed = true;
      setPixel(g, x, y, px);
    }
  }
  s.stamp = null;
  return changed ? g : null;
}

export function brushAt(s: State, gx: number, gy: number): Grid2D | null {
  if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) return null;
  const idx = s.brushNet + 2;
  if (s.grid.data[gy * s.grid.width + gx] === idx) return null;
  const g = clone(s);
  setPixel(g, gx, gy, idx);
  return g;
}

export function eraseAt(s: State, gx: number, gy: number): Grid2D | null {
  if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) return null;
  if (s.grid.data[gy * s.grid.width + gx] === 0) return null;
  const g = clone(s);
  setPixel(g, gx, gy, 0);
  return g;
}

export function pipette(s: State, gx: number, gy: number): Action | null {
  if (gx < 0 || gy < 0 || gx >= s.grid.width || gy >= s.grid.height) return null;
  const idx = s.grid.data[gy * s.grid.width + gx];
  if (idx >= 2 && idx <= 9) {
    return { kind: "brushNet", net: idx - 2 };
  }
  return null;
}
