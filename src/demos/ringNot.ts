import { makeGrid, gate, rect, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const NOT = 6;
const BULB = 10;

// Два NOT в кольце + лампочка. Осциллирует с периодом 2 тика.
//
// Крест симметричен, поэтому у обоих NOT вход с запада, выход на восток:
// сеть a идёт от NOT1 к NOT2, сеть b возвращается низом к NOT1.
// Все провода одного цвета (сеть = связность), поэтому две сети разведены
// по разным слоям пикселей.
export function ringNot(): Grid2D {
  const g = makeGrid(14, 9);

  gate(g, 2, 2, NOT); // NOT1 (Q->nQ) x2-4 y2-4: W(2,3), E(4,3)
  gate(g, 8, 2, NOT); // NOT2 (nQ->Q) x8-10 y2-4: W(8,3), E(10,3)

  // сеть a: NOT1.E(4,3) -> NOT2.W(8,3)
  hWire(g, 5, 7, 3);

  // сеть b: NOT2.E(10,3) -> вниз по x=11 -> низом влево -> вверх -> NOT1.W(2,3).
  // Шина идёт по y6 (не по y5), иначе она коснулась бы S-отростков NOT.
  vWire(g, 11, 3, 6);
  hWire(g, 1, 11, 6);
  vWire(g, 1, 3, 6);

  // лампочка: северный край касается шины сети b (y6)
  rect(g, 2, 7, BULB, 2, 2);

  return g;
}