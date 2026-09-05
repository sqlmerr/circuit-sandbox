import { describe, it, expect } from "vitest";
import { encodePNG, decodePNG, gridFromRGBA } from "../png";
import { createGrid2D, setPixel } from "../types";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function bytesToString(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe("png", () => {
  it("roundtrips a grid through encode/decode with identical indices", () => {
    const g = createGrid2D(20, 12);
    // scatter some colors
    setPixel(g, 1, 1, 2);
    setPixel(g, 3, 2, 10);
    setPixel(g, 5, 4, 17);
    setPixel(g, 8, 9, 18);
    setPixel(g, 0, 0, 0);
    const bytes = encodePNG(g, { format: "pixel-logic", version: "1", title: "test" });
    const decoded = decodePNG(bytes);
    expect(decoded.width).toBe(20);
    expect(decoded.height).toBe(12);
    expect(decoded.data).toEqual(g.data);
  });

  it("starts with a valid PNG signature", () => {
    const g = createGrid2D(4, 4);
    const bytes = encodePNG(g);
    for (let i = 0; i < SIG.length; i++) {
      expect(bytes[i]).toBe(SIG[i]);
    }
  });

  it("embeds tEXt metadata chunks", () => {
    const g = createGrid2D(4, 4);
    const bytes = encodePNG(g, { format: "pixel-logic", version: "1", title: "Моя схема" });
    const s = bytesToString(bytes);
    expect(s).toContain("tEXt");
    expect(s).toContain("pixel-logic");
    expect(s).toContain("version");
  });

  it("quantizes RGBA back to palette indices", () => {
    // a fully green pixel should become wire net 1 (idx 3)
    const rgba = new Uint8ClampedArray([0, 255, 0, 255]);
    expect(gridFromRGBA(rgba, 1, 1).data[0]).toBe(3);
  });
});
