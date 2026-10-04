import { createGrid2D, setPixel, type Grid2D } from "../core/types";
import { WIRE_INDEX } from "../core/palette";
import { stampGateBody } from "../core/shapes";

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

// Тело гейта в каноничной для его роли фигуре (3×3): 2-входные гейты рисуются
// как 110/011/110, NOT — крестом. `rot` — число поворотов на 90° по часовой
// стрелке, поэтому отростки-пины переезжают вместе с фигурой.
export function gate(g: Grid2D, x0: number, y0: number, idx: number, rot = 0): void {
  stampGateBody(g, x0, y0, idx, rot);
}

// Провода все одного цвета (WIRE_INDEX); сеть = связная область, поэтому
// разные сети надо разводить зазорами (не менее одного пустого пикселя)
// или строить перекрёстки "+" (без соединения).
export function wire(g: Grid2D, x: number, y: number): void {
  setPixel(g, x, y, WIRE_INDEX);
}

export function hWire(g: Grid2D, x0: number, x1: number, y: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) wire(g, x, y);
}

export function vWire(g: Grid2D, x: number, y0: number, y1: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) wire(g, x, y);
}

// Перекрёсток "+": вертикаль и горизонталь проходят через общий пиксель,
// но НЕ соединяются (пинса парсер трактует как два отдельных узла H/V).
export function cross(g: Grid2D, x: number, y: number): void {
  wire(g, x, y);
}
