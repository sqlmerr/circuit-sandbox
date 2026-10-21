export type Grid = Uint8Array;
export type Grid2D = { data: Uint8Array; width: number; height: number };

export function createGrid2D(width: number, height: number): Grid2D {
  return { data: new Uint8Array(width * height), width, height };
}

export function getPixel(g: Grid2D, x: number, y: number): number {
  return g.data[y * g.width + x];
}

export function setPixel(g: Grid2D, x: number, y: number, v: number): void {
  g.data[y * g.width + x] = v;
}

export function copyGrid2D(g: Grid2D): Grid2D {
  return { data: g.data.slice(), width: g.width, height: g.height };
}

export type ErrorCode =
  | "ERR_UNKNOWN_PIXEL"
  | "ERR_BODY_NOT_RECT"
  | "ERR_BODY_SIZE"
  | "ERR_PINS_MISMATCH"
  | "ERR_SOURCE_TWO_NETS"
  | "ERR_PORT"
  | "WARN_PORT_INCOMPLETE";

export interface ParseError {
  code: ErrorCode;
  message: string;
  cells: [number, number][];
}

export type GateType = "and" | "or" | "xor" | "not";

export interface Gate {
  type: GateType;
  ins: number[];
  out: number;
  cells: [number, number][];
}

export interface Clock {
  net: number;
  cells: [number, number][];
}

export interface Const {
  net: number;
  value: 0 | 1;
  cells: [number, number][];
}

export interface Bulb {
  net: number;
  cells: [number, number][];
}

export interface Switch {
  net: number;
  cells: [number, number][];
}

// Ячейка памяти — T-триггер: по фронту 0→1 на входе `in` значение выхода `out`
// инвертируется. Один вход, один выход.
export interface Memory {
  in: number;
  out: number;
  cells: [number, number][];
}

export interface IR {
  width: number;
  height: number;
  netCount: number;
  gates: Gate[];
  clocks: Clock[];
  consts: Const[];
  switches: Switch[];
  memories: Memory[];
  bulbs: Bulb[];
}

export interface ParseResult {
  ir: IR;
  errors: ParseError[];
  warnings: ParseError[];
  netMap: Int32Array;
}

/**
 * Петля обратной связи: группа гейтов, чьи выходы (через сети) приходят
 * обратно на входы внутри группы. Кольцо из двух инверторов, RS-защёлка,
 * кольцевой генератор — всё это петли.
 */
export interface SimLoop {
  /** Индексы гейтов петли в ir.gates (по возрастанию). */
  gates: number[];
  /** Внутренние сети петли: их ведут и читают гейты петли. */
  nets: number[];
  /** Для каждой внутренней сети — индексы гейтов петли, которые её ведут. */
  drivers: Map<number, number[]>;
  /** Флаг «сеть внутренняя» (размер netCount) — для быстрого чтения входа. */
  internal: Uint8Array;
  /** Сети-кандидаты на «зажим» при удержании состояния (в порядке гейтов). */
  seeds: number[];
}

export interface SimState {
  cur: Uint8Array;
  nxt: Uint8Array;
  ir: IR;
  t: number;
  // Рантайм-состояние переключателей (значение по индексу в ir.switches).
  // Не персистится: createSim/reset всегда дают нули.
  switches: Uint8Array;
  // Значение T-триггеров (по индексу в ir.memories) и предыдущее значение их
  // входа — для детекта фронта 0→1.
  memVal: Uint8Array;
  memPrev: Uint8Array;
  // Петли обратной связи (в порядке разрешения: зависимости раньше).
  loops: SimLoop[];
  // Флаг «гейт принадлежит петле» (размер ir.gates.length).
  loopGate: Uint8Array;
  // Рабочий буфер для значений сетей петли (размер netCount).
  work: Uint8Array;
}
