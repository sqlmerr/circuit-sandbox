import type { Camera } from "./state";

export interface Viewport {
  cam: Camera;
  cw: number;
  ch: number;
}

export function screenToGrid(v: Viewport, sx: number, sy: number): [number, number] {
  return [
    Math.floor((sx - v.cam.ox) / v.cam.scale),
    Math.floor((sy - v.cam.oy) / v.cam.scale),
  ];
}

export function gridToScreen(v: Viewport, gx: number, gy: number): [number, number] {
  return [gx * v.cam.scale + v.cam.ox, gy * v.cam.scale + v.cam.oy];
}
