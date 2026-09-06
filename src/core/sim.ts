import type { IR, SimState, Gate, GateType } from "./types";

export const CLOCK_HALF_PERIOD = 10;

export function createSim(ir: IR): SimState {
  const n = ir.netCount;
  return {
    cur: new Uint8Array(n),
    nxt: new Uint8Array(n),
    ir,
    t: 0,
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

  for (const c of ir.consts) nxt[c.net] = c.value;
  // CLOCK: держит 0 первые CLOCK_HALF_PERIOD тактов, затем CLOCK_HALF_PERIOD — 1,
  // далее чередуется. t отсчитывается от старта симуляции (сбрасывается при reset).
  for (const c of ir.clocks) nxt[c.net] = (Math.floor(s.t / CLOCK_HALF_PERIOD) % 2 === 1) ? 1 : 0;

  for (const g of ir.gates) nxt[g.out] = applyGate(g, cur);

  s.cur = nxt;
  s.nxt = cur;
  s.t++;
}
