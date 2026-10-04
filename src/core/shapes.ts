import { roleOf, type Role } from "./palette";
import { setPixel, type Grid2D } from "./types";

/** Фигура тела: 1 — пиксель тела, 0 — пусто. */
export type Shape = number[][];

const OPPOSITE: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };

// Канонические фигуры тел гейтов: 1 — пиксель тела, 0 — пусто.
// Стороны играют роль и в legacy-режиме парсера (W/N — входы, E/S — выходы),
// поэтому ответвления на западе — входы, ответвление на востоке — выход.
// Поворот на 90° CW переносит входы на север, на 180° — обратно на запад.

/** 2 входа, 1 выход (AND/OR/XOR): */
export const SHAPE_2IN: Shape = [
  [1, 1, 0],
  [0, 1, 1],
  [1, 1, 0],
];

/**
 * 1 вход, 1 выход (NOT) — крест: все четыре ответвления симметричны, поэтому
 * входом считается та сторона, чья сеть приводится кем-то ещё (см. parse.ts).
 * Фигура инвариантна относительно поворотов на 90°, так что ориентацию NOT
 * задаёт только разводка, а не картинка.
 */
export const SHAPE_1IN: Shape = [
  [0, 1, 0],
  [1, 1, 1],
  [0, 1, 0],
];

/** Поворот фигуры на 90° по часовой стрелке: (y,x) → (x, h-1-y). */
export function rotateCW(shape: Shape): Shape {
  const h = shape.length;
  const w = shape[0].length;
  const out: Shape = [];
  for (let y = 0; y < w; y++) {
    const row: number[] = [];
    for (let x = 0; x < h; x++) row.push(shape[h - 1 - x][y]);
    out.push(row);
  }
  return out;
}

/** Поворот на `rot` четвертей по часовой стрелке (0..3, циклически). */
export function rotated(shape: Shape, rot: number): Shape {
  let s = shape;
  const n = ((rot % 4) + 4) % 4;
  for (let i = 0; i < n; i++) s = rotateCW(s);
  return s;
}

/** Все четыре поворота фигуры: 0°, 90° CW, 180°, 270° CW. */
export function rotations(shape: Shape): Shape[] {
  const out = [shape];
  for (let i = 1; i < 4; i++) out.push(rotateCW(out[i - 1]));
  return out;
}

/**
 * Фигура тела для роли. null = у роли канонической фигуры нет, тело должно
 * быть сплошным прямоугольником (источники, лампочка).
 */
export function shapeForRole(role: Role): Shape | null {
  switch (role) {
    case "and":
    case "or":
    case "xor":
      return SHAPE_2IN;
    case "not":
      return SHAPE_1IN;
    default:
      return null;
  }
}

/**
 * Совпадает ли bitmap тела (по его bbox) с одним из поворотов фигуры.
 * bitmap[y][x] = 1, если клетка принадлежит телу.
 */
export function matchesShape(bitmap: number[][], shape: Shape): boolean {
  const h = bitmap.length;
  const w = h > 0 ? bitmap[0].length : 0;
  for (const rot of rotations(shape)) {
    if (rot.length !== h || rot[0].length !== w) continue;
    let ok = true;
    for (let y = 0; y < h && ok; y++) {
      for (let x = 0; x < w; x++) {
        if (rot[y][x] !== bitmap[y][x]) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

export type Side = "N" | "S" | "E" | "W";

export interface ShapePorts {
  /** Стороны, пины с которых считаются входами. */
  inputs: Side[];
  /** Стороны, пины с которых считаются выходами. */
  outputs: Side[];
}

/**
 * Порты фигуры по геометрии: сторона, где граничные клетки тела разнесены
 * (две несмежные клетки с зазором между ними) — это пара входов, а
 * противоположная сторона с единственной клеткой — выход.
 *
 * Порты следуют за нарисованной фигурой, а не за сторонами света, поэтому
 * поворот всегда осмыслен: у гейта, повёрнутого на 180°, входы оказываются на
 * востоке, а выход на западе — ровно там, где нарисованы отростки.
 *
 * У симметричных фигур (крест NOT) ни одна сторона не разнесена — возвращаются
 * пустые списки, и разбор падает обратно на роли по сторонам света плюс
 * вывод по разводке (см. pickNotPorts в parse.ts).
 */
export function shapePorts(bitmap: number[][]): ShapePorts {
  const h = bitmap.length;
  const w = bitmap[0].length;
  const cells: Record<Side, number[]> = { N: [], S: [], E: [], W: [] };
  for (let x = 0; x < w; x++) {
    if (bitmap[0][x]) cells.N.push(x);
    if (bitmap[h - 1][x]) cells.S.push(x);
  }
  for (let y = 0; y < h; y++) {
    if (bitmap[y][0]) cells.W.push(y);
    if (bitmap[y][w - 1]) cells.E.push(y);
  }
  // Разнесённая сторона: между первой и последней граничной клеткой есть
  // дырка, то есть их больше, чем длина непрерывного отрезка.
  const spread = (s: Side): boolean => {
    const c = cells[s];
    return c.length >= 2 && c[c.length - 1] - c[0] > c.length - 1;
  };
  const side = (["N", "S", "E", "W"] as Side[]).find(spread);
  if (!side) return { inputs: [], outputs: [] };
  return { inputs: [side], outputs: [OPPOSITE[side]] };
}

/** Наносит фигуру в grid индексом idx начиная с клетки (x0, y0); 0 не трогает. */
export function stampShape(
  grid: Grid2D,
  x0: number,
  y0: number,
  idx: number,
  shape: Shape,
  rot = 0,
): void {
  const s = rotated(shape, rot);
  for (let y = 0; y < s.length; y++) {
    for (let x = 0; x < s[y].length; x++) {
      if (s[y][x]) setPixel(grid, x0 + x, y0 + y, idx);
    }
  }
}

/**
 * Ставит тело гейта индексом idx в (x0, y0) в канонической для его роли
 * фигуре (или сплошным прямоугольником 3×3, если у роли фигуры нет).
 * `rot` — число четвертей по часовой стрелке.
 */
export function stampGateBody(
  grid: Grid2D,
  x0: number,
  y0: number,
  idx: number,
  rot = 0,
): void {
  const shape = shapeForRole(roleOf(idx));
  if (!shape) {
    stampShape(grid, x0, y0, idx, FALLBACK_RECT);
    return;
  }
  stampShape(grid, x0, y0, idx, shape, rot);
}

/** Сплошной прямоугольник 3×3 — фигура для ролей без канонической формы. */
const FALLBACK_RECT: Shape = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
];