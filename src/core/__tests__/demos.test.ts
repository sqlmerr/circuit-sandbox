import { describe, it, expect } from "vitest";
import { parse } from "../parse";
import { createSim, step } from "../sim";
import { ringNot } from "../../demos/ringNot";
import { halfAdder } from "../../demos/halfAdder";
import { rsLatch } from "../../demos/rsLatch";

// Все демо тестируются СТРУКТУРНО: номера сетей присваиваются порядком
// сканирования, поэтому читаем их через ir (bulbs/consts/gates),
// а не хардкодим.

describe("demos: parse clean", () => {
  it("ringNot parses without errors", () => {
    const { errors, warnings } = parse(ringNot());
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
  it("halfAdder parses without errors", () => {
    const { errors, warnings } = parse(halfAdder());
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
  it("rsLatch parses without errors", () => {
    const { errors, warnings } = parse(rsLatch());
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("demos: ringNot oscillates", () => {
  it("the bulb net alternates every tick (period 2)", () => {
    const { ir } = parse(ringNot());
    expect(ir.bulbs).toHaveLength(1);
    const s = createSim(ir);
    const bulbNet = ir.bulbs[0].net;
    const trace: number[] = [];
    for (let t = 0; t < 8; t++) {
      step(s);
      trace.push(s.cur[bulbNet]);
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
    // consts в порядке сканирования: HIGH_A (y2) первым, HIGH_B (y8) вторым
    expect(ir.consts).toHaveLength(2);
    ir.consts[0].value = a as 0 | 1;
    ir.consts[1].value = b as 0 | 1;
    // bulbs: S (y2) первым, C (y8) вторым
    expect(ir.bulbs).toHaveLength(2);
    const s = createSim(ir);
    for (let t = 0; t < 4; t++) step(s);
    expect(s.cur[ir.bulbs[0].net]).toBe(sum);
    expect(s.cur[ir.bulbs[1].net]).toBe(carry);
  });
});

describe("demos: rsLatch set/reset/hold", () => {
  it("sets, holds, resets, holds", () => {
    const { ir } = parse(rsLatch());
    // consts: R_HIGH (y9) первым, S_HIGH (y13) вторым
    expect(ir.consts).toHaveLength(2);
    expect(ir.bulbs).toHaveLength(1);
    const qNet = ir.bulbs[0].net;
    const S = ir.consts[1];
    const R = ir.consts[0];
    const setInputs = (sv: 0 | 1, rv: 0 | 1) => {
      S.value = sv;
      R.value = rv;
    };
    const s = createSim(ir);
    const readQ = () => {
      for (let t = 0; t < 8; t++) step(s);
      return s.cur[qNet];
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