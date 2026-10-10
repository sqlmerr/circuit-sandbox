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

// Перекрёсток "+" с центровиной: вертикаль и горизонталь проходят через общий
// пиксель-провод, но НЕ соединяются (парсер трактует его как два узла H/V).
export function cross(g: Grid2D, x: number, y: number): void {
  wire(g, x, y);
}

// Мост «плюс без центровины»: четыре рукава-провода по сторонам, а центр
// пустой. Парсер читает H (W↔E) и V (N↔S) как две независимые сквозные сети,
// сам центр пинов не даёт. Рисуется поверх обоих проводов — центр стирается.
export function bridge(g: Grid2D, x: number, y: number): void {
  wire(g, x - 1, y);
  wire(g, x + 1, y);
  wire(g, x, y - 1);
  wire(g, x, y + 1);
  setPixel(g, x, y, 0);
}

// Сегменты семисегментной цифры (3 клетки в ширину, 5 в высоту):
//    aaa
//   f   b
//    ggg
//   e   c
//    ddd
const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgecd",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

// Цифра, нарисованная проводом (как на семисегментном индикаторе). Служит
// визуальной меткой; это ВИСЯЧИЙ провод — ни к чему не подключён, читается
// как 0 и на логику не влияет. Клетка (x,y) — левый верхний угол цифры.
export function segDigit(g: Grid2D, x: number, y: number, digit: string): void {
  const segs = SEGMENTS[digit];
  if (!segs) return;
  const has = (s: string) => segs.includes(s);
  if (has("a")) hWire(g, x, x + 2, y);
  if (has("f")) vWire(g, x, y, y + 2);
  if (has("b")) vWire(g, x + 2, y, y + 2);
  if (has("g")) hWire(g, x, x + 2, y + 2);
  if (has("e")) vWire(g, x, y + 2, y + 4);
  if (has("c")) vWire(g, x + 2, y + 2, y + 4);
  if (has("d")) hWire(g, x, x + 2, y + 4);
}
