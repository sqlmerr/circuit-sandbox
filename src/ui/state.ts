import { createGrid2D } from "../core/types";
import { roleOf } from "../core/palette";
import { shapeForRole } from "../core/shapes";
import type { Grid2D, IR, ParseError } from "../core/types";

export type Mode = "edit" | "run";
export type ToolName = "stamp" | "brush" | "pipette";
export type StampType =
  | "and" | "or" | "xor" | "not"
  | "high" | "bulb" | "clock"
  | "switch" | "mem"
  | "bridge";

// Значение пикселя штампа: 0 = не трогать клетку, ERASE_STAMP = стереть в пусто,
// иначе — цвет палитры (провод или тело компонента).
export const ERASE_STAMP = -1;

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
  // Значения переключателей в рантайме (только для отображения; сама
  // симуляция держит свою копию в SimState.switches).
  switches: Uint8Array;
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
  brushColor: number;
  sim: SimView;
  ir: IR | null;
  netMap: Int32Array | null;
  errors: ParseError[];
  warnings: ParseError[];
  stamp: StampState | null;
  ghostX: number;
  ghostY: number;
  ghostErase: boolean;
}

export type Action =
  | { kind: "grid"; grid: Grid2D }
  | { kind: "zoom"; delta: number; cx: number; cy: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "setCam"; cam: Camera }
  | { kind: "tool"; tool: ToolName }
  | { kind: "brushColor"; color: number }
  | { kind: "stampType"; stampType: StampType }
  | { kind: "stampRot" }
  | { kind: "stampCancel" }
  | { kind: "simRunning"; on: boolean }
  | { kind: "simSpeed"; speed: number }
  | { kind: "simTick"; cur: Uint8Array; t: number; switches: Uint8Array }
  | { kind: "simSwitches"; switches: Uint8Array }
  | { kind: "simReset" }
  | { kind: "parse"; ir: IR; errors: ParseError[]; warnings: ParseError[]; netMap: Int32Array }
  | { kind: "mode"; mode: Mode }
  | { kind: "load"; grid: Grid2D; w: number; h: number }
  | { kind: "ghostPos"; x: number; y: number }
  | { kind: "ghostErase"; on: boolean };

export function initState(defaultW = 128, defaultH = 128): State {
  const grid = createGrid2D(defaultW, defaultH);
  const initialSim: SimView = {
    running: false,
    speed: 10,
    cur: new Uint8Array(0),
    t: 0,
    switches: new Uint8Array(0),
  };
  return {
    grid,
    cam: { scale: 4, ox: 0, oy: 0 },
    mode: "edit",
    tool: "brush",
    brushColor: 2,
    sim: initialSim,
    ir: null,
    netMap: null,
    errors: [],
    warnings: [],
    stamp: makeStamp("and"),
    ghostX: 0,
    ghostY: 0,
    ghostErase: false,
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

    case "brushColor":
      return { ...s, brushColor: a.color };

    case "stampType":
      return { ...s, tool: "stamp", stamp: makeStamp(a.stampType) };

    case "stampRot":
      if (!s.stamp || s.stamp.type === "clock") return s;
      return { ...s, stamp: rotateStamp(s.stamp) };

    case "stampCancel":
      return { ...s, stamp: null };

    case "simRunning":
      // Пауза отвязана от edit: остановка симуляции оставляет режим run — так
      // переключатели можно щёлкать, не возобновляя время. Возврат в edit —
      // кнопка «Сначала» (simReset).
      return {
        ...s,
        sim: { ...s.sim, running: a.on },
        mode: a.on ? "run" : s.mode,
      };

    case "simSpeed":
      return { ...s, sim: { ...s.sim, speed: a.speed } };

    case "simTick":
      return { ...s, sim: { running: s.sim.running, speed: s.sim.speed, cur: a.cur, t: a.t, switches: a.switches } };

    case "simSwitches":
      return { ...s, sim: { ...s.sim, switches: a.switches } };

    case "simReset":
      return {
        ...s,
        sim: {
          running: false,
          speed: s.sim.speed,
          cur: new Uint8Array(s.ir?.netCount ?? 0),
          t: 0,
          switches: new Uint8Array(s.ir?.switches.length ?? 0),
        },
        mode: "edit",
      };

    case "parse":
      return { ...s, ir: a.ir, errors: a.errors, warnings: a.warnings, netMap: a.netMap };

    case "mode":
      if (a.mode === "run" && !s.ir) return s;
      return {
        ...s,
        mode: a.mode,
        sim: a.mode === "edit"
          ? { ...s.sim, running: false, cur: new Uint8Array(s.ir?.netCount ?? 0), t: 0, switches: new Uint8Array(s.ir?.switches.length ?? 0) }
          : s.sim,
      };

    case "load":
      return { ...s, grid: a.grid };

    case "ghostPos":
      return { ...s, ghostX: a.x, ghostY: a.y };

    case "ghostErase":
      return s.ghostErase === a.on ? s : { ...s, ghostErase: a.on };

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
  { type: "and",  label: "AND",  pixels: gatePixels(3) },
  { type: "or",   label: "OR",   pixels: gatePixels(4) },
  { type: "xor",  label: "XOR",  pixels: gatePixels(5) },
  { type: "not",  label: "NOT",  pixels: gatePixels(6) },
  { type: "high", label: "HIGH", pixels: [[8,8,8],[8,8,8],[8,8,8]] },
  { type: "switch", label: "SW", pixels: [[11,11],[11,11]] },
  { type: "mem", label: "MEM", pixels: [[12,12],[12,12]] },
  { type: "bulb", label: "BULB", pixels: [[9,9],[9,9]] },
  { type: "clock",label: "CLK",  pixels: [[7,7,7],[7,7,7],[7,7,7]] },
  // Мост: 4 рукава-провода вокруг пустого центра — перекрёсток «плюс без
  // центровины» (парсер пускает H и V насквозь, не соединяя их между собой).
  { type: "bridge", label: "BRIDGE", pixels: [[0, 2, 0], [2, ERASE_STAMP, 2], [0, 2, 0]] },
];

// Матрица штампа из каноничной фигуры тела роли (core/shapes) — тот же
// источник правды, что и у парсера, поэтому штамп всегда совпадает с фигурой,
// которую парсер готов принять.
function gatePixels(idx: number): number[][] {
  const shape = shapeForRole(roleOf(idx))!;
  return shape.map((row) => row.map((v) => (v ? idx : 0)));
}

export function makeStamp(type: StampType): StampState {
  const def = STAMP_DEFS.find(d => d.type === type)!;
  return { type, rotation: false, w: def.pixels[0].length, h: def.pixels.length, pixels: def.pixels };
}

/**
 * Поворот штампа на 90° по часовой стрелке: клетка (y, x) переезжает в
 * (x, h-1-y). Вместе с картинкой поворачиваются и отростки-пины, поэтому
 * разводка (входы на W/N, выход на E/S) остаётся такой же.
 */
export function rotateStamp(s: StampState): StampState {
  const { pixels, w, h } = s;
  const newW = h;
  const newH = w;
  const newPx: number[][] = [];
  for (let y = 0; y < newH; y++) {
    const row: number[] = [];
    for (let x = 0; x < newW; x++) row.push(pixels[h - 1 - x][y]);
    newPx.push(row);
  }
  return { ...s, w: newW, h: newH, pixels: newPx, rotation: !s.rotation };
}
