import { describe, it, expect } from "vitest";
import { createSim, step, gateTruth } from "../sim";
import type { IR } from "../types";

function emptyIR(): IR {
  return { width: 20, height: 20, gates: [], clocks: [], consts: [], dffs: [], bulbs: [] };
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
  it("produces a 10/5 square wave over 16 ticks", () => {
    const ir = emptyIR();
    ir.clocks.push({ net: 0, period: 10, high: 5, cells: [] });
    const s = createSim(ir);
    const trace: number[] = [];
    for (let t = 0; t < 16; t++) {
      step(s);
      trace.push(s.cur[0]); // out(t)
    }
    // out(t) = (t mod 10) < 5 -> t=0..4 high, t=5..9 low
    expect(trace.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(trace.slice(5, 10)).toEqual([0, 0, 0, 0, 0]);
    expect(trace[10]).toBe(1);
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

describe("sim: dff", () => {
  it("captures D on the rising C edge and holds between edges", () => {
    const ir = emptyIR();
    ir.clocks.push({ net: 2, period: 4, high: 2, cells: [] }); // C: 1,1,0,0,1,1,...
    ir.consts.push({ net: 3, value: 1, cells: [] }); // D held high
    ir.dffs.push({ d: 3, c: 2, q: 4, cells: [] });
    const s = createSim(ir);
    const q: number[] = [];
    for (let t = 0; t < 10; t++) {
      step(s);
      q.push(s.cur[4]); // Q(t)
    }
    // First rising edge is at t=4 (C goes 0->1). Before that Q=0.
    expect(q.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(q[4]).toBe(1); // capture on rising edge
    expect(q.slice(5)).toEqual(q.slice(5).map(() => 1)); // holds
  });

  it("captures D=0 on the rising edge and holds", () => {
    const ir = emptyIR();
    ir.clocks.push({ net: 2, period: 4, high: 2, cells: [] });
    ir.consts.push({ net: 3, value: 0, cells: [] }); // D low
    ir.dffs.push({ d: 3, c: 2, q: 4, cells: [] });
    const s = createSim(ir);
    const q: number[] = [];
    for (let t = 0; t < 10; t++) {
      step(s);
      q.push(s.cur[4]); // Q(t)
    }
    expect(q[4]).toBe(0);
    expect(q.every((v) => v === 0)).toBe(true);
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
    ir.clocks.push({ net: 0, period: 4, high: 2, cells: [] });
    ir.gates.push({ type: "xor", ins: [0, 1], out: 2, cells: [] });
    ir.consts.push({ net: 1, value: 1, cells: [] });
    ir.dffs.push({ d: 2, c: 0, q: 3, cells: [] });

    const run = () => {
      const s = createSim(ir);
      const trace: number[] = [];
      for (let t = 0; t < 30; t++) {
        trace.push(s.cur[3]);
        step(s);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
