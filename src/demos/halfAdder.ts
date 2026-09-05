import { makeGrid, rect, wire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const XOR = 12;
const AND = 10;
const HIGH = 15;
const BULB = 18;

// Полусумматор: XOR (сумма) + AND (перенос).
// Входы A (net0) и B (net1) — HIGH-источники (тумблеры через runtime-toggle).
export function halfAdder(): Grid2D {
  const g = makeGrid(20, 16);

  // гейты
  rect(g, 6, 4, XOR, 4, 3); // XOR x6-9 y4-6
  rect(g, 6, 9, AND, 4, 3); // AND x6-9 y9-11

  // входы A=net0, B=net1
  rect(g, 1, 3, HIGH, 3, 3); // HIGH_A x1-3 y3-5, E x=4
  rect(g, 1, 7, HIGH, 3, 3); // HIGH_B x1-3 y7-9, E x=4

  // net0: HIGH_A.E(4,4) -> XOR.W(5,4) -> вниз -> AND.W(5,9)
  wire(g, 4, 4, 0);
  wire(g, 5, 4, 0);
  vWire(g, 5, 4, 9, 0);

  // net1: HIGH_B.E(4,8) -> вверх к XOR.W(5,5), и вниз к AND.W(5,10)
  // (идём по x=4 только с y=6, чтобы не задеть HIGH_A)
  wire(g, 4, 8, 1);
  vWire(g, 4, 6, 8, 1);
  wire(g, 5, 6, 1);
  wire(g, 5, 5, 1);
  vWire(g, 4, 8, 10, 1);
  wire(g, 5, 10, 1);

  // сумма net2: XOR.E -> лампочка
  wire(g, 10, 5, 2);
  wire(g, 11, 5, 2);
  rect(g, 12, 4, BULB, 3, 3); // x12-14 y4-6, W x=11

  // перенос net3: AND.E -> лампочка
  wire(g, 10, 9, 3);
  wire(g, 11, 9, 3);
  rect(g, 12, 8, BULB, 3, 3); // x12-14 y8-10, W x=11

  return g;
}
