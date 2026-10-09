import { roleOf } from "./palette";
import type { Role } from "./palette";
import { matchesShape, shapeForRole, shapePorts } from "./shapes";
import type { ShapePorts, Side as ShapeSide } from "./shapes";
import type { Grid2D, ParseResult, ParseError, IR } from "./types";

const COMPONENT_ROLES = new Set<Role>([
  "and",
  "or",
  "xor",
  "not",
  "clock",
  "high",
  "bulb",
]);

type Side = "N" | "S" | "E" | "W";

interface Pin {
  side: Side;
  net: number;
  cx: number;
  cy: number;
}

// Тело, прошедшее проверку формы/размера, с его пинами, маркером выхода и
// портами (роли сторон).
interface BodyEntry {
  bodyIdx: number;
  role: Role;
  body: [number, number][];
  pins: Pin[];
  marker: { net: number; cells: [number, number][] } | null;
  ports: ShapePorts;
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

// Bitmap тела по его bbox: 1 — клетка тела, 0 — пусто (нужен для сверки с
// каноничной фигурой роли).
function bodyBitmap(
  body: [number, number][],
  width: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[][] {
  const cells = new Set(body.map(([x, y]) => y * width + x));
  const bitmap: number[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: number[] = [];
    for (let x = minX; x <= maxX; x++) row.push(cells.has(y * width + x) ? 1 : 0);
    bitmap.push(row);
  }
  return bitmap;
}

const OPPOSITE_SIDE: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };

// Роли по сторонам света (legacy): сплошные прямоугольники и симметричные
// фигуры ориентируются именно так.
const LEGACY_PORTS: ShapePorts = { inputs: ["W", "N"], outputs: ["E", "S"] };

// Разводка пинов на входы и выходы: маркер выхода = единственный выход,
// остальные прямые пины — входы (explicit-режим); без маркера стороны пинов
// задаются фигурой тела, а для сплошных прямоугольников — правилом по
// сторонам света (legacy: W/N — входы, E/S — выходы).
function splitPins(e: BodyEntry, ports: ShapePorts): { inputs: Pin[]; outputs: Pin[] } {
  if (e.marker) {
    return {
      inputs: [...e.pins].sort((a, b) => a.cy - b.cy || a.cx - b.cx),
      outputs: [
        { side: "E", net: e.marker.net, cx: e.marker.cells[0][0], cy: e.marker.cells[0][1] },
      ],
    };
  }
  return {
    inputs: sortBySide(e.pins.filter((p) => ports.inputs.includes(p.side as ShapeSide)), ports.inputs),
    outputs: sortBySide(e.pins.filter((p) => ports.outputs.includes(p.side as ShapeSide)), ports.outputs),
  };
}

// Порядок пинов детерминированный: сначала по порядку сторон, затем вдоль
// стороны (по y для E/W, по x для N/S).
function sortBySide(pins: Pin[], sides: ShapeSide[]): Pin[] {
  const rank = (s: Side) => {
    const i = sides.indexOf(s as ShapeSide);
    return i === -1 ? sides.length : i;
  };
  return [...pins].sort(
    (a, b) =>
      rank(a.side) - rank(b.side) ||
      (a.side === "N" || a.side === "S" ? a.cx - b.cx : a.cy - b.cy),
  );
}

// Пины на сторонах, которым фигура портов не назначила роли, — ошибка:
// иначе провод молча ничего не делал бы.
function strayPins(e: BodyEntry, ports: ShapePorts): Pin[] {
  const allowed = new Set<ShapeSide>([...ports.inputs, ...ports.outputs]);
  return e.pins.filter((p) => !allowed.has(p.side as ShapeSide));
}

/**
 * Ориентация 1-входного гейта выводится из разводки: у него четыре
 * симметричных отростка, поэтому входом становится тот пин, чью сеть приводит
 * кто-то ещё (источник или выход другого гейта), а выходом — отросток на
 * противоположной стороне. Если таких пинов нет или их несколько (например, в
 * кольце из двух NOT, где сети приводят друг друга) — возвращается null и
 * вызывающий код берёт legacy-правило по сторонам.
 */
function pickNotPorts(
  pins: Pin[],
  drivenByOthers: (net: number) => boolean,
): { inputs: Pin[]; outputs: Pin[] } | null {
  const fed = pins.filter((p) => drivenByOthers(p.net));
  if (pins.length < 2 || fed.length !== 1) return null;
  const input = fed[0];
  const rest = pins.filter((p) => p !== input);
  const output = rest.find((p) => p.side === OPPOSITE_SIDE[input.side]) ?? rest[0];
  return { inputs: [input], outputs: [output] };
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

  // Кто приводит сеть: сеть → индексы тел. Нужен гейтам с 1 входом (у них
  // вход/выход определяется разводкой) и наполняется по мере разбора тел.
  const drivenBy = new Map<number, Set<number>>();
  const markDriven = (net: number, bodyIdx: number): void => {
    const set = drivenBy.get(net);
    if (set) set.add(bodyIdx);
    else drivenBy.set(net, new Set([bodyIdx]));
  };

  // Валидирует пины тела по его типу и кладёт компонент в IR.
  // Возвращает сеть, которую тело приводит само, либо null при ошибке.
  const emit = (e: BodyEntry, inputs: Pin[], outputs: Pin[]): number | null => {
    const inputNets = inputs.map((p) => p.net);
    const outputNets = outputs.map((p) => p.net);
    switch (e.role) {
      case "and":
      case "or":
      case "xor":
      case "not": {
        const inCount = e.role === "not" ? 1 : 2;
        if (inputs.length !== inCount || outputs.length !== 1) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: `Гейт ${e.role.toUpperCase()}: ожидается ${inCount} вход(ов) и 1 выход`,
            cells: e.body,
          });
          return null;
        }
        ir.gates.push({ type: e.role, ins: inputNets, out: outputNets[0], cells: e.body });
        return outputNets[0];
      }
      case "bulb": {
        if (inputs.length !== 1 || outputs.length !== 0) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: "Лампочка: ожидается 1 вход и 0 выходов",
            cells: e.body,
          });
          return null;
        }
        ir.bulbs.push({ net: inputNets[0], cells: e.body });
        return null;
      }
      case "clock":
      case "high": {
        const distinctNets = new Set(e.pins.map((p) => p.net));
        if (distinctNets.size > 1) {
          errors.push({
            code: "ERR_SOURCE_TWO_NETS",
            message: "Источник касается двух разных сетей",
            cells: e.body,
          });
          return null;
        }
        if (inputs.length !== 0 || outputs.length !== 1) {
          errors.push({
            code: "ERR_PINS_MISMATCH",
            message: `Источник ${e.role.toUpperCase()}: ожидается 1 выход и 0 входов`,
            cells: e.body,
          });
          return null;
        }
        const net = outputNets[0];
        if (e.role === "clock") {
          ir.clocks.push({ net, cells: e.body });
        } else {
          ir.consts.push({ net, value: 1, cells: e.body });
        }
        return net;
      }
      default:
        return null;
    }
  };

  // Гейты с 1 входом (NOT) без маркера выхода ждут второго прохода: их
  // ориентация выводится из разводки, поэтому нужен список драйверов сетей.
  const pending1in: BodyEntry[] = [];

  for (let bodyIdx = 0; bodyIdx < bodies.length; bodyIdx++) {
    const body = bodies[bodyIdx];
    const firstIdx = data[body[0][1] * width + body[0][0]];
    const role = roleOf(firstIdx);
    const w = maxDim(body, "w");
    const h = maxDim(body, "h");
    const { minX, minY, maxX, maxY } = bodyBBox(body);
    // Тело — либо сплошной прямоугольник (legacy: так нарисованы старые схемы
    // и демо), либо каноничная фигура своей роли в одном из четырёх поворотов.
    const solid = (maxX - minX + 1) * (maxY - minY + 1) === body.length;
    const shape = shapeForRole(role);
    const bitmap = solid ? null : bodyBitmap(body, width, minX, minY, maxX, maxY);
    const knownShape = bitmap !== null && shape !== null && matchesShape(bitmap, shape);
    // Порты фигуры идут за нарисованными отростками, поэтому поворот гейта
    // остаётся осмысленным. У симметричной фигуры (крест NOT) отростков с
    // разрывом нет — там роли решает разводка (см. pickNotPorts), а по
    // умолчанию берутся стороны света, как у сплошного прямоугольника.
    const drawnPorts = knownShape && bitmap ? shapePorts(bitmap) : null;
    const ports: ShapePorts = drawnPorts && drawnPorts.inputs.length > 0 ? drawnPorts : LEGACY_PORTS;
    if (!solid && !knownShape) {
      errors.push({
        code: "ERR_BODY_NOT_RECT",
        message: "Область тела не является сплошным прямоугольником или фигурой гейта",
        cells: body,
      });
      continue;
    }

    // У каноничной фигуры размер зафиксирован самой фигурой (3×3), поэтому
    // диапазон 2..32 проверяется только для сплошных прямоугольников.
    if (solid && (w < 2 || w > 32 || h < 2 || h > 32)) {
      errors.push({
        code: "ERR_BODY_SIZE",
        message: "Размер тела 2×2..32×32",
        cells: body,
      });
      continue;
    }

    const pins = collectPins(grid, body, netMap, netMapV);

    const marker = markersByBody.get(bodyIdx);

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
    if (marker && pins.some((p) => p.net === marker.net)) {
      errors.push({
        code: "ERR_PORT",
        message: "Сеть маркера выхода также напрямую касается тела",
        cells: body,
      });
      continue;
    }

    const entry: BodyEntry = { bodyIdx, role, body, pins, marker: marker ?? null, ports };
    if (!marker && strayPins(entry, ports).length > 0) {
      errors.push({
        code: "ERR_PINS_MISMATCH",
        message: `Провод касается ${role.toUpperCase()} сбоку — у фигуры нет отростка на этой стороне`,
        cells: strayPins(entry, ports).flatMap((p) => [[p.cx, p.cy] as [number, number]]),
      });
      continue;
    }
    if (role === "not" && !marker) {
      pending1in.push(entry);
      continue;
    }

    const { inputs, outputs } = splitPins(entry, ports);
    const drivenNet = emit(entry, inputs, outputs);
    if (drivenNet !== null) markDriven(drivenNet, bodyIdx);
  }

  // Второй проход: 1-входные гейты. Вход — тот пин, чью сеть приводит кто-то
  // ещё (источник или выход другого гейта), выход — противоположный отросток.
  for (const entry of pending1in) {
    const drivenByOthers = (net: number): boolean => {
      const drivers = drivenBy.get(net);
      if (!drivers) return false;
      for (const driverIdx of drivers) if (driverIdx !== entry.bodyIdx) return true;
      return false;
    };
    const { inputs, outputs } =
      pickNotPorts(entry.pins, drivenByOthers) ?? splitPins(entry, entry.ports);
    if (inputs.length === 1 && outputs.length === 1 && inputs[0].net === outputs[0].net) {
      errors.push({
        code: "ERR_PINS_MISMATCH",
        message: "NOT: вход и выход оказались на одной сети",
        cells: entry.body,
      });
      continue;
    }
    const drivenNet = emit(entry, inputs, outputs);
    if (drivenNet !== null) markDriven(drivenNet, entry.bodyIdx);
  }

  return { ir, errors, warnings, netMap };
}

function maxDim(body: [number, number][], which: "w" | "h"): number {
  const xs = body.map((c) => c[0]);
  const ys = body.map((c) => c[1]);
  return which === "w" ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
}

