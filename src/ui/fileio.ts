import { encodePNG, gridFromRGBA } from "../core/png";
import { toSvg } from "../core/svg";
import { createGrid2D, type Grid2D } from "../core/types";

export const SIZE_MIN = 16;
export const SIZE_MAX = 512;
export const SIZE_DEFAULT = 128;

const LS_KEY = "pixel-logic-grid";

export function saveToLocal(grid: Grid2D): void {
  try {
    localStorage.setItem(LS_KEY, encodeBase64(grid.data));
  } catch {
    /* ignore */
  }
}

export function loadFromLocal(): Grid2D | null {
  const raw = localStorage.getItem(LS_KEY);
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

export function clearLocal(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function downloadPNG(grid: Grid2D, title = "circuit"): void {
  const bytes = encodePNG(grid, { format: "pixel-logic", version: "1", title });
  const buf = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buf], { type: "image/png" });
  downloadBlob(blob, `${title}.png`);
}

export function downloadJSON(grid: Grid2D): void {
  const payload = {
    format: "pixel-logic",
    version: 1 as const,
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
      width?: number;
      height?: number;
      pixels?: string;
    };
    if (!parsed.pixels) throw new Error("Некорректный JSON");
    const bytes = decodeBase64(parsed.pixels);
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
