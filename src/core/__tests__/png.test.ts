import { describe, it, expect } from "vitest";
import { encodePNG, decodePNG, gridFromRGBA } from "../png";
import { createGrid2D, setPixel } from "../types";
import { migrateV2Index } from "../palette";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function bytesToString(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe("png", () => {
  it("roundtrips a grid through encode/decode with identical indices", () => {
    const g = createGrid2D(20, 12);
    // scatter some colors (v3 palette indices)
    setPixel(g, 1, 1, 2); // wire
    setPixel(g, 3, 2, 3); // and
    setPixel(g, 5, 4, 10); // bulb
    setPixel(g, 0, 0, 0);
    const bytes = encodePNG(g, { format: "pixel-logic", version: "3", title: "test" });
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
    const bytes = encodePNG(g, { format: "pixel-logic", version: "3", title: "Моя схема" });
    const s = bytesToString(bytes);
    expect(s).toContain("tEXt");
    expect(s).toContain("pixel-logic");
    expect(s).toContain("version");
  });

  it("quantizes RGBA back to palette indices", () => {
    // a fully green pixel should become OR body (idx 4)
    const rgba = new Uint8ClampedArray([0, 255, 0, 255]);
    expect(gridFromRGBA(rgba, 1, 1).data[0]).toBe(4);
  });

  it("the removed DFF color decodes to unknown (idx 1)", () => {
    // старый DFF в v2 был #8800FF — теперь вне палитры
    const rgba = new Uint8ClampedArray([0x88, 0, 0xff, 255]);
    expect(migrateV2Index(gridFromRGBA(rgba, 1, 1).data[0])).toBe(1);
  });
});