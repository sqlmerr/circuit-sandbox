import type { IR, SimState, Gate, GateType } from "./types";

export function createSim(ir: IR): SimState {
  return {
    cur: new Uint8Array(8),
    nxt: new Uint8Array(8),
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
  const cur = new Uint8Array([a, b, 0, 0, 0, 0, 0, 0]);
  return applyGate(g, cur);
}

export function step(s: SimState): void {
  const { cur, nxt, ir } = s;
  nxt.fill(0);

  for (const c of ir.consts) nxt[c.net] = c.value;
  for (const c of ir.clocks) nxt[c.net] = (s.t % c.period) < c.high ? 1 : 0;

  for (const g of ir.gates) nxt[g.out] = applyGate(g, cur);

  for (const d of ir.dffs) {
    nxt[d.q] = cur[d.c] === 0 && nxt[d.c] === 1 ? cur[d.d] : cur[d.q];
  }

  s.cur = nxt;
  s.nxt = cur;
  s.t++;
}
