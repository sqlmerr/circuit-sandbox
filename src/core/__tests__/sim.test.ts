import { describe, it, expect } from "vitest";
import { createSim, step, gateTruth } from "../sim";
import type { IR } from "../types";

function emptyIR(): IR {
  return {
    width: 20,
    height: 20,
    netCount: 8,
    gates: [],
    clocks: [],
    consts: [],
    bulbs: [],
  };
}

describe("sim: gates", () => {
  it("truth table AND with 1-tick delay", () => {
    const ir = emptyIR();
    ir.consts.push({ net: 0, value: 1, cells: [] });
    ir.consts.push({ net: 1, value: 1, cells: [] });
    ir.gates.push({ type: "and", ins: [0, 1], out: 2, cells: [] });
    const s = createSim(ir);
    expect(s.cur[2]).toBe(0); // t=0: no output yet
    step(s); // t=0 -> 1, gates read cur (0,0)
    expect(s.cur[2]).toBe(0);
    step(s); // now inputs set, gate sees them
    expect(s.cur[2]).toBe(1);
  });

  it("AND/OR/XOR/NOT work per formula", () => {
    expect(gateTruth("and", 1, 0)).toBe(0);
    expect(gateTruth("and", 1, 1)).toBe(1);
    expect(gateTruth("or", 0, 1)).toBe(1);
    expect(gateTruth("or", 0, 0)).toBe(0);
    expect(gateTruth("xor", 1, 1)).toBe(0);
    expect(gateTruth("xor", 1, 0)).toBe(1);
    expect(gateTruth("not", 1)).toBe(0);
    expect(gateTruth("not", 0)).toBe(1);
  });
});

describe("sim: clock", () => {
  it("produces a 10-off / 10-on square wave", () => {
    const ir = emptyIR();
    ir.clocks.push({ net: 0, cells: [] });
    const s = createSim(ir);
    const trace: number[] = [];
    for (let t = 0; t < 25; t++) {
      step(s);
      trace.push(s.cur[0]); // out(t)
    }
    expect(trace.slice(0, 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(trace.slice(10, 20)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(trace[20]).toBe(0);
    expect(trace[21]).toBe(0);
  });
});

describe("sim: net without driver is 0", () => {
  it("an undriven net reads 0", () => {
    const s = createSim(emptyIR());
    expect(s.cur[3]).toBe(0);
    step(s);
    expect(s.cur[3]).toBe(0);
  });
});

describe("sim: two NOT ring oscillates", () => {
  it("oscillates with period 2", () => {
    const ir = emptyIR();
    ir.gates.push({ type: "not", ins: [1], out: 0, cells: [] });
    ir.gates.push({ type: "not", ins: [0], out: 1, cells: [] });
    const s = createSim(ir);
    const net0: number[] = [];
    for (let i = 0; i < 12; i++) {
      net0.push(s.cur[0]);
      step(s);
    }
    // In any steady loop, net0 alternates every tick -> period 2
    for (let i = 2; i < net0.length; i++) {
      expect(net0[i]).toBe(net0[i - 2]);
    }
    expect(net0[0] !== net0[1]).toBe(true);
  });
});

describe("sim: determinism", () => {
  it("two runs of the same IR produce identical traces", () => {
    const ir = emptyIR();
    ir.clocks.push({ net: 0, cells: [] });
    ir.gates.push({ type: "xor", ins: [0, 1], out: 2, cells: [] });
    ir.consts.push({ net: 1, value: 1, cells: [] });
    ir.bulbs.push({ net: 2, cells: [] });

    const run = () => {
      const s = createSim(ir);
      const trace: number[] = [];
      for (let t = 0; t < 30; t++) {
        trace.push(s.cur[2]);
        step(s);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});