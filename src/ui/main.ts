import { initState, apply, type State, type Action } from "./state";
import { render } from "./render";
import { screenToGrid, type Viewport } from "./camera";
import { buildPanels, type PanelBind } from "./panel";
import { UndoStack } from "./undo";
import * as tools from "./tools";
import { parse } from "../core/parse";
import { createSim, step as simStep } from "../core/sim";
import { createGrid2D } from "../core/types";
import type { SimState, Grid2D } from "../core/types";
import {
  downloadPNG,
  downloadJSON,
  downloadSVG,
  saveToLocal,
  loadFromLocal,
} from "./fileio";
import {
  loadPrefs,
  savePrefs,
  applyPrefs,
  clampScale,
  UI_SCALE_STEP,
} from "./prefs";

type SimCtx = { sim: SimState; dirty: boolean };

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let state: State = initState();
const undo = new UndoStack();
const simCtx: SimCtx = { sim: createSim(emptyIr()), dirty: false };

const persisted = loadFromLocal();
if (persisted) {
  state = apply(state, { kind: "load", grid: persisted, w: persisted.width, h: persisted.height });
}
undo.commit(state.grid);

function viewport(): Viewport {
  return {
    cam: state.cam,
    cw: Math.floor(canvas.clientWidth),
    ch: Math.floor(canvas.clientHeight),
  };
}

function emptyIr() {
  return {
    width: 0,
    height: 0,
    netCount: 0,
    gates: [],
    clocks: [],
    consts: [],
    switches: [],
    memories: [],
    bulbs: [],
  };
}

// ---- dispatch ----
let panels: PanelBind;
function dispatch(a: Action): void {
  state = apply(state, a);
  // запомнить выбранный инструмент (восстанавливается при перезагрузке)
  if (a.kind === "tool") {
    const p = loadPrefs();
    p.tool = a.tool;
    savePrefs(p);
  }
  syncPanels();
}

function syncPanels(): void {
  panels.selectTool(state.tool);
  panels.selectBrushColor(state.brushColor);
  panels.setErrors([
    ...state.errors.map((e) => ({ severity: "error" as const, message: e.message, cells: e.cells })),
    ...state.warnings.map((w) => ({ severity: "warning" as const, message: w.message, cells: w.cells })),
  ]);
  if (state.stamp) panels.selectStamp(state.stamp.type);
  simPlay.textContent = state.sim.running ? "⏸" : "▶";
}

// ---- live parsing (debounced) ----
let parseTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleParse(): void {
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = setTimeout(doParse, 150);
}
function doParse(): void {
  parseTimer = null;
  const { ir, errors, warnings, netMap } = parse(state.grid);
  state = apply(state, { kind: "parse", ir, errors, warnings, netMap });
  simCtx.dirty = true;
  syncPanels();
}

// ---- sim ----
function rebuildSim(): void {
  simCtx.sim = createSim(state.ir ?? emptyIr());
  simCtx.dirty = false;
  state = apply(state, { kind: "simTick", cur: simCtx.sim.cur, t: simCtx.sim.t, switches: simCtx.sim.switches });
}

function stepOnce(): void {
  if (simCtx.dirty || !state.ir) rebuildSim();
  simStep(simCtx.sim);
  state = apply(state, { kind: "simTick", cur: simCtx.sim.cur, t: simCtx.sim.t, switches: simCtx.sim.switches });
  render(viewport(), state, canvas, ctx);
}

function togglePlay(): void {
  if (simCtx.dirty) rebuildSim();
  const running = !state.sim.running;
  state = apply(state, { kind: "simRunning", on: running });
  syncPanels();
}

function resetSim(): void {
  simCtx.sim = createSim(state.ir ?? emptyIr());
  simCtx.dirty = false;
  state = apply(state, { kind: "simReset" });
  syncPanels();
  render(viewport(), state, canvas, ctx);
}

// ---- load a built-in demo into the editor ----
// Полностью замещает полотно готовой схемой из src/demos: сбрасывает
// симуляцию, пересобирает IR сразу (без debounce) и вписывает камеру.
function loadDemo(build: () => Grid2D): void {
  const grid = build();
  undo.commit(grid);
  state = apply(state, { kind: "mode", mode: "edit" });
  state = apply(state, { kind: "grid", grid });
  saveToLocal(grid);
  syncPanels();
  fitView();
  doParse();
  resetSim();
}

// ---- editing commit wrapper ----
function commitEdit(newGrid: Grid2D | null): void {
  if (!newGrid) return;
  undo.commit(newGrid);
  state = apply(state, { kind: "grid", grid: newGrid });
  scheduleParse();
  saveToLocal(state.grid);
  syncPanels();
}

// ---- pointer handling ----
let spaceDown = false;
let panning = false;
let panStartX = 0;
let panStartY = 0;

function toScreen(e: MouseEvent | WheelEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function inEdit(): boolean {
  return state.mode === "edit";
}

// Клик в run-режиме по источнику с рантайм-значением: переключатель (SWITCH)
// или HIGH-константа. Возвращает вид и индекс компонента в IR.
type RunHit = { kind: "switch"; index: number } | { kind: "high"; index: number };

function runHitAt(gx: number, gy: number): RunHit | null {
  const ir = state.ir;
  if (!ir) return null;
  const inCells = (cells: [number, number][]) => cells.some(([cx, cy]) => cx === gx && cy === gy);
  for (let i = 0; i < ir.switches.length; i++) {
    if (inCells(ir.switches[i].cells)) return { kind: "switch", index: i };
  }
  for (let i = 0; i < ir.consts.length; i++) {
    if (inCells(ir.consts[i].cells)) return { kind: "high", index: i };
  }
  return null;
}

function toggleRunInput(gx: number, gy: number): void {
  const hit = runHitAt(gx, gy);
  if (!hit) return;
  // если после последнего парсинга сим ещё не пересобран — соберём, иначе
  // клик попадёт в устаревший IR/массивы рантайм-состояния
  if (simCtx.dirty) rebuildSim();
  if (hit.kind === "switch") {
    simCtx.sim.switches[hit.index] ^= 1;
    state = apply(state, { kind: "simSwitches", switches: simCtx.sim.switches.slice() });
  } else {
    // HIGH — runtime-тумблер: меняем значение константы на время сессии,
    // пиксели не трогаем (ре-парсинг вернёт value = 1).
    const c = state.ir!.consts[hit.index];
    c.value = c.value ? 0 : 1;
  }
  render(viewport(), state, canvas, ctx);
}

canvas.addEventListener("mousemove", (e) => {
  const [sx, sy] = toScreen(e);
  const [gx, gy] = screenToGrid(viewport(), sx, sy);

  if (spaceDown || panning) {
    dispatch({ kind: "pan", dx: e.clientX - panStartX, dy: e.clientY - panStartY });
    panStartX = e.clientX;
    panStartY = e.clientY;
    render(viewport(), state, canvas, ctx);
    return;
  }

  state = apply(state, { kind: "ghostPos", x: gx, y: gy });
  // ПКМ тянет — стирает, значит призрак кисти показывает «стереть», а не цвет
  state = apply(state, { kind: "ghostErase", on: e.buttons === 2 });
  panels.setCoords(gx, gy);

  // ЛКМ тянет — рисует кистью, ПКМ тянет — стирает
  if (inEdit()) {
    if (e.buttons === 1 && state.tool === "brush") {
      commitEdit(tools.brushAt(state, gx, gy));
    } else if (e.buttons === 2) {
      commitEdit(tools.eraseAt(state, gx, gy));
    }
  }
  render(viewport(), state, canvas, ctx);
});

canvas.addEventListener("mousedown", (e) => {
  const [sx, sy] = toScreen(e);
  const [gx, gy] = screenToGrid(viewport(), sx, sy);

  // middle button: pan
  if (e.button === 1) {
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    // подавить автоскролл браузера
    e.preventDefault();
    return;
  }

  // right button: erase (no camera pan)
  if (e.button === 2) {
    if (inEdit()) commitEdit(tools.eraseAt(state, gx, gy));
    state = apply(state, { kind: "ghostErase", on: true });
    render(viewport(), state, canvas, ctx);
    return;
  }

  if (!inEdit()) {
    // run-режим: клик по SWITCH/HIGH переключает его значение (в т.ч. на паузе)
    if (e.button === 0) toggleRunInput(gx, gy);
    return;
  }

  if (state.tool === "pipette") {
    const a = tools.pipette(state, gx, gy);
    if (a) dispatch(a);
    return;
  }

  switch (state.tool) {
    case "stamp": {
      commitEdit(tools.stampGrid(state, gx, gy));
      break;
    }
    case "brush": {
      commitEdit(tools.brushAt(state, gx, gy));
      break;
    }
  }
  render(viewport(), state, canvas, ctx);
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [sx, sy] = toScreen(e);
  dispatch({ kind: "zoom", delta: e.deltaY, cx: sx, cy: sy });
  render(viewport(), state, canvas, ctx);
});

window.addEventListener("keydown", (e) => {
  // Ввод в поля (размер холста и т.п.): хоткеи канваса не должны срабатывать —
  // иначе набор цифр 1/2/3 экспортирует схему, а пробел включает пан.
  const inField =
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement;
  const resizeOpen =
    typeof resizeOverlay !== "undefined" && !resizeOverlay.classList.contains("hidden");
  if (inField || resizeOpen) {
    if (e.key === "Escape") closeResize();
    else if (e.key === "Enter") applyResize();
    return;
  }
  if (e.code === "Space") {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (spaceDown) return;

  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "z") {
    e.preventDefault();
    const g = e.shiftKey ? undo.redo() : undo.undo();
    if (g) {
      state = apply(state, { kind: "grid", grid: g });
      scheduleParse();
      saveToLocal(state.grid);
      syncPanels();
    }
    return;
  }

  if (e.ctrlKey && k === "s") {
    e.preventDefault();
    downloadPNG(state.grid, "circuit");
    return;
  }

  switch (k) {
    case "p": dispatch({ kind: "tool", tool: "stamp" }); break;
    case "b": dispatch({ kind: "tool", tool: "brush" }); break;
    case "i": dispatch({ kind: "tool", tool: "pipette" }); break;
    case "r": dispatch({ kind: "stampRot" }); break;
    case "escape":
      if (!resizeOverlay.classList.contains("hidden")) closeResize();
      else dispatch({ kind: "stampCancel" });
      break;
    case "enter":
      if (!resizeOverlay.classList.contains("hidden")) applyResize();
      break;
    case ".": if (state.ir) stepOnce(); break;
    // export
    case "1": downloadPNG(state.grid, "circuit"); break;
    case "2": downloadJSON(state.grid); break;
    case "3": downloadSVG(state.grid); break;
    // canvas zoom (centered)
    case "=":
    case "+": zoomAt(1.25); break;
    case "-":
    case "_": zoomAt(1 / 1.25); break;
    // UI scale
    case "]": bumpUiScale(UI_SCALE_STEP); break;
    case "[": bumpUiScale(-UI_SCALE_STEP); break;
    // hide all panels
    case "h": setUiHidden(!loadPrefs().uiHidden); break;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") spaceDown = false;
});

window.addEventListener("mouseup", () => {
  panning = false;
  state = apply(state, { kind: "ghostErase", on: false });
});
window.addEventListener("blur", () => {
  panning = false;
  spaceDown = false;
  state = apply(state, { kind: "ghostErase", on: false });
});

// ---- sim UI ----
const simPlay = document.getElementById("sim-play") as HTMLButtonElement;
const simStepBtn = document.getElementById("sim-step") as HTMLButtonElement;
const simResetBtn = document.getElementById("sim-reset") as HTMLButtonElement;
const speedSlider = document.getElementById("sim-speed-slider") as HTMLInputElement;
const speedVal = document.getElementById("sim-speed-val") as HTMLSpanElement;

simPlay.addEventListener("click", togglePlay);
simStepBtn.addEventListener("click", () => stepOnce());
simResetBtn.addEventListener("click", resetSim);
speedSlider.addEventListener("input", () => {
  const v = Number(speedSlider.value);
  speedVal.textContent = String(v);
  dispatch({ kind: "simSpeed", speed: v });
});

// ---- canvas zoom helpers ----
function zoomAt(factor: number, cx?: number, cy?: number): void {
  const v = viewport();
  // один кодовый путь с колесом мыши: знак delta задаёт направление,
  // сам шаг (с защитой от залипания на целом масштабе) — в редьюсере
  dispatch({ kind: "zoom", delta: factor >= 1 ? -1 : 1, cx: cx ?? v.cw / 2, cy: cy ?? v.ch / 2 });
  render(viewport(), state, canvas, ctx);
}

function fitView(): void {
  const v = viewport();
  const s = Math.max(
    1,
    Math.min(32, Math.floor(Math.min(v.cw / state.grid.width, v.ch / state.grid.height))),
  );
  dispatch({
    kind: "setCam",
    cam: {
      scale: s,
      ox: (v.cw - state.grid.width * s) / 2,
      oy: (v.ch - state.grid.height * s) / 2,
    },
  });
  render(viewport(), state, canvas, ctx);
}

// ---- UI prefs (scale / hide) ----
function bumpUiScale(delta: number): void {
  const p = loadPrefs();
  p.uiScale = clampScale(p.uiScale + delta);
  savePrefs(p);
  applyPrefs(p);
}

function setUiHidden(hidden: boolean): void {
  const p = loadPrefs();
  p.uiHidden = hidden;
  savePrefs(p);
  applyPrefs(p);
}

// ---- view / export buttons ----
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Элемент #${id} не найден`);
  return e as T;
}

el<HTMLButtonElement>("view-zoom-in").addEventListener("click", () => zoomAt(1.25));
el<HTMLButtonElement>("view-zoom-out").addEventListener("click", () => zoomAt(1 / 1.25));
el<HTMLButtonElement>("view-fit").addEventListener("click", fitView);
el<HTMLButtonElement>("ui-smaller").addEventListener("click", () => bumpUiScale(-UI_SCALE_STEP));
el<HTMLButtonElement>("ui-bigger").addEventListener("click", () => bumpUiScale(UI_SCALE_STEP));
el<HTMLButtonElement>("ui-hide").addEventListener("click", () => setUiHidden(true));
el<HTMLButtonElement>("ui-show").addEventListener("click", () => setUiHidden(false));
el<HTMLButtonElement>("exp-png").addEventListener("click", () => downloadPNG(state.grid, "circuit"));
el<HTMLButtonElement>("exp-json").addEventListener("click", () => downloadJSON(state.grid));
el<HTMLButtonElement>("exp-svg").addEventListener("click", () => downloadSVG(state.grid));

// ---- clear all (two-step confirm, undoable via Ctrl+Z) ----
const clearBtn = el<HTMLButtonElement>("tool-clear");
let clearArmed = false;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
function disarmClear(): void {
  clearArmed = false;
  clearBtn.classList.remove("armed");
  clearBtn.textContent = "Очистить";
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}
clearBtn.addEventListener("click", () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.classList.add("armed");
    clearBtn.textContent = "Точно?";
    clearTimer = setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  commitEdit(createGrid2D(state.grid.width, state.grid.height));
  resetSim();
});

// ---- canvas resize dialog ----
const MIN_SIZE = 16;
const MAX_SIZE = 512;
const resizeBtn = el<HTMLButtonElement>("tool-resize");
const resizeOverlay = el("resize-overlay");
const resizeW = el<HTMLInputElement>("resize-w");
const resizeH = el<HTMLInputElement>("resize-h");
const resizeKeep = el<HTMLInputElement>("resize-keep");
const resizeWarn = el("resize-warn");
const anchorBox = el("resize-anchor");
let anchorX = 0;
let anchorY = 0;

function syncAnchorBtns(): void {
  for (const b of anchorBox.querySelectorAll<HTMLButtonElement>(".anchor-btn")) {
    const active = Number(b.dataset.ax) === anchorX && Number(b.dataset.ay) === anchorY;
    b.classList.toggle("active", active);
  }
}

function updateResizeWarn(): void {
  const w = Math.round(Number(resizeW.value));
  const h = Math.round(Number(resizeH.value));
  const shrink =
    resizeKeep.checked && (w < state.grid.width || h < state.grid.height);
  resizeWarn.classList.toggle("hidden", !shrink);
  if (shrink) resizeWarn.textContent = "Новый холст меньше — края схемы будут обрезаны.";
}

function openResize(): void {
  resizeW.value = String(state.grid.width);
  resizeH.value = String(state.grid.height);
  resizeKeep.checked = true;
  anchorX = 0;
  anchorY = 0;
  syncAnchorBtns();
  updateResizeWarn();
  resizeOverlay.classList.remove("hidden");
  resizeW.focus();
  resizeW.select();
}

function closeResize(): void {
  resizeOverlay.classList.add("hidden");
}

function resizeGridWithAnchor(old: Grid2D, newW: number, newH: number): Grid2D {
  const g = createGrid2D(newW, newH);
  if (!resizeKeep.checked) return g;
  // Сдвиг старого содержимого внутри нового холста по якорю:
  // (0,0) — левый верх (координаты сохраняются), (0.5,0.5) — центр и т.д.
  const ox = Math.round((newW - old.width) * anchorX);
  const oy = Math.round((newH - old.height) * anchorY);
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(newW, ox + old.width);
  const y1 = Math.min(newH, oy + old.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      g.data[y * newW + x] = old.data[(y - oy) * old.width + (x - ox)];
    }
  }
  return g;
}

function applyResize(): void {
  const w = Math.round(Number(resizeW.value));
  const h = Math.round(Number(resizeH.value));
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIZE || w > MAX_SIZE || h < MIN_SIZE || h > MAX_SIZE) {
    resizeWarn.classList.remove("hidden");
    resizeWarn.textContent = `Размер — целые числа ${MIN_SIZE}..${MAX_SIZE}.`;
    return;
  }
  if (w === state.grid.width && h === state.grid.height) {
    closeResize();
    return;
  }
  closeResize();
  // Режим — в edit, камеру не трогаем (пользователь остаётся где был).
  state = apply(state, { kind: "mode", mode: "edit" });
  commitEdit(resizeGridWithAnchor(state.grid, w, h));
  resetSim();
}

resizeBtn.addEventListener("click", openResize);
el<HTMLButtonElement>("resize-cancel").addEventListener("click", closeResize);
el<HTMLButtonElement>("resize-apply").addEventListener("click", applyResize);
resizeOverlay.addEventListener("mousedown", (e) => {
  if (e.target === resizeOverlay) closeResize();
});
resizeW.addEventListener("input", updateResizeWarn);
resizeH.addEventListener("input", updateResizeWarn);
resizeKeep.addEventListener("change", updateResizeWarn);
anchorBox.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".anchor-btn");
  if (!b) return;
  anchorX = Number(b.dataset.ax);
  anchorY = Number(b.dataset.ay);
  syncAnchorBtns();
});
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  b.addEventListener("click", () => {
    const [w, h] = b.dataset.preset!.split("x").map(Number);
    resizeW.value = String(w);
    resizeH.value = String(h);
    updateResizeWarn();
  });
}
panels = buildPanels((a) => dispatch(a));
panels.onLoadDemo = (build) => loadDemo(build);
panels.onErrorClick = (cells) => {
  if (cells.length === 0) return;
  const [x, y] = cells[0];
  const v = viewport();
  const scale = Math.max(state.cam.scale, 4);
  dispatch({ kind: "setCam", cam: { scale, ox: v.cw / 2 - x * scale, oy: v.ch / 2 - y * scale } });
  render(viewport(), state, canvas, ctx);
};

// ---- resize ----
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", () => {
  resize();
  render(viewport(), state, canvas, ctx);
});

// ---- rAF loop ----
let lastTick = 0;
function loop(now: number): void {
  const interval = 1000 / Math.max(1, state.sim.speed);
  if (state.sim.running && now - lastTick >= interval) {
    lastTick = now;
    stepOnce();
  }
  render(viewport(), state, canvas, ctx);
  requestAnimationFrame(loop);
}

resize();
const prefs = loadPrefs();
applyPrefs(prefs);
// восстановить выбранный при прошлой сессии инструмент (кистью рисуем чаще,
// поэтому по умолчанию — кисть)
state = apply(state, { kind: "tool", tool: prefs.tool });
syncPanels();
// спавн камеры: вся схема по центру экрана
fitView();
scheduleParse();
requestAnimationFrame(loop);

