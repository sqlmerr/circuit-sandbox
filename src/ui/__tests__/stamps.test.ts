import { describe, it, expect } from "vitest";
import { createGrid2D, setPixel, type Grid2D } from "../../core/types";
import { WIRE_INDEX, roleOf } from "../../core/palette";
import { parse } from "../../core/parse";
import { rotated, shapeForRole } from "../../core/shapes";
import { makeStamp, rotateStamp, type StampState, type StampType } from "../state";

// Отдельный тест на штампы: поворот должен быть настоящим поворотом на 90°
// по часовой стрелке, а парсер — принимать гейт в любом из четырёх
// положений с пинами на нарисованных отростках.

const SIZE = 24;

function mask(s: StampState): number[][] {
  return s.pixels.map((row) => row.map((v) => (v > 0 ? 1 : 0)));
}

function colorOf(s: StampState): number {
  return s.pixels.flat().find((v) => v > 0)!;
}

describe("stamps: поворот", () => {
  it("поворачивает гейт на 90° по часовой стрелке", () => {
    // 110/011/110 -> 101/111/010
    expect(mask(rotateStamp(makeStamp("and")))).toEqual([
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 0],
    ]);
  });

  it("совпадает с поворотом каноничной фигуры из core/shapes", () => {
    for (const type of ["and", "or", "xor", "not"] as StampType[]) {
      const stamp = makeStamp(type);
      const base = shapeForRole(roleOf(colorOf(stamp)))!;
      let current = stamp;
      for (let rot = 0; rot < 4; rot++) {
        expect(mask(current)).toEqual(rotated(base, rot));
        current = rotateStamp(current);
      }
      // четыре поворота возвращают исходную фигуру
      expect(mask(current)).toEqual(mask(stamp));
    }
  });

  it("крест NOT симметричен: поворот не меняет картинку", () => {
    const not = makeStamp("not");
    expect(mask(rotateStamp(not))).toEqual(mask(not));
  });
});

// Отростки 2-входной фигуры в базовой ориентации (0°): два западных входа и
// один восточный выход.
const IN_ARMS: [number, number][] = [
  [0, 0],
  [0, 2],
];
const OUT_ARM: [number, number] = [2, 1];

type Side = "W" | "N" | "E" | "S";
const STEP: Record<Side, [number, number]> = { W: [-1, 0], N: [0, -1], E: [1, 0], S: [0, 1] };
const CW: Record<Side, Side> = { W: "N", N: "E", E: "S", S: "W" };

// Куда переезжают отросток и его сторона после `rot` поворотов по часовой стрелке.
function arm(x: number, y: number, side: Side, rot: number) {
  let cx = x;
  let cy = y;
  let s = side;
  for (let i = 0; i < rot; i++) {
    [cx, cy] = [2 - cy, cx];
    s = CW[s];
  }
  return { body: [cx, cy] as [number, number], wire: [cx + STEP[s][0], cy + STEP[s][1]] as [number, number] };
}

function place(stamp: StampState, grid: Grid2D, x0: number, y0: number): void {
  stamp.pixels.forEach((row, dy) => {
    row.forEach((v, dx) => {
      if (v > 0) setPixel(grid, x0 + dx, y0 + dy, v);
    });
  });
}

function wire(grid: Grid2D, x: number, y: number): void {
  setPixel(grid, x, y, WIRE_INDEX);
}

describe("stamps: гейт в любом повороте принимается парсером", () => {
  it.each(["and", "or", "xor"] as StampType[])("%s: 2 входа и 1 выход по отросткам", (type) => {
    for (let rot = 0; rot < 4; rot++) {
      let stamp = makeStamp(type);
      for (let i = 0; i < rot; i++) stamp = rotateStamp(stamp);

      const grid = createGrid2D(SIZE, SIZE);
      place(stamp, grid, 10, 10);
      const ins = IN_ARMS.map(([x, y]) => arm(x, y, "W", rot));
      const out = arm(OUT_ARM[0], OUT_ARM[1], "E", rot);
      for (const a of ins) wire(grid, 10 + a.wire[0], 10 + a.wire[1]);
      wire(grid, 10 + out.wire[0], 10 + out.wire[1]);

      const { ir, errors, netMap } = parse(grid);
      const net = (p: [number, number]) => netMap[(10 + p[1]) * SIZE + (10 + p[0])];
      expect(errors).toHaveLength(0);
      expect(ir.gates).toHaveLength(1);
      expect([...ir.gates[0].ins].sort()).toEqual(ins.map((a) => net(a.wire)).sort());
      expect(ir.gates[0].out).toBe(net(out.wire));
    }
  });

  // Крест симметричен относительно поворотов на 90°, поэтому картинка во всех
  // положениях одна и та же: ориентацию задаёт разводка, а при отсутствии
  // приведённых сетей — стороны света (запад = вход, восток = выход).
  it("not: крест с западным входом и восточным выходом в любом повороте", () => {
    const inArm = arm(0, 1, "W", 0);
    const outArm = arm(2, 1, "E", 0);
    for (let rot = 0; rot < 4; rot++) {
      let stamp = makeStamp("not");
      for (let i = 0; i < rot; i++) stamp = rotateStamp(stamp);

      const grid = createGrid2D(SIZE, SIZE);
      place(stamp, grid, 10, 10);
      wire(grid, 10 + inArm.wire[0], 10 + inArm.wire[1]);
      wire(grid, 10 + outArm.wire[0], 10 + outArm.wire[1]);

      const { ir, errors, netMap } = parse(grid);
      const net = (p: [number, number]) => netMap[(10 + p[1]) * SIZE + (10 + p[0])];
      expect(errors).toHaveLength(0);
      expect(ir.gates).toHaveLength(1);
      expect(ir.gates[0].ins).toEqual([net(inArm.wire)]);
      expect(ir.gates[0].out).toBe(net(outArm.wire));
    }
  });

  it("мостик (BRIDGE) остаётся перекрёстком без соединения", () => {
    const stamp = makeStamp("bridge");
    const grid = createGrid2D(SIZE, SIZE);
    place(stamp, grid, 10, 10);
    for (let x = 6; x <= 9; x++) wire(grid, x, 11); // западный рукав
    wire(grid, 12, 11);
    wire(grid, 13, 11); // восточный рукав
    for (let y = 7; y <= 10; y++) wire(grid, 11, y); // северный рукав
    const { ir, errors } = parse(grid);
    expect(errors).toHaveLength(0);
    expect(ir.netCount).toBe(2);
  });
});