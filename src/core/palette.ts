export const QUANT_THRESHOLD = 50;

export type Role =
  | "empty"
  | "unknown"
  | "wire"
  | "and"
  | "or"
  | "xor"
  | "not"
  | "clock"
  | "high"
  | "low"
  | "dff"
  | "bulb";

export const WIRE_COUNT = 8;

export interface PaletteEntry {
  idx: number;
  hex: string;
  role: Role;
  value: string;
  rgb: [number, number, number];
}

const ENTRIES: PaletteEntry[] = [
  { idx: 0, hex: "#FFFFFF", role: "empty", value: "пусто", rgb: [0xff, 0xff, 0xff] },
  { idx: 1, hex: "#000000", role: "unknown", value: "ошибка «неизвестный пиксель»", rgb: [0x00, 0x00, 0x00] },
  { idx: 2, hex: "#FF0000", role: "wire", value: "сеть 0 «красная»", rgb: [0xff, 0x00, 0x00] },
  { idx: 3, hex: "#00FF00", role: "wire", value: "сеть 1 «зелёная»", rgb: [0x00, 0xff, 0x00] },
  { idx: 4, hex: "#0000FF", role: "wire", value: "сеть 2 «синяя»", rgb: [0x00, 0x00, 0xff] },
  { idx: 5, hex: "#FFFF00", role: "wire", value: "сеть 3 «жёлтая»", rgb: [0xff, 0xff, 0x00] },
  { idx: 6, hex: "#FF00FF", role: "wire", value: "сеть 4 «розовая»", rgb: [0xff, 0x00, 0xff] },
  { idx: 7, hex: "#00FFFF", role: "wire", value: "сеть 5 «голубая»", rgb: [0x00, 0xff, 0xff] },
  { idx: 8, hex: "#FF8800", role: "wire", value: "сеть 6 «оранжевая»", rgb: [0xff, 0x88, 0x00] },
  { idx: 9, hex: "#8800FF", role: "wire", value: "сеть 7 «фиолетовая»", rgb: [0x88, 0x00, 0xff] },
  { idx: 10, hex: "#006400", role: "and", value: "тело AND-гейта", rgb: [0x00, 0x64, 0x00] },
  { idx: 11, hex: "#00008B", role: "or", value: "тело OR-гейта", rgb: [0x00, 0x00, 0x8b] },
  { idx: 12, hex: "#8B008B", role: "xor", value: "тело XOR-гейта", rgb: [0x8b, 0x00, 0x8b] },
  { idx: 13, hex: "#8B0000", role: "not", value: "тело NOT-гейта", rgb: [0x8b, 0x00, 0x00] },
  { idx: 14, hex: "#808000", role: "clock", value: "тело тактового генератора", rgb: [0x80, 0x80, 0x00] },
  { idx: 15, hex: "#008B8B", role: "high", value: "константная единица", rgb: [0x00, 0x8b, 0x8b] },
  { idx: 16, hex: "#404040", role: "low", value: "константный ноль", rgb: [0x40, 0x40, 0x40] },
  { idx: 17, hex: "#708090", role: "dff", value: "тело D-триггера", rgb: [0x70, 0x80, 0x90] },
  { idx: 18, hex: "#A0522D", role: "bulb", value: "лампочка", rgb: [0xa0, 0x52, 0x2d] },
];

const UNKNOWN_ENTRY: PaletteEntry = ENTRIES[1];

export const PALETTE: readonly PaletteEntry[] = ENTRIES;

export function toHex(idx: number): string {
  return ENTRIES[idx]?.hex ?? "#000000";
}

export function toRgb(idx: number): [number, number, number] {
  return ENTRIES[idx]?.rgb ?? [0, 0, 0];
}

export function roleOf(idx: number): Role {
  return ENTRIES[idx]?.role ?? "unknown";
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function rgbOf(idx: number): [number, number, number] {
  return toRgb(idx);
}

export function quantize(r: number, g: number, b: number): number {
  let best = ENTRIES[0];
  let bestDist = Infinity;
  const c: [number, number, number] = [r, g, b];
  for (const e of ENTRIES) {
    if (e.role === "unknown") continue;
    const d = distance(c, e.rgb);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return bestDist > QUANT_THRESHOLD ? UNKNOWN_ENTRY.idx : best.idx;
}
