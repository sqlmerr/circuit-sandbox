import { createGrid2D } from "../core/types";
import type { Grid2D, IR, ParseError } from "../core/types";

export type Mode = "edit" | "run";
export type ToolName = "stamp" | "brush" | "pipette";
export type StampType = "and" | "or" | "xor" | "not" | "high" | "low" | "dff" | "bulb" | "clock";

export interface Camera {
  scale: number;
  ox: number;
  oy: number;
}

export interface SimView {
  running: boolean;
  speed: number;
  cur: Uint8Array;
  t: number;
}

export interface StampState {
  type: StampType;
  rotation: boolean;
  w: number;
  h: number;
  pixels: number[][];
}

export interface State {
  grid: Grid2D;
  cam: Camera;
  mode: Mode;
  tool: ToolName;
  brushNet: number;
  sim: SimView;
  ir: IR | null;
  errors: ParseError[];
  warnings: ParseError[];
  stamp: StampState | null;
  ghostX: number;
  ghostY: number;
}

export type Action =
  | { kind: "grid"; grid: Grid2D }
  | { kind: "zoom"; delta: number; cx: number; cy: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "setCam"; cam: Camera }
  | { kind: "tool"; tool: ToolName }
  | { kind: "brushNet"; net: number }
  | { kind: "stampType"; stampType: StampType }
  | { kind: "stampRot" }
  | { kind: "stampCancel" }
  | { kind: "simRunning"; on: boolean }
  | { kind: "simSpeed"; speed: number }
  | { kind: "simTick"; cur: Uint8Array; t: number }
  | { kind: "simReset" }
  | { kind: "parse"; ir: IR; errors: ParseError[]; warnings: ParseError[] }
  | { kind: "mode"; mode: Mode }
  | { kind: "load"; grid: Grid2D; w: number; h: number }
  | { kind: "ghostPos"; x: number; y: number };

export function initState(defaultW = 128, defaultH = 128): State {
  const grid = createGrid2D(defaultW, defaultH);
  const initialSim: SimView = { running: false, speed: 10, cur: new Uint8Array(8), t: 0 };
  return {
    grid,
    cam: { scale: 4, ox: 0, oy: 0 },
    mode: "edit",
    tool: "stamp",
    brushNet: 0,
    sim: initialSim,
    ir: null,
    errors: [],
    warnings: [],
    stamp: makeStamp("and"),
    ghostX: 0,
    ghostY: 0,
  };
}

export function apply(s: State, a: Action): State {
  switch (a.kind) {
    case "grid":
      return { ...s, grid: a.grid };

    case "zoom": {
      // направление: delta>0 (колесо вниз) — отдать, иначе приблизить
      const dir = a.delta > 0 ? -1 : 1;
      const factor = dir > 0 ? 1.1 : 0.9;
      let newScale = Math.round(s.cam.scale * factor);
      // округление не должно съедать шаг (иначе зум залипает на целом масштабе)
      if (newScale === s.cam.scale) newScale = s.cam.scale + dir;
      newScale = Math.max(1, Math.min(32, newScale));
      if (newScale === s.cam.scale) return s;
      const ratio = newScale / s.cam.scale;
      return {
        ...s,
        cam: {
          scale: newScale,
          ox: a.cx - (a.cx - s.cam.ox) * ratio,
          oy: a.cy - (a.cy - s.cam.oy) * ratio,
        },
      };
    }

    case "pan":
      return { ...s, cam: { ...s.cam, ox: s.cam.ox + a.dx, oy: s.cam.oy + a.dy } };

    case "setCam":
      return { ...s, cam: a.cam };

    case "tool":
      return { ...s, tool: a.tool, stamp: a.tool === "stamp" ? s.stamp : null };

    case "brushNet":
      return { ...s, brushNet: a.net };

    case "stampType":
      return { ...s, tool: "stamp", stamp: makeStamp(a.stampType) };

    case "stampRot":
      if (!s.stamp || s.stamp.type === "clock") return s;
      return { ...s, stamp: rotateStamp(s.stamp) };

    case "stampCancel":
      return { ...s, stamp: null };

    case "simRunning":
      return {
        ...s,
        sim: { ...s.sim, running: a.on },
        mode: a.on ? "run" : "edit",
      };

    case "simSpeed":
      return { ...s, sim: { ...s.sim, speed: a.speed } };

    case "simTick":
      return { ...s, sim: { running: s.sim.running, speed: s.sim.speed, cur: a.cur, t: a.t } };

    case "simReset":
      return {
        ...s,
        sim: { running: false, speed: s.sim.speed, cur: new Uint8Array(8), t: 0 },
        mode: "edit",
      };

    case "parse":
      return { ...s, ir: a.ir, errors: a.errors, warnings: a.warnings };

    case "mode":
      if (a.mode === "run" && !s.ir) return s;
      return {
        ...s,
        mode: a.mode,
        sim: a.mode === "edit"
          ? { ...s.sim, running: false, cur: new Uint8Array(8), t: 0 }
          : s.sim,
      };

    case "load":
      return { ...s, grid: a.grid };

    case "ghostPos":
      return { ...s, ghostX: a.x, ghostY: a.y };

    default:
      return s;
  }
}

export interface StampDef {
  type: StampType;
  label: string;
  pixels: number[][];
}

export const STAMP_DEFS: StampDef[] = [
  { type: "and",  label: "AND",  pixels: [[0,0,0,0],[10,10,0,0],[10,10,10,0]] },
  { type: "or",   label: "OR",   pixels: [[0,0,0,0],[11,11,0,0],[11,11,11,0]] },
  { type: "xor",  label: "XOR",  pixels: [[0,0,0,0],[12,12,0,0],[12,12,12,0]] },
  { type: "not",  label: "NOT",  pixels: [[0,0,0],[13,13,0],[13,13,0]] },
  { type: "high", label: "HIGH", pixels: [[15,15,15],[15,15,15],[15,15,15]] },
  { type: "low",  label: "LOW",  pixels: [[16,16,16],[16,16,16],[16,16,16]] },
  { type: "dff",  label: "DFF",  pixels: [[17,17,17],[17,17,17],[17,17,17]] },
  { type: "bulb", label: "BULB", pixels: [[18,18,18],[18,18,18]] },
  { type: "clock",label: "CLK",  pixels: (() => {
    const h: number[][] = [];
    for (let y = 0; y < 5; y++) { const row: number[] = []; for (let x = 0; x < 10; x++) row.push(14); h.push(row); }
    return h;
  })() },
];

export function makeStamp(type: StampType): StampState {
  const def = STAMP_DEFS.find(d => d.type === type)!;
  return { type, rotation: false, w: def.pixels[0].length, h: def.pixels.length, pixels: def.pixels };
}

function rotateStamp(s: StampState): StampState {
  const { pixels, w, h } = s;
  const newW = h;
  const newH = w;
  const newPx: number[][] = [];
  for (let y = 0; y < newH; y++) {
    const row: number[] = [];
    for (let x = 0; x < newW; x++) row.push(pixels[newH - 1 - y][x]);
    newPx.push(row);
  }
  return { ...s, w: newW, h: newH, pixels: newPx, rotation: true };
}
