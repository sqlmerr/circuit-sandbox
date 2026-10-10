import type { IR, SimState, Gate, GateType } from "./types";

export const CLOCK_HALF_PERIOD = 10;

export function createSim(ir: IR): SimState {
  const n = ir.netCount;
  return {
    cur: new Uint8Array(n),
    nxt: new Uint8Array(n),
    ir,
    t: 0,
    switches: new Uint8Array(ir.switches.length),
    memVal: new Uint8Array(ir.memories.length),
    memPrev: new Uint8Array(ir.memories.length),
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

export function step(s: SimState): void {
  const { cur, nxt, ir } = s;
  nxt.fill(0);

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

  // T-триггеры: читают cur (значения тика t−1), пишут в nxt (тик t). По фронту
  // 0→1 на входе значение выхода инвертируется — задержка 1 тик, как у гейтов.
  for (let i = 0; i < ir.memories.length; i++) {
    const m = ir.memories[i];
    const input = cur[m.in];
    let v = s.memVal[i];
    if (input === 1 && s.memPrev[i] === 0) v ^= 1;
    s.memVal[i] = v;
    s.memPrev[i] = input;
    nxt[m.out] |= v;
  }

  for (const g of ir.gates) nxt[g.out] |= applyGate(g, cur);

  s.cur = nxt;
  s.nxt = cur;
  s.t++;
}
