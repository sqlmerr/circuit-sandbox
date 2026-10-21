import type { IR, SimState, SimLoop, Gate, GateType } from "./types";

export const CLOCK_HALF_PERIOD = 10;

// Максимум итераций при поиске неподвижной точки петли обратной связи.
const MAX_LOOP_ITER = 24;

export function createSim(ir: IR): SimState {
  const n = ir.netCount;
  const { loops, loopGate } = findLoops(ir);
  return {
    cur: new Uint8Array(n),
    nxt: new Uint8Array(n),
    ir,
    t: 0,
    switches: new Uint8Array(ir.switches.length),
    memVal: new Uint8Array(ir.memories.length),
    memPrev: new Uint8Array(ir.memories.length),
    loops,
    loopGate,
    work: new Uint8Array(n),
  };
}

export function applyGate(g: Gate, cur: Uint8Array): number {
  switch (g.type) {
    case "and":
      return (cur[g.ins[0]] & cur[g.ins[1]]) & 1;
    case "or":
      return (cur[g.ins[0]] | cur[g.ins[1]]) & 1;
    case "xor":
      return (cur[g.ins[0]] ^ cur[g.ins[1]]) & 1;
    case "not":
      return cur[g.ins[0]] === 0 ? 1 : 0;
  }
}

export function gateTruth(gateType: GateType, a: number, b = 0): number {
  const g: Gate = { type: gateType, ins: [0, 1], out: 2, cells: [] };
  const cur = new Uint8Array([a, b, 0]);
  return applyGate(g, cur);
}

// ---------------------------------------------------------------------------
// Петли обратной связи
// ---------------------------------------------------------------------------
//
// Петля — это группа гейтов, чьи выходы (через сети) приходят обратно на
// входы внутри группы: кольцо инверторов, RS-защёлка, кольцевой генератор.
//
// Физика такая:
//   * чётное число инверсий в петле → устойчивое состояние (ячейка SRAM,
//     защёлка). Петля ДЕРЖИТ бит и не мигает;
//   * нечётное число инверсий → устойчивого состояния нет, схема реально
//     осциллирует (кольцевой генератор).
//
// Поэтому петля разрешается по-уровневому (как настоящая асинхронная
// защёлка): ищем неподвижную точку уравнений сети. Если точка есть — это
// защёлка, её состояние берём из найденной точки (петля держит бит, а внешнее
// воздействие — источник «1» — может её переключить). Если точки нет — петля
// генератор, и она считается по обычной модели с задержкой 1 тик.

/**
 * Ищет петли обратной связи: компоненты сильной связности графа
 * «гейт → гейт, читающий его выход». Петли независимы друг от друга (иначе
 * они были бы одной КСС), поэтому порядок их разрешения задаётся
 * топологической сортировкой по зависимостям: петля, читающая выход другой
 * петли, разрешается позже.
 */
function findLoops(ir: IR): { loops: SimLoop[]; loopGate: Uint8Array } {
  const gates = ir.gates;
  const n = gates.length;
  const loopGate = new Uint8Array(n);
  if (n === 0) return { loops: [], loopGate };

  // Сеть → индексы гейтов, которые её ведут.
  const driversOf = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const list = driversOf.get(gates[i].out);
    if (list) list.push(i);
    else driversOf.set(gates[i].out, [i]);
  }

  // Граф: i → j, если j читает сеть, которую ведёт i.
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let j = 0; j < n; j++) {
    for (const net of gates[j].ins) {
      const ds = driversOf.get(net);
      if (!ds) continue;
      for (const i of ds) if (i !== j) adj[i].push(j);
    }
  }

  // Тарьян: компоненты сильной связности.
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const sccs: number[][] = [];
  let counter = 0;

  const strongConnect = (v: number): void => {
    index[v] = counter;
    low[v] = counter;
    counter++;
    stack.push(v);
    onStack[v] = 1;
    for (const w of adj[v]) {
      if (index[w] === -1) {
        strongConnect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      const comp: number[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack[w] = 0;
        comp.push(w);
        if (w === v) break;
      }
      sccs.push(comp);
    }
  };
  for (let v = 0; v < n; v++) if (index[v] === -1) strongConnect(v);

  // Компонента — петля, если в ней больше одного гейта или гейт читает свой
  // же выход (петля из одного инвертора — самый частый «генератор»).
  const comps: number[][] = [];
  for (const comp of sccs) {
    const self = comp.length === 1 && gates[comp[0]].ins.includes(gates[comp[0]].out);
    if (comp.length > 1 || self) comps.push(comp.sort((a, b) => a - b));
  }
  if (comps.length === 0) return { loops: [], loopGate };

  const loops: SimLoop[] = comps.map((comp) => {
    const drivers = new Map<number, number[]>();
    for (const gi of comp) {
      const out = gates[gi].out;
      const list = drivers.get(out);
      if (list) list.push(gi);
      else drivers.set(out, [gi]);
    }
    // Внутренняя сеть петли: её ведут и читают гейты петли.
    const internal = new Uint8Array(ir.netCount);
    const nets: number[] = [];
    for (const gi of comp) {
      for (const net of gates[gi].ins) {
        if (!drivers.has(net) || internal[net]) continue;
        internal[net] = 1;
        nets.push(net);
      }
    }
    // Сети-кандидаты на «зажим» (удержание состояния) — по порядку гейтов.
    const seeds: number[] = [];
    for (const gi of comp) {
      const out = gates[gi].out;
      if (internal[out] && !seeds.includes(out)) seeds.push(out);
    }
    for (const gi of comp) loopGate[gi] = 1;
    return { gates: comp, nets, drivers, internal, seeds };
  });

  // Порядок разрешения петель: зависимости раньше.
  const loopOf = new Int32Array(n).fill(-1);
  comps.forEach((comp, li) => {
    for (const gi of comp) loopOf[gi] = li;
  });
  const deps: number[][] = comps.map(() => []);
  for (let li = 0; li < comps.length; li++) {
    for (const gi of comps[li]) {
      for (const net of gates[gi].ins) {
        for (const dj of driversOf.get(net) ?? []) {
          const lj = loopOf[dj];
          if (lj >= 0 && lj !== li && !deps[li].includes(lj)) deps[li].push(lj);
        }
      }
    }
  }
  const order: number[] = [];
  const mark = new Uint8Array(comps.length); // 0 — не был, 1 — в стеке, 2 — готов
  const visit = (li: number): void => {
    if (mark[li] !== 0) return;
    mark[li] = 1;
    for (const dep of deps[li]) visit(dep);
    mark[li] = 2;
    order.push(li);
  };
  for (let li = 0; li < comps.length; li++) visit(li);

  return { loops: order.map((li) => loops[li]), loopGate };
}

/** Чтение входа гейта петли: внутренняя сеть — из work, внешняя — из nxt. */
function loopGateValue(s: SimState, loop: SimLoop, g: Gate): number {
  const read = (net: number): number =>
    (loop.internal[net] ? s.work[net] : s.nxt[net]) & 1;
  switch (g.type) {
    case "and":
      return (read(g.ins[0]) & read(g.ins[1])) & 1;
    case "or":
      return (read(g.ins[0]) | read(g.ins[1])) & 1;
    case "xor":
      return (read(g.ins[0]) ^ read(g.ins[1])) & 1;
    case "not":
      return read(g.ins[0]) === 0 ? 1 : 0;
  }
}

/**
 * Значение сети петли: вклад внешних драйверов (уже посчитан в nxt) плюс
 * выходы гейтов самой петли.
 */
function loopNetValue(s: SimState, loop: SimLoop, net: number): number {
  let v = s.nxt[net] & 1;
  for (const gi of loop.drivers.get(net) ?? []) {
    v |= loopGateValue(s, loop, s.ir.gates[gi]);
  }
  return v & 1;
}

/**
 * Ищет устойчивое состояние петли (неподвижную точку её уравнений).
 *
 * 1) Обычная итерация от текущего состояния. Если схема пришла к
 *    неподвижной точке — это и есть состояние петли.
 * 2) Если итерация не сходится (петля стартовала из метастабильного состояния
 *    «всё нули», как настоящая ячейка SRAM при включении питания), пробуем
 *    «зажать» одну сеть на прежнем значении и проверить согласованность:
 *    так петля удерживает тот бит, который в ней уже был.
 *
 * Возвращает false, если устойчивого состояния нет — такая петля реально
 * осциллирует (кольцевой генератор).
 */
function settleLoop(s: SimState, loop: SimLoop): boolean {
  const { cur, work } = s;
  for (const n of loop.nets) work[n] = cur[n];
  for (let iter = 0; iter < MAX_LOOP_ITER; iter++) {
    let changed = false;
    for (const n of loop.nets) {
      const v = loopNetValue(s, loop, n);
      if (v !== work[n]) {
        work[n] = v;
        changed = true;
      }
    }
    if (!changed) return true;
  }
  for (const seed of loop.seeds) {
    for (const n of loop.nets) work[n] = cur[n];
    let stable = false;
    for (let iter = 0; iter < MAX_LOOP_ITER; iter++) {
      let changed = false;
      for (const n of loop.nets) {
        if (n === seed) continue;
        const v = loopNetValue(s, loop, n);
        if (v !== work[n]) {
          work[n] = v;
          changed = true;
        }
      }
      if (!changed) {
        stable = true;
        break;
      }
    }
    // Зажатая сеть должна совпадать с тем, что дают её драйверы.
    if (stable && loopNetValue(s, loop, seed) === work[seed]) return true;
  }
  return false;
}

export function step(s: SimState): void {
  const { cur, nxt, ir } = s;
  nxt.fill(0); // сети без драйвера = 0

  // Все драйверы сети собираются по ИЛИ: сеть = 1, если хотя бы один драйвер
  // выдаёт 1. Поэтому пишем `|=`, а не `=`: несколько источников, а также
  // выходы гейтов/памяти могут сосуществовать на одной сети, и 0 одного
  // драйвера не «гасит» 1 другого (никакого last-write-wins).
  for (const c of ir.consts) nxt[c.net] |= c.value;
  // CLOCK: держит 0 первые CLOCK_HALF_PERIOD тактов, затем CLOCK_HALF_PERIOD — 1,
  // далее чередуется. t отсчитывается от старта симуляции (сбрасывается при reset).
  for (const c of ir.clocks) nxt[c.net] |= (Math.floor(s.t / CLOCK_HALF_PERIOD) % 2 === 1) ? 1 : 0;
  // Переключатели — тоже источники: их значение задаётся в рантайме (клик).
  for (let i = 0; i < ir.switches.length; i++) nxt[ir.switches[i].net] |= s.switches[i] ? 1 : 0;

  // T-триггеры: читают cur (значения тика t−1), пишут nxt (тик t). По фронту
  // 0→1 на входе значение выхода инвертируется — задержка 1 тик, как у гейтов.
  for (let i = 0; i < ir.memories.length; i++) {
    const m = ir.memories[i];
    const input = cur[m.in];
    let v = s.memVal[i];
    if (input === 1 && s.memPrev[i] === 0) v ^= 1; // rising edge → toggle
    s.memVal[i] = v;
    s.memPrev[i] = input;
    nxt[m.out] |= v;
  }

  // Фаза 3: гейты вне петель обратной связи — задержка 1 тик (читают cur).
  for (let i = 0; i < ir.gates.length; i++) {
    if (s.loopGate[i]) continue;
    nxt[ir.gates[i].out] |= applyGate(ir.gates[i], cur);
  }

  // Фаза 4: петли обратной связи — по-уровневому, как настоящая защёлка.
  // Внешние входы петли берутся из nxt (значения текущего тика): защёлка
  // реагирует на изменение входа сразу, а её выход наружу виден следующим
  // тиком (внешние гейты читают cur).
  for (const loop of s.loops) {
    if (settleLoop(s, loop)) {
      for (const gi of loop.gates) {
        const g = ir.gates[gi];
        nxt[g.out] |= loopGateValue(s, loop, g);
      }
    } else {
      // Устойчивого состояния нет → генератор: обычная модель с задержкой 1 тик.
      for (const gi of loop.gates) {
        const g = ir.gates[gi];
        nxt[g.out] |= applyGate(g, cur);
      }
      // Шум включения питания: симметричное стартовое состояние кольца
      // (все узлы одинаковые) — метастабильное, в реальной схеме его ломает
      // шум. Один узел «щёлкает» — и волна бежит по кольцу (период колебаний
      // равен 2 × число инверторов × задержка, а не 2 тика).
      if (s.t === 0 && loop.nets.length > 0) {
        const first = loop.nets[0];
        if (loop.nets.every((n) => cur[n] === cur[first])) nxt[first] ^= 1;
      }
    }
  }

  s.cur = nxt;
  s.nxt = cur;
  s.t++;
}
