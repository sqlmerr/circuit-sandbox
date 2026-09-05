import { makeGrid, rect, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const HIGH = 15;
const CLOCK = 14;
const DFF = 17;
const BULB = 18;

// D-триггер с тактированием от CLOCK.
// D=net0 (HIGH), C=net1 (CLOCK 4x2), Q=net2 + лампочка.
export function dFlipFlop(): Grid2D {
  const g = makeGrid(16, 12);

  rect(g, 6, 4, DFF, 3, 3); // x6-8 y4-6
  rect(g, 1, 3, HIGH, 3, 3); // D_HIGH x1-3 y3-5
  rect(g, 1, 7, CLOCK, 4, 2); // CLOCK x1-4 y7-8, period 4 high 2

  // D (net0): HIGH.E(4,4) -> DFF.W(5,4)
  hWire(g, 4, 5, 4, 0);
  // C (net1): CLOCK.E(5,7) -> DFF.W(5,5)
  vWire(g, 5, 5, 7, 1);
  // Q (net2): DFF.E(9,5) -> лампочка
  hWire(g, 9, 10, 5, 2);
  rect(g, 11, 4, BULB, 3, 3); // x11-13 y4-6

  return g;
}
