import { makeGrid, rect, wire, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const OR = 4;
const NOT = 6;
const HIGH = 8;
const BULB = 10;

// RS-триггер из OR + NOT: Q = S OR (Q AND NOT R).
// S и R — HIGH-источники (runtime-тумблеры в run-режиме).
//
// Все сети разведены зазорами, перекрёстков нет:
//   слой Q идёт по левому краю (x=1) и правому (x=26), шинами y17 и y3.
export function rsLatch(): Grid2D {
  const g = makeGrid(32, 20);

  rect(g, 2, 2, NOT, 3, 2); // NOT1 (Q->nQ) x2-4 y2-3
  rect(g, 8, 2, OR, 4, 3); // OR1 (R,nQ->t1) x8-11 y2-4
  rect(g, 14, 2, NOT, 3, 2); // NOT2 (t1->t2) x14-16 y2-3
  rect(g, 20, 2, OR, 4, 3); // OR2 (S,t2->Q) x20-23 y2-4
  rect(g, 27, 2, BULB, 3, 3); // Q x27-29 y2-4, W=26
  rect(g, 3, 9, HIGH, 3, 3); // R_HIGH x3-5 y9-11, E=6
  rect(g, 3, 13, HIGH, 3, 3); // S_HIGH x3-5 y13-15, E=6

  // nQ: NOT1.E(5,3) -> наверх -> OR1.W(7,2)
  hWire(g, 5, 7, 2);
  wire(g, 6, 3);
  wire(g, 6, 2);

  // R: R_HIGH.E(6,10) -> вправо -> вверх -> OR1.W(7,4)
  wire(g, 6, 10);
  hWire(g, 6, 7, 10);
  vWire(g, 7, 4, 10);

  // S: S_HIGH.E(6,14) -> вправо -> вверх -> OR2.W(19,4)
  hWire(g, 6, 19, 14);
  vWire(g, 19, 4, 14);

  // t1: OR1.E(12,3) -> NOT2.W(13,3)
  wire(g, 12, 3);
  wire(g, 13, 3);

  // t2: NOT2.E(17,3) -> наверх -> OR2.W(19,2)
  wire(g, 17, 3);
  vWire(g, 17, 2, 3);
  hWire(g, 17, 19, 2);

  // Q: OR2.E(24,3) -> лампочка (26,3) и влево низом -> NOT1.W(1,3)
  hWire(g, 24, 26, 3);
  vWire(g, 26, 3, 17);
  hWire(g, 1, 26, 17);
  vWire(g, 1, 3, 17);

  return g;
}