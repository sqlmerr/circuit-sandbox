import { makeGrid, rect, hWire } from "./util";
import type { Grid2D } from "../core/types";

const SWITCH = 11;
const MEM = 12;
const BULB = 9;

// Ячейка памяти на T-триггере: SWITCH -> MEM -> BULB.
//
// Переключатель (клик в run-режиме) даёт фронт 0→1, по которому ячейка памяти
// инвертирует своё значение. Лампочка показывает сохранённый бит, поэтому
// каждый клик по переключателю переключает свет 0/1.
//
// Пины: у SWITCH выход на востоке (4,3); у MEM вход на западе (5,3), выход на
// востоке (8,3); у BULB вход на западе (9,3). Две сети разведены зазором —
// тела компонентов и так разрывают провод.
export function toggleMemory(): Grid2D {
  const g = makeGrid(14, 8);

  rect(g, 2, 3, SWITCH, 2, 2); // SWITCH x2-3 y3-4, E=4
  hWire(g, 4, 5, 3); // вход ячейки
  rect(g, 6, 3, MEM, 2, 2); // MEM x6-7 y3-4, W=5, E=8
  hWire(g, 8, 9, 3); // выход ячейки
  rect(g, 10, 3, BULB, 2, 2); // BULB x10-11 y3-4, W=9

  return g;
}
