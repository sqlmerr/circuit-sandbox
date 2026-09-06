import { encodePNG, gridFromRGBA } from "../core/png";
import { toSvg } from "../core/svg";
import { createGrid2D, type Grid2D } from "../core/types";
import { migrateV2 } from "../core/palette";

export const SIZE_MIN = 16;
export const SIZE_MAX = 512;
export const SIZE_DEFAULT = 128;

// v3: DFF удалён из палитры (бывший индекс 10 → unknown, бывший 11 → 10).
const LS_KEY = "pixel-logic-grid-v3";
const LS_KEY_V2 = "pixel-logic-grid-v2";

export function saveToLocal(grid: Grid2D): void {
  try {
    localStorage.setItem(LS_KEY, encodeBase64(grid.data));
    localStorage.removeItem(LS_KEY_V2);
  } catch {
    /* ignore */
  }
}

export function loadFromLocal(): Grid2D | null {
  // старый v2-массив мигрируем в v3 (индексы 10→1, 11→10) и пересохраняем
  const g = readLocal(LS_KEY) ?? migrateLocalV2();
  if (g) saveToLocal(g);
  return g;
}

function readLocal(key: string): Grid2D | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const bytes = decodeBase64(raw);
    const g = createGrid2D(SIZE_DEFAULT, SIZE_DEFAULT);
    const n = Math.min(bytes.length, g.width * g.height);
    g.data.set(bytes.subarray(0, n));
    return g;
  } catch {
    return null;
  }
}

function migrateLocalV2(): Grid2D | null {
  const raw = localStorage.getItem(LS_KEY_V2);
  if (!raw) return null;
  const g = readLocal(LS_KEY_V2);
  if (!g) return null;
  g.data = migrateV2(g.data);
  return g;
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_KEY_V2);
  } catch {
    /* ignore */
  }
}

export function downloadPNG(grid: Grid2D, title = "circuit"): void {
  const bytes = encodePNG(grid, { format: "pixel-logic", version: "3", title });
  const buf = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buf], { type: "image/png" });
  downloadBlob(blob, `${title}.png`);
}

export function downloadJSON(grid: Grid2D): void {
  const payload = {
    format: "pixel-logic",
    version: 3 as const,
    width: grid.width,
    height: grid.height,
    pixels: encodeBase64(grid.data),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, "circuit.json");
}

export function downloadSVG(grid: Grid2D): void {
  const blob = new Blob([toSvg(grid)], { type: "image/svg+xml" });
  downloadBlob(blob, "circuit.svg");
}

export async function openFile(file: File): Promise<Grid2D> {
  if (file.name.toLowerCase().endsWith(".json")) {
    const text = await file.text();
    const parsed = JSON.parse(text) as {
      format?: string;
      version?: number;
      width?: number;
      height?: number;
      pixels?: string;
    };
    if (parsed.version !== 2 && parsed.version !== 3) {
      throw new Error("Несовместимый формат: нужен pixel-logic v3 (номера цветов изменились)");
    }
    if (!parsed.pixels) throw new Error("Некорректный JSON");
    let bytes = decodeBase64(parsed.pixels);
    if (parsed.version === 2) bytes = migrateV2(bytes); // 10→unknown, 11→bulb(10)
    const w = clamp(parsed.width ?? SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
    const h = clamp(parsed.height ?? SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
    const g = createGrid2D(w, h);
    g.data.set(bytes.subarray(0, w * h));
    return g;
  }
  // PNG: decode via browser image path
  return await decodeImageFile(file);
}

async function decodeImageFile(file: File): Promise<Grid2D> {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imgData = ctx.getImageData(0, 0, width, height);
  return gridFromRGBA(imgData.data, width, height);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
