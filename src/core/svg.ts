import { toHex } from "./palette";
import type { Grid2D } from "./types";

export const SVG_CELL = 8;

export function toSvg(grid: Grid2D): string {
  const { width, height, data } = grid;
  const rects: string[] = [];

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const idx = data[y * width + x];
      if (idx === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < width && data[y * width + x + run] === idx) run++;
      const color = toHex(idx);
      rects.push(
        `<rect x="${x * SVG_CELL}" y="${y * SVG_CELL}" width="${run * SVG_CELL}" height="${SVG_CELL}" fill="${color}"/>`,
      );
      x += run;
    }
  }

  const bw = width * SVG_CELL;
  const bh = height * SVG_CELL;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}" shape-rendering="crispEdges">\n` +
    rects.join("\n") +
    "\n</svg>"
  );
}
