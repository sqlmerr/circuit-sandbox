import { describe, it, expect } from "vitest";
import { gridFromJSON, openFile, SIZE_MIN, SIZE_MAX } from "../fileio";

const W = SIZE_MIN;
const H = SIZE_MIN;

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

function v3(bytes: number[], width: number = W, height: number = H): string {
  return JSON.stringify({
    format: "pixel-logic",
    version: 3,
    width,
    height,
    pixels: b64(bytes),
  });
}

function fullRow(count: number, value = 0): number[] {
  return new Array(count).fill(value);
}

describe("gridFromJSON (импорт схемы из JSON)", () => {
  it("v3: размеры и индексы пикселей сохраняются один в один", () => {
    const bytes = Array.from({ length: W * H }, (_, i) => i % 13); // 0..12 из палитры
    const g = gridFromJSON(v3(bytes));
    expect(g.width).toBe(W);
    expect(g.height).toBe(H);
    expect(Array.from(g.data)).toEqual(bytes);
  });

  it("v3: лишние пиксели обрезаются по заявленному размеру", () => {
    const bytes = fullRow(W * H + 40, 2);
    const g = gridFromJSON(v3(bytes));
    expect(g.data.length).toBe(W * H);
    expect(g.data.every((v) => v === 2)).toBe(true);
  });

  it("v2: бывший DFF (10) становится unknown, бывшая лампочка (11) — 9", () => {
    const bytes = fullRow(W * H, 10);
    bytes[0] = 11;
    const text = JSON.stringify({ version: 2, width: W, height: H, pixels: b64(bytes) });
    const g = gridFromJSON(text);
    expect(g.data[0]).toBe(9); // бывшая лампочка → bulb
    expect(g.data[1]).toBe(1); // бывший DFF → unknown
  });

  it("отклоняет размер вне 16..512 (не «зажимает» молча)", () => {
    expect(() => gridFromJSON(v3(fullRow(64), 1000, 64))).toThrow(/вне допустимого диапазона/);
    expect(() => gridFromJSON(v3(fullRow(64), 8, 64))).toThrow(/вне допустимого диапазона/);
    expect(() => gridFromJSON(v3(fullRow(64), 64, SIZE_MAX + 1))).toThrow(/вне допустимого диапазона/);
    expect(() => gridFromJSON(v3(fullRow(64), 16.5, 64))).toThrow(/вне допустимого диапазона/);
  });

  it("отклоняет нехватку пикселей относительно заявленного размера", () => {
    expect(() => gridFromJSON(v3(fullRow(10), 16, 16))).toThrow(/пикселей/);
  });

  it("отклоняет чужую версию формата", () => {
    const text = JSON.stringify({ version: 1, width: W, height: H, pixels: b64(fullRow(W * H)) });
    expect(() => gridFromJSON(text)).toThrow(/Несовместимый формат/);
  });

  it("отклоняет JSON без поля pixels", () => {
    expect(() => gridFromJSON(JSON.stringify({ version: 3, width: W, height: H }))).toThrow(
      /Некорректный JSON/,
    );
  });
});

describe("openFile (диспетчеризация по типу файла)", () => {
  it(".json уходит в gridFromJSON", async () => {
    const file = new File([v3(fullRow(W * H, 3))], "scheme.json", { type: "application/json" });
    const g = await openFile(file);
    expect(g.width).toBe(W);
    expect(g.data.every((v) => v === 3)).toBe(true);
  });

  it(".JSON в верхнем регистре тоже распознаётся", async () => {
    const file = new File([v3(fullRow(W * H, 4))], "SCHEME.JSON", { type: "application/json" });
    const g = await openFile(file);
    expect(g.height).toBe(H);
  });
});
