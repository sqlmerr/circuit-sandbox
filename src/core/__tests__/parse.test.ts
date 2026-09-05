import { describe, it, expect } from "vitest";
import { parse } from "../parse";
import { makeGrid, rect, wire } from "./helpers";

const AND = 10;
const OR = 11;
const XOR = 12;
const NOT = 13;
const CLOCK = 14;
const HIGH = 15;
const LOW = 16;
const DFF = 17;
const BULB = 18;

describe("parse: components", () => {
  it("recognizes an AND gate with two west inputs and one east output", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    wire(g, 4, 5, 0); // west input red (net 0)
    wire(g, 4, 6, 1); // west input green (net 1)
    wire(g, 9, 6, 2); // east output blue (net 2)
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("and");
    expect(ir.gates[0].ins).toEqual([0, 1]);
    expect(ir.gates[0].out).toBe(2);
  });

  it("recognizes OR and XOR gates", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, OR, 4, 3);
    wire(g, 1, 2, 0);
    wire(g, 1, 3, 1);
    wire(g, 6, 2, 2);
    rect(g, 12, 2, XOR, 4, 3);
    wire(g, 11, 2, 0);
    wire(g, 11, 3, 1);
    wire(g, 16, 2, 3);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates.map((x) => x.type).sort()).toEqual(["or", "xor"]);
  });

  it("recognizes a NOT gate (1 input, 1 output)", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, NOT, 3, 2);
    wire(g, 4, 5, 0);
    wire(g, 8, 5, 1);
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.gates).toHaveLength(1);
    expect(ir.gates[0].type).toBe("not");
    expect(ir.gates[0].ins).toEqual([0]);
    expect(ir.gates[0].out).toBe(1);
  });

  it("recognizes a valid clock with return-high previous (body period/high)", () => {
    const g = makeGrid(30, 20);
    rect(g, 5, 5, CLOCK, 10, 5); // period 10, high 5
    wire(g, 15, 5, 0); // east output
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.clocks).toHaveLength(1);
    expect(ir.clocks[0].net).toBe(0);
    expect(ir.clocks[0].period).toBe(10);
    expect(ir.clocks[0].high).toBe(5);
  });

  it("recognizes HIGH and LOW consts", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, HIGH, 3, 3);
    wire(g, 5, 3, 0); // east mid output
    rect(g, 12, 2, LOW, 3, 3);
    wire(g, 15, 3, 1);
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
    wire(g, 4, 6, 0); // west input
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.bulbs).toHaveLength(1);
    expect(ir.bulbs[0].net).toBe(0);
  });

  it("assigns D/C/Q roles to DFF by side order", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, DFF, 3, 3);
    wire(g, 4, 5, 0); // west top -> D (1st input)
    wire(g, 4, 6, 1); // west bottom -> C (2nd input)
    wire(g, 8, 6, 2); // east -> Q
    const { ir, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(ir.dffs).toHaveLength(1);
    expect(ir.dffs[0].d).toBe(0);
    expect(ir.dffs[0].c).toBe(1);
    expect(ir.dffs[0].q).toBe(2);
  });
});

describe("parse: errors", () => {
  it("reports ERR_UNKNOWN_PIXEL", () => {
    const g = makeGrid(10, 10);
    setPixelU(g, 3, 3, 1);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_UNKNOWN_PIXEL")).toBe(true);
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
    wire(g, 4, 5, 0);
    wire(g, 9, 5, 2);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_PINS_MISMATCH")).toBe(true);
  });

  it("reports ERR_MULTI_DRIVER for two HIGH on the same net", () => {
    const g = makeGrid(30, 20);
    rect(g, 2, 2, HIGH, 3, 3);
    wire(g, 5, 3, 0);
    rect(g, 12, 2, HIGH, 3, 3);
    wire(g, 15, 3, 0);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_MULTI_DRIVER")).toBe(true);
  });

  it("reports ERR_SOURCE_TWO_NETS for a HIGH touching two nets", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, HIGH, 3, 3);
    wire(g, 8, 5, 0); // east
    wire(g, 7, 8, 1); // south
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_SOURCE_TWO_NETS")).toBe(true);
  });

  it("reports ERR_CLOCK_SIZE when high >= period", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, CLOCK, 2, 2); // W=2, H=2 -> high(2) >= period(2)
    wire(g, 7, 5, 0);
    const { errors } = parse(g);
    expect(errors.some((e) => e.code === "ERR_CLOCK_SIZE")).toBe(true);
  });
});

describe("parse: warnings", () => {
  it("reports WARN_NO_DRIVER for an input net without a driver", () => {
    const g = makeGrid(20, 20);
    rect(g, 5, 5, AND, 4, 3);
    wire(g, 4, 5, 0);
    wire(g, 4, 6, 1);
    wire(g, 9, 6, 2);
    const { warnings, errors } = parse(g);
    expect(errors).toHaveLength(0);
    expect(warnings.some((w) => w.code === "WARN_NO_DRIVER")).toBe(true);
  });

  it("reports WARN_IDLE_NET for a bare wire", () => {
    const g = makeGrid(10, 10);
    wire(g, 2, 2, 0);
    const { warnings } = parse(g);
    expect(warnings.some((w) => w.code === "WARN_IDLE_NET")).toBe(true);
  });
});

function setPixelU(g: ReturnType<typeof makeGrid>, x: number, y: number, v: number) {
  const { width } = g;
  g.data[y * width + x] = v;
}
