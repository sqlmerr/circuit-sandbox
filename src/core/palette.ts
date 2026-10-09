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
  | "bulb"
  | "pin-out";

export const WIRE_INDEX = 2;
export const FIRST_DRAWABLE = WIRE_INDEX;
export const LAST_DRAWABLE = 10;

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
  { idx: 2, hex: "#808080", role: "wire", value: "провод", rgb: [0x80, 0x80, 0x80] },
  { idx: 3, hex: "#FF0000", role: "and", value: "тело AND-гейта", rgb: [0xff, 0x00, 0x00] },
  { idx: 4, hex: "#00FF00", role: "or", value: "тело OR-гейта", rgb: [0x00, 0xff, 0x00] },
  { idx: 5, hex: "#0000FF", role: "xor", value: "тело XOR-гейта", rgb: [0x00, 0x00, 0xff] },
  { idx: 6, hex: "#FFFF00", role: "not", value: "тело NOT-гейта", rgb: [0xff, 0xff, 0x00] },
  { idx: 7, hex: "#FF00FF", role: "clock", value: "тело тактового генератора", rgb: [0xff, 0x00, 0xff] },
  { idx: 8, hex: "#00FFFF", role: "high", value: "константная единица", rgb: [0x00, 0xff, 0xff] },
  { idx: 9, hex: "#FF8800", role: "bulb", value: "лампочка", rgb: [0xff, 0x88, 0x00] },
  { idx: 10, hex: "#FF69B4", role: "pin-out", value: "маркер выхода (повёрнутые схемы)", rgb: [0xff, 0x69, 0xb4] },
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

// Миграция палитры v2 → текущая (удалён DFF, LOW заменён лампочкой):
//  - старый индекс 10 (DFF) становится unknown (1) и подсвечивается ошибкой;
//  - старый индекс 11 (bulb) переносится на 9 (текущий индекс лампочки).
export function migrateV2Index(idx: number): number {
  if (idx === 10) return 1;
  if (idx === 11) return 9;
  return idx;
}

export function migrateV2(data: Uint8Array): Uint8Array {
  const out = data.slice();
  for (let i = 0; i < out.length; i++) out[i] = migrateV2Index(out[i]);
  return out;
}
