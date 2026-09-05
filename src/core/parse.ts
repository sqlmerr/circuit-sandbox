import { roleOf } from "./palette";
import type { Role } from "./palette";
import type { Grid2D, ParseResult, ParseError, IR } from "./types";

const COMPONENT_ROLES = new Set<Role>([
  "and",
  "or",
  "xor",
  "not",
  "clock",
  "high",
  "low",
  "dff",
  "bulb",
]);

type Side = "N" | "S" | "E" | "W";

interface Pin {
  side: Side;
  net: number;
  cx: number;
  cy: number;
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isWire(idx: number): boolean {
  return roleOf(idx) === "wire";
}

function detectBodies(grid: Grid2D): [number, number][][] {
  const { data, width, height } = grid;
  const visited = new Uint8Array(width * height);
  const bodies: [number, number][][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (visited[i]) continue;
      const idx = data[i];
      if (!COMPONENT_ROLES.has(roleOf(idx))) continue;
      visited[i] = 1;

      const body: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        body.push([cx, cy]);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni]) continue;
          if (data[ni] !== idx) continue;
          visited[ni] = 1;
          stack.push([nx, ny]);
        }
      }

      bodies.push(body);
    }
  }

  return bodies;
}

function bodyBBox(body: [number, number][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of body) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function collectPins(grid: Grid2D, body: [number, number][]): Pin[] {
  const { width, height } = grid;
  const inBody = new Set<string>();
  for (const [x, y] of body) inBody.add(`${x},${y}`);

  const seen = new Set<string>();
  const pins: Pin[] = [];
  for (const [x, y] of body) {
    const neighbors: { side: Side; x: number; y: number }[] = [
      { side: "N", x, y: y - 1 },
      { side: "S", x, y: y + 1 },
      { side: "W", x: x - 1, y },
      { side: "E", x: x + 1, y },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
      const idx = grid.data[n.y * width + n.x];
      if (!isWire(idx)) continue;
      const net = idx - 2;
      const key = `${n.side},${net}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pins.push({ side: n.side, net, cx: n.x, cy: n.y });
    }
  }
  return pins;
}

export function parse(grid: Grid2D): ParseResult {
  const { width, height, data } = grid;
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];

  const unknownCells: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 1) unknownCells.push([x, y]);
    }
  }
  if (unknownCells.length > 0) {
    errors.push({
      code: "ERR_UNKNOWN_PIXEL",
      message: "Обнаружены пиксели, не распознанные палитрой",
      cells: unknownCells,
    });
  }

  const bodies = detectBodies(grid);

  const ir: IR = { width, height, gates: [], clocks: [], consts: [], dffs: [], bulbs: [] };

  const pinnedNets = new Set<number>();
  const wireCellsByNet = new Map<number, [number, number][]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = data[y * width + x];
      if (!isWire(idx)) continue;
      const net = idx - 2;
      if (!wireCellsByNet.has(net)) wireCellsByNet.set(net, []);
      wireCellsByNet.get(net)!.push([x, y]);
    }
  }

  for (const body of bodies) {
    const firstIdx = data[body[0][1] * width + body[0][0]];
    const role = roleOf(firstIdx);
    const w = maxDim(body, "w");
    const h = maxDim(body, "h");
    const { minX, minY, maxX, maxY } = bodyBBox(body);
    const solid = (maxX - minX + 1) * (maxY - minY + 1) === body.length;

    if (!solid) {
      errors.push({
        code: "ERR_BODY_NOT_RECT",
        message: "Область тела не является сплошным прямоугольником",
        cells: body,
      });
      continue;
    }

    let sizeOk = true;
    let sizeMsg = "";
    if (role === "clock") {
      sizeOk = w >= 2 && w <= 64 && h >= 1 && h <= w - 1;
      sizeMsg = "Тактовый генератор: 2 ≤ W ≤ 64, 1 ≤ H ≤ W−1";
    } else if (role === "dff") {
      sizeOk = w >= 3 && w <= 32 && h >= 3 && h <= 32;
      sizeMsg = "DFF: размер тела 3×3..32×32";
    } else {
      sizeOk = w >= 2 && w <= 32 && h >= 2 && h <= 32;
      sizeMsg = "Размер тела 2×2..32×32";
    }
    if (!sizeOk) {
      errors.push({
        code: role === "clock" ? "ERR_CLOCK_SIZE" : "ERR_BODY_SIZE",
        message: sizeMsg,
        cells: body,
      });
      continue;
    }

    const pins = collectPins(grid, body);
    for (const p of pins) pinnedNets.add(p.net);

    const inputs = pins.filter((p) => p.side === "W" || p.side === "N");
    const outputs = pins.filter((p) => p.side === "E" || p.side === "S");
    inputs.sort((a, b) => (a.side === b.side ? a.cy - b.cy : a.side === "W" ? -1 : 1));
    outputs.sort((a, b) => (a.side === b.side ? a.cy - b.cy : a.side === "E" ? -1 : 1));
    const inputNets = inputs.map((p) => p.net);
    const outputNets = outputs.map((p) => p.net);

    switch (role) {
      case "and":
      case "or":
      case "xor":
      case "not": {
        const inCount = role === "not" ? 1 : 2;
        if (inputs.length !== inCount || outputs.length !== 1) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: `Гейт ${role.toUpperCase()}: ожидается ${inCount} вход(ов) и 1 выход`,
            cells: body,
          });
          continue;
        }
        ir.gates.push({ type: role, ins: inputNets, out: outputNets[0], cells: body });
        break;
      }
      case "dff": {
        if (inputs.length !== 2 || outputs.length !== 1) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: "DFF: ожидается 2 входа (D, C) и 1 выход (Q)",
            cells: body,
          });
          continue;
        }
        ir.dffs.push({ d: inputNets[0], c: inputNets[1], q: outputNets[0], cells: body });
        break;
      }
      case "bulb": {
        if (inputs.length !== 1 || outputs.length !== 0) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: "Лампочка: ожидается 1 вход и 0 выходов",
            cells: body,
          });
          continue;
        }
        ir.bulbs.push({ net: inputNets[0], cells: body });
        break;
      }
      case "clock":
      case "high":
      case "low": {
        const distinctNets = new Set(pins.map((p) => p.net));
        if (distinctNets.size > 1) {
          errors.push({
            code: "ERR_SOURCE_TWO_NETS",
            message: "Источник касается двух разных сетей — разведите одним цветом провода",
            cells: body,
          });
          continue;
        }
        if (inputs.length !== 0 || outputs.length !== 1) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: `Источник ${role.toUpperCase()}: ожидается 1 выход и 0 входов`,
            cells: body,
          });
          continue;
        }
        const net = outputNets[0];
        if (role === "clock") {
          ir.clocks.push({ net, period: w, high: h, cells: body });
        } else {
          ir.consts.push({ net, value: role === "high" ? 1 : 0, cells: body });
        }
        break;
      }
      default:
        break;
    }
  }

  const driverMap = collectDrivers(ir);
  for (const bodies of driverMap.values()) {
    if (bodies.length > 1) {
      errors.push({
        code: "ERR_MULTI_DRIVER",
        message: "Сеть имеет несколько драйверов (два выхода или два источника)",
        cells: bodies.flat(),
      });
    }
  }

  const usedNets = new Set<number>();
  for (const g of ir.gates) for (const n of g.ins) usedNets.add(n);
  for (const b of ir.bulbs) usedNets.add(b.net);
  for (const d of ir.dffs) { usedNets.add(d.d); usedNets.add(d.c); }

  const drivenSet = new Set(driverMap.keys());

  for (const net of usedNets) {
    if (!drivenSet.has(net)) {
      warnings.push({
        code: "WARN_NO_DRIVER",
        message: "Сеть используется, но не имеет драйвера — работает как 0",
        cells: wireCellsByNet.get(net) ?? [],
      });
    }
  }

  for (const [net, cells] of wireCellsByNet) {
    if (cells.length > 0 && !pinnedNets.has(net)) {
      warnings.push({
        code: "WARN_IDLE_NET",
        message: "Сеть не подключена ни к чему",
        cells,
      });
    }
  }

  return { ir, errors, warnings };
}

function maxDim(body: [number, number][], which: "w" | "h"): number {
  const xs = body.map((c) => c[0]);
  const ys = body.map((c) => c[1]);
  return which === "w" ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
}

function collectDrivers(ir: IR): Map<number, [number, number][][]> {
  const drivers = new Map<number, [number, number][][]>();
  function add(net: number, body: [number, number][]) {
    const arr = drivers.get(net);
    if (arr) arr.push(body);
    else drivers.set(net, [body]);
  }
  for (const g of ir.gates) add(g.out, g.cells);
  for (const c of ir.consts) add(c.net, c.cells);
  for (const c of ir.clocks) add(c.net, c.cells);
  for (const d of ir.dffs) add(d.q, d.cells);
  return drivers;
}
