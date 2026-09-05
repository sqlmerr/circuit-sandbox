import { describe, it, expect } from "vitest";
import { quantize, roleOf, toRgb } from "../palette";

describe("palette", () => {
  it("quantizes an exact color to its index", () => {
    expect(quantize(255, 0, 0)).toBe(2); // red wire, net 0
    expect(quantize(0, 255, 0)).toBe(3); // green wire, net 1
    expect(quantize(0, 100, 0)).toBe(10); // AND
  });

  it("is tolerant to compression artifacts within threshold", () => {
    const [r, g, b] = toRgb(2);
    expect(quantize(r + 2, g - 2, b + 1)).toBe(2);
  });

  it("maps a far color to unknown", () => {
    expect(quantize(200, 200, 200)).toBe(1);
    // distance well under QUANT_THRESHOLD for empty (white) is not far
  });

  it("roleOf returns correct roles", () => {
    expect(roleOf(0)).toBe("empty");
    expect(roleOf(1)).toBe("unknown");
    expect(roleOf(2)).toBe("wire");
    expect(roleOf(10)).toBe("and");
    expect(roleOf(17)).toBe("dff");
    expect(roleOf(18)).toBe("bulb");
  });
});
