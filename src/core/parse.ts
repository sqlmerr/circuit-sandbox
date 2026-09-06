import { roleOf, WIRE_INDEX } from "./palette";
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

// Направления с ролью стороны: N/S — «вертикальные» (читают сеть перекрёстка
// через netMapV), E/W — «горизонтальные» (netMap). Используется и при сборе
// пинов, и при чтении сети под маркером выхода.
const NEIGHBOR_SIDES: { dx: number; dy: number; side: Side }[] = [
  { dx: 0, dy: -1, side: "N" },
  { dx: 0, dy: 1, side: "S" },
  { dx: -1, dy: 0, side: "W" },
  { dx: 1, dy: 0, side: "E" },
];

// Сеть провода в клетке с учётом перекрёстков: сторона, с которой мы смотрим,
// определяет, какая сеть (H или V) доходит до соседа.
function netAt(
  netMap: Int32Array,
  netMapV: Int32Array,
  w: number,
  nx: number,
  ny: number,
  side: Side,
): number {
  const i = ny * w + nx;
  let net = netMap[i];
  if (net < 0) return -1;
  if (side === "N" || side === "S") {
    const v = netMapV[i];
    if (v >= 0) net = v;
  }
  return net;
}

// Роли клетки в сети проводов:
// - обычная клетка или Т-стык: один узел, соединяется со всеми соседями-проводами (Т = соединение);
// - перекрёсток (+): 4 примыкающих провода, два независимых узла H и V,
//   горизонталь идёт W→E, вертикаль N→S, контакта между ними нет;
// - мост (плюс без центровины): ПУСТАЯ клетка с 4 примыкающими проводами —
//   ведёт себя как перекрёсток: H-рукава (W/E) проходят насквозь и соединяются
//   между собой, V-рукава (N/S) — между собой, но H и V не контактируют.

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = new Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
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

function isWireIdx(idx: number): boolean {
  return roleOf(idx) === "wire";
}

// Строит сеть через union-find с обработкой +-перекрёстков и мостов.
// Возвращает: netMap (id сети по клетке провода, -1 иначе),
// netMapV (id вертикальной сети для клеток-перекрёстков, -1 иначе),
// число сетей netCount.
// Пустая клетка моста в netMap/netMapV не отмечается (её центр пинов не даёт);
// H/V-узлы моста нужны только для слияния рукавов в две сквозные сети.
function buildNets(
  grid: Grid2D,
): { netMap: Int32Array; netMapV: Int32Array; netCount: number } {
  const { data, width, height } = grid;
  const netMap = new Int32Array(width * height).fill(-1);
  const netMapV = new Int32Array(width * height).fill(-1);

  const hasWire = (nx: number, ny: number): boolean =>
    nx >= 0 && ny >= 0 && nx < width && ny < height && isWireIdx(data[ny * width + nx]);
  const hasArms = (nx: number, ny: number): boolean =>
    hasWire(nx - 1, ny) && hasWire(nx + 1, ny) && hasWire(nx, ny - 1) && hasWire(nx, ny + 1);

  // kind: 0 = не участвует, 1 = обычный провод, 2 = перекрёсток (провод с 4 соседями),
  // 3 = мост (пустая клетка с 4 соседями-проводами).
  // assign[i] = базовый слот; перекрёсток/мост занимает 2 слота (H = base, V = base+1).
  const kind = new Uint8Array(width * height);
  const assign = new Int32Array(width * height);
  let nodeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = data[i];
      if (isWireIdx(idx) && hasArms(x, y)) {
        kind[i] = 2;
      } else if (idx === 0 && hasArms(x, y)) {
        kind[i] = 3; // мост «плюс без центровины»
      } else if (isWireIdx(idx)) {
        kind[i] = 1;
      } else {
        assign[i] = -1;
        continue;
      }
      assign[i] = nodeCount;
      nodeCount += kind[i] === 1 ? 1 : 2;
    }
  }

  // H-роль клетки: обычный провод/перекрёсток/мост — base; V-роль: base, только
  // для перекрёстка/моста base+1. У обычного провода H-роль == V-роль == base,
  // поэтому он соединяется со всеми четырьмя соседями через один узел.
  const slot = (x: number, y: number, vertical: boolean): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    const i = y * width + x;
    const k = kind[i];
    if (k === 0) return -1;
    return vertical && k !== 1 ? assign[i] + 1 : assign[i];
  };

  const uf = new UnionFind(nodeCount);
  const union = (a: number, b: number) => {
    if (a >= 0 && b >= 0) uf.union(a, b);
  };

  // Горизонтальная пара соседей соединяется по H-ролям (провод с проводом,
  // провод с мостом, мост с мостом), вертикальная — по V-ролям.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      union(slot(x, y, false), slot(x + 1, y, false));
      union(slot(x, y, true), slot(x, y + 1, true));
    }
  }

  // Перенумеровать компоненты связности по порядку сканирования (детерминизм).
  const rootToId = new Map<number, number>();
  let netCount = 0;
  const idFor = (base: number): number => {
    const root = uf.find(base);
    let id = rootToId.get(root);
    if (id === undefined) {
      id = netCount++;
      rootToId.set(root, id);
    }
    return id;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (assign[i] < 0) continue;
      const k = kind[i];
      // У моста netMap остаётся -1: центр пустой, пинов давать не должен;
      // его H/V-узлы и так достáвятся сетью из рукавов-проводов.
      if (k === 3) continue;
      netMap[i] = idFor(assign[i]);
      if (k === 2) netMapV[i] = idFor(assign[i] + 1);
    }
  }

  return { netMap, netMapV, netCount };
}

function collectPins(
  grid: Grid2D,
  body: [number, number][],
  netMap: Int32Array,
  netMapV: Int32Array,
): Pin[] {
  const { width, height } = grid;
  const seen = new Set<string>();
  const pins: Pin[] = [];
  for (const [x, y] of body) {
    for (const { dx, dy, side } of NEIGHBOR_SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      // Провод у стороны N/S примыкает к перекрёстку по его вертикальной сети.
      const net = netAt(netMap, netMapV, width, nx, ny, side);
      if (net < 0) continue;
      const key = `${side},${net}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pins.push({ side, net, cx: nx, cy: ny });
    }
  }
  return pins;
}

// Кластеры маркера выхода (pin-out). Тело маркера — ровно одна клетка;
// летящие рядом маркеры ищутся только для диагностики.
function detectMarkerClusters(grid: Grid2D): [number, number][][] {
  const { data, width, height } = grid;
  const visited = new Uint8Array(width * height);
  const clusters: [number, number][][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (visited[i]) continue;
      if (roleOf(data[i]) !== "pin-out") continue;
      visited[i] = 1;
      const cluster: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        cluster.push([cx, cy]);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni]) continue;
          if (data[ni] !== data[i]) continue;
          visited[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      clusters.push(cluster);
    }
  }
  return clusters;
}

export function parse(grid: Grid2D): ParseResult {
  const { width, height, data } = grid;
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];

  const unknownCells: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Неизвестный пиксель: индекс 1 (unknown) или любой индекс вне палитры
      // (например, оставшийся после импорта старого формата).
      if (roleOf(data[y * width + x]) === "unknown") unknownCells.push([x, y]);
    }
  }
  if (unknownCells.length > 0) {
    errors.push({
      code: "ERR_UNKNOWN_PIXEL",
      message: "Обнаружены пиксели, не распознанные палитрой",
      cells: unknownCells,
    });
  }

  const { netMap, netMapV, netCount } = buildNets(grid);
  const wireCells: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === WIRE_INDEX) wireCells.push([x, y]);
    }
  }

  const bodies = detectBodies(grid);

  // Карта клетка → индекс тела: для поиска тел, примыкающих к маркеру.
  const bodyIndexOf = new Map<string, number>();
  for (let bi = 0; bi < bodies.length; bi++) {
    for (const [x, y] of bodies[bi]) bodyIndexOf.set(`${x},${y}`, bi);
  }

  // Маркер выхода: одна клетка pin-out между телом и проводом. Сеть маркера
  // становится единственным выходом тела (explicit-режим); без маркера роли
  // задаёт сторона (legacy: N/W — входы, E/S — выходы).
  const markersByBody = new Map<number, { net: number; cells: [number, number][] }>();
  for (const cluster of detectMarkerClusters(grid)) {
    if (cluster.length > 1) {
      errors.push({
        code: "ERR_PORT",
        message: "Маркер выхода должен быть одной клеткой",
        cells: cluster,
      });
      continue;
    }
    const [mx, my] = cluster[0];
    const adjBodies = new Set<number>();
    const adjNets = new Set<number>();
    for (const { dx, dy, side } of NEIGHBOR_SIDES) {
      const nx = mx + dx;
      const ny = my + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const bi = bodyIndexOf.get(`${nx},${ny}`);
      if (bi !== undefined) adjBodies.add(bi);
      const net = netAt(netMap, netMapV, width, nx, ny, side);
      if (net >= 0) adjNets.add(net);
    }
    if (adjBodies.size === 0) {
      warnings.push({
        code: "WARN_PORT_INCOMPLETE",
        message: "Маркер выхода не примыкает к телу",
        cells: cluster,
      });
      continue;
    }
    if (adjBodies.size > 1) {
      errors.push({
        code: "ERR_PORT",
        message: "Маркер выхода примыкает к нескольким телам",
        cells: cluster,
      });
      continue;
    }
    if (adjNets.size === 0) {
      warnings.push({
        code: "WARN_PORT_INCOMPLETE",
        message: "Маркер выхода не подключён к проводу",
        cells: cluster,
      });
      continue;
    }
    if (adjNets.size > 1) {
      errors.push({
        code: "ERR_PORT",
        message: "Маркер выхода касается нескольких сетей",
        cells: cluster,
      });
      continue;
    }
    const bodyIdx = [...adjBodies][0];
    const net = [...adjNets][0];
    if (markersByBody.has(bodyIdx)) {
      errors.push({
        code: "ERR_PORT",
        message: "У тела несколько маркеров выхода",
        cells: cluster,
      });
      continue;
    }
    markersByBody.set(bodyIdx, { net, cells: cluster });
  }

  const ir: IR = {
    width,
    height,
    netCount,
    gates: [],
    clocks: [],
    consts: [],
    bulbs: [],
  };
  const wireCellsByNet = new Map<number, [number, number][]>();
  for (const [x, y] of wireCells) {
    const net = netMap[y * width + x];
    if (net < 0) continue;
    if (!wireCellsByNet.has(net)) wireCellsByNet.set(net, []);
    wireCellsByNet.get(net)!.push([x, y]);
  }

  const pinnedNets = new Set<number>();

  for (let bodyIdx = 0; bodyIdx < bodies.length; bodyIdx++) {
    const body = bodies[bodyIdx];
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

    let sizeOk = w >= 2 && w <= 32 && h >= 2 && h <= 32;
    let sizeMsg = "Размер тела 2×2..32×32";
    if (!sizeOk) {
      errors.push({
        code: "ERR_BODY_SIZE",
        message: sizeMsg,
        cells: body,
      });
      continue;
    }

    const pins = collectPins(grid, body, netMap, netMapV);
    for (const p of pins) pinnedNets.add(p.net);

    const marker = markersByBody.get(bodyIdx);
    if (marker) pinnedNets.add(marker.net);

    // Маркер на лампочке запрещён.
    if (role === "bulb" && marker) {
      errors.push({
        code: "ERR_PORT",
        message: "У лампочки не может быть маркера выхода",
        cells: marker.cells,
      });
      continue;
    }

    // explicit-режим (сеть маркера = единственный выход, входы — только прямые
    // пины в любом направлении) или legacy (роли по сторонам).
    let inputs: Pin[];
    let outputs: Pin[];
    if (marker) {
      if (pins.some((p) => p.net === marker.net)) {
        errors.push({
          code: "ERR_PORT",
          message: "Сеть маркера выхода также напрямую касается тела",
          cells: body,
        });
        continue;
      }
      inputs = [...pins].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      outputs = [
        { side: "E", net: marker.net, cx: marker.cells[0][0], cy: marker.cells[0][1] },
      ];
    } else {
      inputs = pins.filter((p) => p.side === "W" || p.side === "N");
      outputs = pins.filter((p) => p.side === "E" || p.side === "S");
      inputs.sort((a, b) => (a.side === b.side ? a.cy - b.cy : a.side === "W" ? -1 : 1));
      outputs.sort((a, b) => (a.side === b.side ? a.cy - b.cy : a.side === "E" ? -1 : 1));
    }
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
            message: "Источник касается двух разных сетей",
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
          ir.clocks.push({ net, cells: body });
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
  const drivenSet = new Set(driverMap.keys());

  const usedNets = new Set<number>();
  for (const g of ir.gates) for (const n of g.ins) usedNets.add(n);
  for (const b of ir.bulbs) usedNets.add(b.net);

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

  return { ir, errors, warnings, netMap };
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
  return drivers;
}
