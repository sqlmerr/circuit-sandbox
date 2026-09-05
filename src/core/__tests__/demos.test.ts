import { describe, it, expect } from "vitest";
import { parse } from "../parse";
import { createSim, step } from "../sim";
import { ringNot } from "../../demos/ringNot";
import { halfAdder } from "../../demos/halfAdder";
import { rsLatch } from "../../demos/rsLatch";
import { dFlipFlop } from "../../demos/dFlipFlop";
import { counter4 } from "../../demos/counter4";

describe("demos: parse clean", () => {
  it("ringNot parses without errors", () => {
    const { errors } = parse(ringNot());
    expect(errors).toHaveLength(0);
  });
  it("halfAdder parses without errors", () => {
    const { errors } = parse(halfAdder());
    expect(errors).toHaveLength(0);
  });
  it("rsLatch parses without errors", () => {
    const { errors } = parse(rsLatch());
    expect(errors).toHaveLength(0);
  });
  it("dFlipFlop parses without errors", () => {
    const { errors } = parse(dFlipFlop());
    expect(errors).toHaveLength(0);
  });
  it("counter parses without errors", () => {
    const { errors } = parse(counter4());
    expect(errors).toHaveLength(0);
  });
});

describe("demos: ringNot oscillates", () => {
  it("net0 alternates every tick (period 2)", () => {
    const { ir } = parse(ringNot());
    const s = createSim(ir);
    const trace: number[] = [];
    for (let t = 0; t < 8; t++) {
      step(s);
      trace.push(s.cur[0]);
    }
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBe(trace[i - 1] === 1 ? 0 : 1);
    }
  });
});

describe("demos: halfAdder truth table", () => {
  it.each([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [1, 0, 1, 0],
    [1, 1, 0, 1],
  ])("A=%i B=%i -> sum=%i carry=%i", (a, b, sum, carry) => {
    const { ir } = parse(halfAdder());
    for (const c of ir.consts) {
      if (c.net === 0) c.value = a as 0 | 1;
      if (c.net === 1) c.value = b as 0 | 1;
    }
    const s = createSim(ir);
    for (let t = 0; t < 4; t++) step(s);
    expect(s.cur[2]).toBe(sum);
    expect(s.cur[3]).toBe(carry);
  });
});

describe("demos: rsLatch set/reset/hold", () => {
  it("sets, holds, resets, holds", () => {
    const { ir } = parse(rsLatch());
    const setInputs = (sv: 0 | 1, rv: 0 | 1) => {
      for (const c of ir.consts) {
        if (c.net === 0) c.value = sv;
        if (c.net === 1) c.value = rv;
      }
    };
    const s = createSim(ir);
    const readQ = () => {
      for (let t = 0; t < 8; t++) step(s);
      return s.cur[2];
    };
    setInputs(1, 0);
    expect(readQ()).toBe(1); // set
    setInputs(0, 0);
    expect(readQ()).toBe(1); // hold 1
    setInputs(0, 1);
    expect(readQ()).toBe(0); // reset
    setInputs(0, 0);
    expect(readQ()).toBe(0); // hold 0
  });
});

describe("demos: dFlipFlop captures", () => {
  it("Q becomes 1 on clock and holds (D held high)", () => {
    const { ir } = parse(dFlipFlop());
    const s = createSim(ir);
    const q: number[] = [];
    for (let t = 0; t < 12; t++) {
      step(s);
      q.push(s.cur[2]);
    }
    expect(q[q.length - 1]).toBe(1);
    expect(q.slice(-4).every((v) => v === 1)).toBe(true);
  });
});

describe("demos: counter counts 0..7", () => {
  it("visits all values 0..7", () => {
    const { ir } = parse(counter4());
    const s = createSim(ir);
    const seen = new Set<number>();
    for (let t = 0; t < 64; t++) {
      step(s);
      const v = (s.cur[5] << 2) | (s.cur[3] << 1) | s.cur[1];
      seen.add(v);
    }
    for (let v = 0; v < 8; v++) {
      expect(seen.has(v)).toBe(true);
    }
  });
});
