import { makeGrid, rect, wire, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const OR = 11;
const NOT = 13;
const HIGH = 15;
const BULB = 18;

// RS-триггер из OR + NOT (через Де Моргана).
// S=net0, R=net1, Q=net2. Уравнение: Q = S OR ((NOT R) AND Q).
// S и R — HIGH-источники (тумблеры).
export function rsLatch(): Grid2D {
  const g = makeGrid(40, 16);

  // источники
  rect(g, 18, 8, HIGH, 3, 3); // S_HIGH x18-20 y8-10
  rect(g, 3, 10, HIGH, 3, 3); // R_HIGH x3-5 y10-12 (запад x=2 свободен от шины Q)

  // гейты
  rect(g, 2, 6, NOT, 3, 2); // g2: NOT(Q->nQ) x2-4 y6-7
  rect(g, 10, 4, OR, 4, 3); // g3: OR(R,nQ->t1) x10-13 y4-6
  rect(g, 18, 4, NOT, 3, 2); // g4: NOT(t1->t2) x18-20 y4-5
  rect(g, 26, 6, OR, 4, 3); // g5: OR(S,t2->Q) x26-29 y6-8

  // S (net0): S_HIGH.E(21,8) -> g5.W(25,8)
  wire(g, 21, 8, 0);
  hWire(g, 21, 25, 8, 0);

  // R (net1): R_HIGH.E(6,11) -> g3.W(9,4)
  wire(g, 6, 11, 1);
  hWire(g, 6, 9, 11, 1);
  vWire(g, 9, 4, 11, 1);

  // nQ (net4): g2.E(5,6) -> g3.W(9,5)
  wire(g, 5, 6, 4);
  wire(g, 5, 5, 4);
  hWire(g, 5, 9, 5, 4);

  // t1 (net5): g3.E(14,5) -> g4.W(17,5)
  hWire(g, 14, 17, 5, 5);

  // t2 (net6): g4.E(21,4) -> g5.W(25,7)
  vWire(g, 21, 4, 7, 6);
  hWire(g, 21, 25, 7, 6);

  // Q (net2): g5.E(30,7) -> g2.W(1,6) + лампочка
  // (шина по y=14, чтобы не задеть R_HIGH снизу)
  vWire(g, 30, 7, 14, 2);
  hWire(g, 1, 30, 14, 2);
  vWire(g, 1, 6, 14, 2);
  wire(g, 31, 7, 2);
  rect(g, 32, 6, BULB, 3, 3); // x32-34 y6-8

  return g;
}
