import { describe, it, expect } from "vitest";
import { parse } from "../parse";
import { createSim, step } from "../sim";
import { ringNot } from "../../demos/ringNot";
import { halfAdder } from "../../demos/halfAdder";
import { rsLatch } from "../../demos/rsLatch";
import { toggleMemory } from "../../demos/memory";
import { fourBitAdder } from "../../demos/fourBitAdder";
import { DEMOS } from "../../demos";

// Все демо тестируются СТРУКТУРНО: номера сетей присваиваются порядком
// сканирования, поэтому читаем их через ir (bulbs/consts/gates),
// а не хардкодим.

describe("demos: registry", () => {
  it("has unique ids and every demo builds a clean grid", () => {
    expect(DEMOS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const d of DEMOS) {
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      const { errors, warnings } = parse(d.build());
      expect(errors, `${d.id} errors`).toHaveLength(0);
      expect(warnings, `${d.id} warnings`).toHaveLength(0);
    }
  });

  it("build() returns a fresh grid each call", () => {
    for (const d of DEMOS) {
      const a = d.build();
      const before = d.build().data[0];
      a.data.fill(99);
      expect(d.build().data[0]).toBe(before);
    }
  });
});

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
  it("toggleMemory parses without errors", () => {
    const { errors, warnings } = parse(toggleMemory());
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
  it("fourBitAdder parses without errors", () => {
    const { ir, errors, warnings } = parse(fourBitAdder());
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    // 4 разряда × (XOR1, AND1, XOR2, AND2, OR) + 8 переключателей + 5 лампочек
    expect(ir.gates).toHaveLength(20);
    expect(ir.switches).toHaveLength(8);
    expect(ir.bulbs).toHaveLength(5);
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

describe("demos: toggleMemory (SWITCH -> T-FF -> BULB)", () => {
  it("each switch press toggles the stored bit", () => {
    const { ir, errors } = parse(toggleMemory());
    expect(errors).toHaveLength(0);
    expect(ir.switches).toHaveLength(1);
    expect(ir.memories).toHaveLength(1);
    expect(ir.bulbs).toHaveLength(1);
    const s = createSim(ir);
    const bulb = ir.bulbs[0].net;
    const press = () => {
      s.switches[0] = 1;
      step(s);
      step(s);
      s.switches[0] = 0;
      step(s);
    };
    press();
    expect(s.cur[bulb]).toBe(1);
    press();
    expect(s.cur[bulb]).toBe(0);
    press();
    expect(s.cur[bulb]).toBe(1);
  });
});

describe("demos: fourBitAdder truth table", () => {
  // Переключатели сгруппированы в два ряда: A0..A3 (строка y2) и B0..B3
  // (строка y11). Сканируются в порядке (y,x) — выравниваем по геометрии,
  // чтобы не хардкодить номера сетей.
  const swOrder = () => {
    const { ir } = parse(fourBitAdder());
    const idx = ir.switches
      .map((s, i) => ({ i, x: s.cells[0][0], y: s.cells[0][1] }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    // первые 4 — A0..A3, следующие 4 — B0..B3
    return {
      a: idx.slice(0, 4).map((e) => e.i),
      b: idx.slice(4).map((e) => e.i),
    };
  };
  // Лампочки: общий нижний ряд y56 — S0..S3 (левее) и перенос (правее всех).
  const bulbOrder = () => {
    const { ir } = parse(fourBitAdder());
    const sorted = ir.bulbs
      .map((b, i) => ({ i, x: b.cells[0][0], y: b.cells[0][1] }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    return { sums: sorted.slice(0, 4).map((e) => e.i), carry: sorted[4].i };
  };

  it("every A,B in 0..15 sums to S+carry", () => {
    const { ir } = parse(fourBitAdder());
    const sw = swOrder();
    const bulbs = bulbOrder();
    const s = createSim(ir);
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        for (let i = 0; i < 4; i++) {
          s.switches[sw.a[i]] = ((a >> i) & 1) as 0 | 1;
          s.switches[sw.b[i]] = ((b >> i) & 1) as 0 | 1;
        }
        for (let t = 0; t < 50; t++) step(s);
        const expected = a + b;
        for (let i = 0; i < 4; i++) {
          expect(s.cur[ir.bulbs[bulbs.sums[i]].net], `S${i} for A=${a} B=${b}`).toBe(
            (expected >> i) & 1,
          );
        }
        expect(s.cur[ir.bulbs[bulbs.carry].net], `carry for A=${a} B=${b}`).toBe(
          (expected >> 4) & 1,
        );
      }
    }
  });
});