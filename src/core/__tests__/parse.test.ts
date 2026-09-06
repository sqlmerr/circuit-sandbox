import { describe, it, expect } from "vitest";
import { parse } from "../parse";
import { createSim, step } from "../sim";
import { makeGrid, rect, wire, hWire } from "./helpers";

const AND = 3;
const OR = 4;
const XOR = 5;
const NOT = 6;
const CLOCK = 7;
const HIGH = 8;
const LOW = 9;
const BULB = 10;
const PIN_OUT = 11;

describe("parse: components", () => {
  it("recognizes an AND gate with two west inputs and one east output", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    wire(g, 4, 5); // west input top
    wire(g, 4, 7); // west input bottom (gap at (4,6): разные сети)
    wire(g, 9, 6); // east output
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("and");
    expect(ir.gates[0].ins).toEqual([0, 2]);
    expect(ir.gates[0].out).toBe(1);
  });

  it("recognizes OR and XOR gates", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, OR, 4, 3);
    wire(g, 1, 2);
    wire(g, 1, 4); // gap at (1,3)
    wire(g, 6, 2);
    rect(g, 12, 2, XOR, 4, 3);
    wire(g, 11, 2);
    wire(g, 11, 4); // gap at (11,3)
    wire(g, 16, 2);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates.map((x) => x.type).sort()).toEqual(["or", "xor"]);
    expect(ir.gates[0].type).toBe("or");
    expect(ir.gates[0].ins).toHaveLength(2);
  });

  it("recognizes a NOT gate (1 input, 1 output)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, NOT, 3, 2);
    wire(g, 4, 5);
    wire(g, 8, 5);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("not");
    expect(ir.gates[0].ins).toEqual([0]);
    expect(ir.gates[0].out).toBe(1);
  });

  it("recognizes a clock (fixed 10/10 toggle)", () => {
    const g = makeGrid(30, 20);
    rect(g, 5, 5, CLOCK, 3, 3);
    wire(g, 8, 5); // east output
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.clocks).toHaveLength(1);
    expect(ir.clocks[0].net).toBe(0);
  });

  it("recognizes HIGH and LOW consts", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, HIGH, 3, 3);
    wire(g, 5, 3); // east mid output
    rect(g, 12, 2, LOW, 3, 3);
    wire(g, 15, 3);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.consts).toHaveLength(2);
    const high = ir.consts.find((c) => c.value === 1)!;
    const low = ir.consts.find((c) => c.value === 0)!;
    expect(high.net).toBe(0);
    expect(low.net).toBe(1);
  });

  it("recognizes a bulb (1 input any side)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, BULB, 3, 3);
    wire(g, 4, 6); // west input
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.bulbs).toHaveLength(1);
    expect(ir.bulbs[0].net).toBe(0);
  });
});

describe("parse: connectivity (net = connected area)", () => {
  it("two disjoint wires of the same color are different nets", () => {
    const g = makeGrid(10, 10);
    wire(g, 1, 1);
    wire(g, 5, 1); // separated by one gap
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.netCount).toBe(2);
  });

  it("a T-junction is a single net", () => {
    const g = makeGrid(10, 10);
    hWire(g, 3, 5, 3);
    wire(g, 4, 4); // T below (4,3)
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.netCount).toBe(1);
  });

  it("a plus crossing splits H and V into two nets", () => {
    const g = makeGrid(10, 10);
    // horizontal through (2..5,4); vertical through (3,2..3) and (3,5..6)
    hWire(g, 2, 5, 4);
    wire(g, 3, 2);
    wire(g, 3, 3);
    wire(g, 3, 5);
    wire(g, 3, 6);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.netCount).toBe(2);
    // примыкание с севера/юга к перекрёстку попадает в вертикальную сеть
    // (см. collectPins: N/S через netMapV)
  });

  it("a bridge (plus without center) connects W↔E and N↔S as two separate nets", () => {
    const g = makeGrid(10, 10);
    // мост: центр (4,4) пустой, рукава — 4 провода по сторонам
    wire(g, 3, 4); // W
    wire(g, 5, 4); // E
    wire(g, 4, 3); // N
    wire(g, 4, 5); // S
    // продолжения рукавов: горизонталь тянется на запад и восток,
    // вертикаль — на север и юг (их нужно растянуть, чтобы отделить сети)
    hWire(g, 1, 2, 4); // запад продолжение
    wire(g, 6, 4);     // восток продолжение
    wire(g, 4, 1);
    wire(g, 4, 2);
    wire(g, 4, 6);
    const { ir, errors, netMap } = parse(g);
    expect(errors).toHaveLength(0);
    // две сквозные сети: H (W-E) и V (N-S)
    expect(ir.netCount).toBe(2);
    expect(netMap[4 * 10 + 3]).toBeGreaterThanOrEqual(0); // W-рукав — провод, netMap есть
    const west = netMap[4 * 10 + 3];
    expect(netMap[4 * 10 + 5]).toBe(west);      // E-рукав с тем же H
    expect(netMap[3 * 10 + 4]).not.toBe(west);  // N-рукав — другая сеть (V)
    expect(netMap[5 * 10 + 4]).toBe(netMap[3 * 10 + 4]); // S-рукав с тем же V
  });
});

describe("parse: errors", () => {
  it("reports ERR_UNKNOWN_PIXEL", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 3, 3, 1);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_UNKNOWN_PIXEL")).toBe(true);
  });

  it("reports ERR_UNKNOWN_PIXEL for an out-of-range index (indexes beyond the palette)", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 1, 1, 12); // индекс вне палитры v3
    setPixelU(g, 2, 2, 99);
    const { errors } = parse(g);
    const unk = errors.find((e) => e.code === "ERR_UNKNOWN_PIXEL");
    expect(unk).toBeTruthy();
    expect(unk!.cells).toHaveLength(2);
  });

  it("reports ERR_BODY_NOT_RECT for an L-shaped body", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 1, 1, AND);
    setPixelU(g, 2, 1, AND);
    setPixelU(g, 2, 2, AND);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_BODY_NOT_RECT")).toBe(true);
  });

  it("reports ERR_BODY_SIZE for a too-small body", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 2, 2, AND);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_BODY_SIZE")).toBe(true);
  });

  it("reports ERR_PINS_MISMATCH for an AND with one input", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    wire(g, 4, 5);
    wire(g, 9, 5);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PINS_MISMATCH")).toBe(true);
  });

  it("accepts multiple drivers on the same net (no ERR_MULTI_DRIVER)", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, HIGH, 3, 3);
    rect(g, 12, 2, HIGH, 3, 3);
    // общая сеть: от первого HIGH вниз-вправо-вверх ко второму
    for (let y = 2; y <= 6; y++) wire(g, 5, y);
    for (let y = 2; y <= 6; y++) wire(g, 15, y);
    for (let x = 5; x <= 15; x++) wire(g, x, 6);
    const { errors, ir } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.consts).toHaveLength(2); // оба источника распознаны
  });

  it("reports ERR_SOURCE_TWO_NETS for a HIGH touching two nets", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, HIGH, 3, 3);
    wire(g, 8, 5); // east
    wire(g, 7, 8); // south
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_SOURCE_TWO_NETS")).toBe(true);
  });

  it("accepts a small 2x2 clock", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, CLOCK, 2, 2);
    wire(g, 7, 5);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.clocks).toHaveLength(1);
  });
});

describe("parse: warnings", () => {
  it("reports WARN_NO_DRIVER for an input net without a driver", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    wire(g, 4, 5);
    wire(g, 4, 7); // gap at (4,6)
    wire(g, 9, 6);
    const { warnings, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(warnings.some((w) => w.code === "WARN_NO_DRIVER")).toBe(true);
  });

  it("reports WARN_IDLE_NET for a bare wire", () => {
    const g = makeGrid(10, 10);
    wire(g, 2, 2);
    const { warnings } = parse(g);
    expect(warnings.some((w) => w.code === "WARN_IDLE_NET")).toBe(true);
  });
});

describe("parse: pin-out marker (rotated structures)", () => {
  it("an AND with an E-marker output and N+S inputs (legacy would break)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1); // маркер справа
    wire(g, 10, 6); // выход из маркера
    wire(g, 7, 4); // вход сверху
    wire(g, 5, 8); // вход снизу
    const { ir, errors, warnings } = parse(g);
    expect(errors).toHaveLength(0);
    // входы без драйверов — ожидаемые предупреждения, не ошибки
    expect(warnings.every((w) => w.code === "WARN_NO_DRIVER")).toBe(true);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("and");
    expect(ir.gates[0].out).toBe(1); // сеть провода (10,6) = маркер
    // входы — прямые пины, отсортированы по (y, x)
    expect(ir.gates[0].ins).toEqual([0, 2]);
  });

  it("a NOT with a W-marker output and S input", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, NOT, 3, 2);
    rect(g, 4, 5, PIN_OUT, 1, 1); // маркер слева
    wire(g, 3, 5);
    wire(g, 6, 7); // вход снизу
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("not");
    expect(ir.gates[0].out).toBe(0); // сеть провода (3,5) = маркер
    expect(ir.gates[0].ins).toEqual([1]); // вход (6,7)
  });

  it("a HIGH source with a marker output", () => {
    const g = makeGrid(20, 20);
    rect(g, 2, 2, HIGH, 3, 3);
    rect(g, 5, 3, PIN_OUT, 1, 1);
    wire(g, 6, 3);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.consts).toHaveLength(1);
    expect(ir.consts[0].value).toBe(1);
    expect(ir.consts[0].net).toBe(0);
  });

  it("a rotated AND with marker drives the output net (simulation integration)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1);
    wire(g, 10, 6); // выход из маркера
    wire(g, 7, 4); // вход сверху
    wire(g, 5, 8); // вход снизу
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.netCount).toBe(3);
    const inA = ir.gates[0].ins[0];
    const out = ir.gates[0].out;
    const inB = ir.gates[0].ins[1];
    const s = createSim(ir);
    const drive = (a: number, b: number) => {
      s.cur[inA] = a;
      s.cur[inB] = b;
      step(s);
    };
    drive(0, 0);
    expect(s.cur[out]).toBe(0);
    drive(1, 0);
    expect(s.cur[out]).toBe(0);
    drive(0, 1);
    expect(s.cur[out]).toBe(0);
    drive(1, 1);
    expect(s.cur[out]).toBe(1);
  });

  it("reports ERR_PORT for a marker cluster of several cells", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 3, 3, PIN_OUT);
    setPixelU(g, 4, 3, PIN_OUT);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("reports ERR_PORT for a marker between two bodies", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 10, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("reports ERR_PORT for a marker touching two nets", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1);
    wire(g, 9, 5);
    wire(g, 9, 7);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("reports ERR_PORT for a second marker on the same body", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1);
    wire(g, 10, 6);
    rect(g, 4, 6, PIN_OUT, 1, 1);
    wire(g, 3, 6);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("reports ERR_PORT for a marker on a bulb", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, BULB, 3, 3);
    rect(g, 8, 6, PIN_OUT, 1, 1);
    wire(g, 9, 6);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("reports ERR_PORT when the marker net also touches the body directly", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, NOT, 3, 2);
    rect(g, 4, 5, PIN_OUT, 1, 1);
    wire(g, 3, 5);
    wire(g, 3, 6);
    wire(g, 3, 7);
    wire(g, 4, 7);
    wire(g, 5, 7);
    wire(g, 6, 7); // та же сеть касается юга тела
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(true);
  });

  it("warns WARN_PORT_INCOMPLETE for a marker without a body", () => {
    const g = makeGrid(10, 10);
    rect(g, 3, 3, PIN_OUT, 1, 1);
    wire(g, 4, 3);
    const { warnings, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(warnings.some((w) => w.code === "WARN_PORT_INCOMPLETE")).toBe(true);
  });

  it("warns WARN_PORT_INCOMPLETE for a marker without a wire (body falls back to legacy)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    rect(g, 9, 6, PIN_OUT, 1, 1);
    const { warnings, errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PORT")).toBe(false);
    expect(warnings.some((w) => w.code === "WARN_PORT_INCOMPLETE")).toBe(true);
    // legacy-обработка тела (без пинов) уже даёт ошибку пинов — не маркерную
  });
});

function setPixelU(g: ReturnType<typeof makeGrid>, x: number, y: number, v: number) {
  const { width } = g;
  g.data[y * width + x] = v;
}