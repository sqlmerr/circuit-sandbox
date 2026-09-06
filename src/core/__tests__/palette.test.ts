import { describe, it, expect } from "vitest";
import { quantize, roleOf, toRgb, PALETTE, migrateV2Index, migrateV2 } from "../palette";

describe("palette", () => {
  it("quantizes an exact color to its index", () => {
    expect(quantize(255, 0, 0)).toBe(3); // and
    expect(quantize(0, 255, 0)).toBe(4); // or
    expect(quantize(0, 0, 255)).toBe(5); // xor
    expect(quantize(255, 255, 0)).toBe(6); // not
    expect(quantize(255, 0, 255)).toBe(7); // clock
    expect(quantize(0, 255, 255)).toBe(8); // high
    expect(quantize(255, 0x88, 0)).toBe(9); // low
    expect(quantize(0x80, 255, 0)).toBe(10); // bulb
    expect(quantize(0xff, 0x69, 0xb4)).toBe(11); // pin-out
    expect(quantize(0x80, 0x80, 0x80)).toBe(2); // wire
  });

  it("is tolerant to compression artifacts within threshold", () => {
    const [r, g, b] = toRgb(2);
    expect(quantize(r + 2, g - 2, b + 1)).toBe(2);
  });

  it("maps a far color to unknown", () => {
    expect(quantize(200, 200, 200)).toBe(1); // ближайший — white/empty (95 > 50)
  });

  it("the removed DFF color quantizes to unknown", () => {
    // #8800FF — бывший цвет DFF v2, теперь вне палитры (> 50 от всех цветов)
    expect(quantize(0x88, 0x00, 0xff)).toBe(1);
  });

  it("palette colors are far enough apart for stable quantization", () => {
    const dist = (a: [number, number, number], b: [number, number, number]) =>
      Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    let min = Infinity;
    const colors = PALETTE.filter((e) => e.role !== "unknown").map((e) => e.rgb);
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const d = dist(colors[i], colors[j]);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(110);
  });

  it("roleOf returns correct roles", () => {
    expect(roleOf(0)).toBe("empty");
    expect(roleOf(1)).toBe("unknown");
    expect(roleOf(2)).toBe("wire");
    expect(roleOf(3)).toBe("and");
    expect(roleOf(10)).toBe("bulb");
    expect(roleOf(11)).toBe("pin-out");
    expect(roleOf(99)).toBe("unknown");
  });
});

describe("palette: v2→v3 migration", () => {
  it("maps old DFF (10) to unknown and old bulb (11) to 10", () => {
    expect(migrateV2Index(0)).toBe(0);
    expect(migrateV2Index(2)).toBe(2);
    expect(migrateV2Index(9)).toBe(9);
    expect(migrateV2Index(10)).toBe(1); // бывший DFF
    expect(migrateV2Index(11)).toBe(10); // бывшая лампочка
  });

  it("migrates a full buffer", () => {
    const data = new Uint8Array([0, 2, 3, 10, 11, 9]);
    expect(Array.from(migrateV2(data))).toEqual([0, 2, 3, 1, 10, 9]);
  });
});