import { makeGrid, rect, wire, hWire, vWire } from "./util";
import type { Grid2D } from "../core/types";

const NOT = 13;
const DFF = 17;
const CLOCK = 14;
const BULB = 18;

// Двоичный счётчик цепочкой DFF (D = NOT Q, такт следующего = Q предыдущего).
// ПРИМЕЧАНИЕ: 4-битный ripple требует 9 сетей (clk + 4x(Q,n)), а их всего 8.
// Поэтому здесь 3-битный счётчик (0..7) на 7 сетях:
// clk=0, Q0=1, n0=2, Q1=3, n1=4, Q2=5, n2=6.
//
// Приём против пересечений: D идёт по W (сверху), C — по N.
// n-сети идут в обход снизу (y=8), Q-сети наверх (y=2).
export function counter4(): Grid2D {
  const g = makeGrid(60, 18);

  rect(g, 2, 4, CLOCK, 4, 2); // CLOCK x2-5 y4-5, period 4 high 2

  // --- stage 0 ---
  rect(g, 8, 4, DFF, 3, 3); // DFF0 x8-10 y4-6
  rect(g, 8, 11, NOT, 3, 2); // NOT0 x8-10 y11-12
  // clk (net0): CLOCK.E(6,4) -> вверх -> DFF0.N(8,3)
  wire(g, 6, 4, 0);
  vWire(g, 6, 2, 4, 0);
  hWire(g, 6, 8, 2, 0);
  wire(g, 8, 3, 0);
  // Q0 (net1): DFF0.E(11,5) -> NOT0.W(7,11) и наверх к stage1
  wire(g, 11, 5, 1);
  wire(g, 12, 5, 1);
  vWire(g, 12, 5, 11, 1);
  wire(g, 7, 11, 1);
  vWire(g, 12, 2, 5, 1);
  hWire(g, 12, 27, 2, 1);
  wire(g, 27, 3, 1); // DFF1.N
  // n0 (net2): NOT0.E(11,11) -> низом -> DFF0.W(7,4)
  wire(g, 11, 11, 2);
  vWire(g, 11, 11, 13, 2);
  hWire(g, 11, 14, 13, 2);
  vWire(g, 14, 8, 13, 2);
  hWire(g, 7, 14, 8, 2);
  vWire(g, 7, 4, 8, 2);
  // Q0 -> bulb0 (отвод вниз от (7,11))
  vWire(g, 7, 11, 16, 1);
  rect(g, 8, 14, BULB, 3, 3); // x8-10 y14-16

  // --- stage 1 ---
  rect(g, 26, 4, DFF, 3, 3); // DFF1 x26-28 y4-6
  rect(g, 26, 11, NOT, 3, 2); // NOT1 x26-28 y11-12
  // Q1 (net3): DFF1.E(29,5) -> NOT1.W(25,11) и наверх к stage2
  wire(g, 29, 5, 3);
  wire(g, 30, 5, 3);
  vWire(g, 30, 5, 11, 3);
  wire(g, 25, 11, 3);
  vWire(g, 30, 2, 5, 3);
  hWire(g, 30, 45, 2, 3);
  wire(g, 45, 3, 3); // DFF2.N
  // n1 (net4): NOT1.E(29,11) -> низом -> DFF1.W(25,4)
  wire(g, 29, 11, 4);
  vWire(g, 29, 8, 11, 4);
  hWire(g, 25, 29, 8, 4);
  vWire(g, 25, 4, 8, 4);
  // Q1 -> bulb1 (отвод вниз от (25,11))
  vWire(g, 25, 11, 16, 3);
  rect(g, 26, 14, BULB, 3, 3); // x26-28 y14-16

  // --- stage 2 ---
  rect(g, 44, 4, DFF, 3, 3); // DFF2 x44-46 y4-6
  rect(g, 44, 11, NOT, 3, 2); // NOT2 x44-46 y11-12
  // Q2 (net5): DFF2.E(47,5) -> NOT2.W(43,11)
  // (только (43,11): hWire перезаписал бы тело NOT2)
  wire(g, 47, 5, 5);
  wire(g, 48, 5, 5);
  vWire(g, 48, 5, 11, 5);
  wire(g, 43, 11, 5);
  // n2 (net6): NOT2.E(47,11) -> низом -> DFF2.W(43,4)
  wire(g, 47, 11, 6);
  vWire(g, 47, 8, 11, 6);
  hWire(g, 43, 47, 8, 6);
  vWire(g, 43, 4, 8, 6);
  // Q2 -> bulb2 (отвод вниз от (43,11))
  vWire(g, 43, 11, 16, 5);
  rect(g, 44, 14, BULB, 3, 3); // x44-46 y14-16

  return g;
}
