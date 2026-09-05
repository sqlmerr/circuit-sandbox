import { makeGrid, rect, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const NOT = 13;
const BULB = 18;

// Два NOT в кольце + лампочка. Осциллирует с периодом 2 тика.
export function ringNot(): Grid2D {
  const g = makeGrid(16, 10);

  rect(g, 2, 2, NOT, 3, 2); // NOT1
  rect(g, 8, 2, NOT, 3, 2); // NOT2

  // net0 (красная): NOT1.E -> NOT2.W
  hWire(g, 5, 7, 2, 0);

  // net1 (зелёная): NOT2.E -> вокруг -> NOT1.W
  hWire(g, 11, 11, 2, 1);
  vWire(g, 11, 2, 5, 1);
  hWire(g, 1, 11, 5, 1);
  vWire(g, 1, 2, 5, 1);

  // лампочка на net1 (север касается горизонтали net1)
  rect(g, 2, 6, BULB, 2, 2);

  return g;
}
