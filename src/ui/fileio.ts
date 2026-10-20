import { encodePNG, gridFromRGBA } from "../core/png";
import { toSvg } from "../core/svg";
import { createGrid2D, type Grid2D } from "../core/types";
import { migrateV2 } from "../core/palette";

export const SIZE_MIN = 16;
export const SIZE_MAX = 512;
export const SIZE_DEFAULT = 128;

// v3: DFF удалён из палитры, LOW заменён лампочкой (бывший 10 → unknown, 11 → bulb(9)).
const LS_KEY = "pixel-logic-grid-v3";
const LS_KEY_V2 = "pixel-logic-grid-v2";

export function saveToLocal(grid: Grid2D): void {
  try {
    // Храним размеры вместе с пикселями: демо и импортированные PNG бывают
    // меньше дефолтных 128×128, и без размеров схема не переживёт F5.
    const payload = JSON.stringify({ w: grid.width, h: grid.height, p: encodeBase64(grid.data) });
    localStorage.setItem(LS_KEY, payload);
    localStorage.removeItem(LS_KEY_V2);
  } catch {
    /* ignore */
  }
}

export function loadFromLocal(): Grid2D | null {
  // старый v2-массив мигрируем (индексы 10→1, 11→9) и пересохраняем
  const g = readLocal(LS_KEY) ?? migrateLocalV2();
  if (g) saveToLocal(g);
  return g;
}

function readLocal(key: string): Grid2D | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    // новый формат: JSON { w, h, p }; старый — голый base64 (всегда 128×128)
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { w?: number; h?: number; p?: string };
      if (!parsed.p) return null;
      const bytes = decodeBase64(parsed.p);
      const w = clamp(parsed.w ?? SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
      const h = clamp(parsed.h ?? SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
      const g = createGrid2D(w, h);
      g.data.set(bytes.subarray(0, w * h));
      return g;
    }
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
    return gridFromJSON(await file.text());
  }
  // картинка (PNG/JPG/WebP/…): decode via browser image path
  return await decodeImageFile(file);
}

// Чистый разбор JSON-файла схемы (v2/v3) — вынесен отдельно ради тестов.
export function gridFromJSON(text: string): Grid2D {
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
  if (parsed.version === 2) bytes = migrateV2(bytes); // 10→unknown, 11→bulb(9)
  const w = parsed.width ?? SIZE_DEFAULT;
  const h = parsed.height ?? SIZE_DEFAULT;
  // Размер не «зажимаем» молча: пиксели в файле упакованы под исходную
  // ширину, и клампинг перекроил бы их посреди строки — схема поехала бы.
  if (
    !Number.isInteger(w) || !Number.isInteger(h) ||
    w < SIZE_MIN || w > SIZE_MAX || h < SIZE_MIN || h > SIZE_MAX
  ) {
    throw new Error(`Размер схемы ${w}×${h} вне допустимого диапазона ${SIZE_MIN}..${SIZE_MAX}`);
  }
  if (bytes.length < w * h) throw new Error(`В JSON ${bytes.length} пикселей, а заявлено ${w}×${h}`);
  const g = createGrid2D(w, h);
  g.data.set(bytes.subarray(0, w * h));
  return g;
}

async function decodeImageFile(file: File): Promise<Grid2D> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Браузер не смог прочитать файл — нужны PNG, JPG, WebP или GIF");
  }
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  // Целочисленное уменьшение nearest-neighbour: пиксель в пиксель, без
  // сглаживания — смешение цветов сломало бы квантование в палитру.
  const factor = Math.max(1, Math.ceil(Math.max(srcW, srcH) / SIZE_MAX));
  const w = Math.max(1, Math.round(srcW / factor));
  const h = Math.max(1, Math.round(srcH / factor));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const imgData = ctx.getImageData(0, 0, w, h);
  const grid = gridFromRGBA(imgData.data, w, h);
  // минимальный холст 16×16: мелкую картинку дополняем пустым полем
  if (w >= SIZE_MIN && h >= SIZE_MIN) return grid;
  const g = createGrid2D(Math.max(SIZE_MIN, w), Math.max(SIZE_MIN, h));
  for (let y = 0; y < h; y++) g.data.set(grid.data.subarray(y * w, y * w + w), y * g.width);
  return g;
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
