import { makeGrid, rect, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const NOT = 6;
const BULB = 10;

// Два NOT в кольце + лампочка. Осциллирует с периодом 2 тика.
// Все провода одного цвета (сеть = связность), поэтому две сети
// разведены по разным слоям пикселей.
export function ringNot(): Grid2D {
  const g = makeGrid(14, 9);

  rect(g, 2, 2, NOT, 3, 2); // NOT1 x2-4 y2-3
  rect(g, 8, 2, NOT, 3, 2); // NOT2 x8-10 y2-3

  // сеть a: NOT1.E(5,2) -> NOT2.W(7,2)
  hWire(g, 5, 7, 2);

  // сеть b: NOT2.E(11,2) -> вниз -> низом влево -> NOT1.W(1,2)
  vWire(g, 11, 2, 5);
  hWire(g, 1, 11, 5);
  vWire(g, 1, 2, 5);

  // лампочка: северный край касается горизонтали сети b (y5)
  rect(g, 2, 6, BULB, 2, 2);

  return g;
}