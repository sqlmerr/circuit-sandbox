import { toHex, WIRE_COUNT } from "../core/palette";
import type { Action, StampType, ToolName } from "./state";
import { STAMP_DEFS } from "./state";
import { loadPrefs, savePrefs } from "./prefs";
import stampIcon from "../assets/stamp.svg?raw";
import brushIcon from "../assets/brush.svg?raw";
import pipetteIcon from "../assets/pipette.svg?raw";

export interface PanelBind {
  selectTool: (t: ToolName) => void;
  selectBrushNet: (net: number) => void;
  selectStamp: (t: StampType) => void;
  setErrors: (errors: { severity: "error" | "warning"; message: string; cells: [number, number][] }[]) => void;
  setCoords: (x: number, y: number) => void;
  setSimRunning: (on: boolean) => void;
  onErrorClick: (cells: [number, number][]) => void;
}

export type PanelDispatch = (a: Action) => void;

export function buildPanels(dispatch: PanelDispatch): PanelBind {
  const toolBtns: Record<ToolName, HTMLButtonElement> = {
    stamp: el<HTMLButtonElement>("tool-stamp"),
    brush: el<HTMLButtonElement>("tool-brush"),
    pipette: el<HTMLButtonElement>("tool-pipette"),
  };

  const toolIcons: Record<ToolName, string> = {
    stamp: stampIcon,
    brush: brushIcon,
    pipette: pipetteIcon,
  };

  for (const [tool, btn] of Object.entries(toolBtns)) {
    btn.addEventListener("click", () => {
      dispatch({ kind: "tool", tool: tool as ToolName });
    });
    // буква-заглушка -> инлайн-иконка (инлайн нужен, чтобы currentColor
    // внутри SVG наследовал белый цвет кнопки; через <img> он был бы чёрным)
    btn.innerHTML = toolIcons[tool as ToolName];
  }

  const stampsPanel = el("panel-stamps");

  const wirePal = el("wire-palette");
  for (let net = 0; net < WIRE_COUNT; net++) {
    const idx = net + 2;
    const sw = document.createElement("button");
    sw.className = "swatch";
    sw.dataset.net = String(net);
    sw.title = `Сеть ${net}`;
    sw.innerHTML = `<span style="background:${toHex(idx)}"></span>`;
    sw.addEventListener("click", () => dispatch({ kind: "brushNet", net }));
    wirePal.appendChild(sw);
  }

  const stampPal = el("stamp-palette");
  for (const def of STAMP_DEFS) {
    const b = document.createElement("button");
    b.className = "stamp-btn";
    b.textContent = def.label;
    b.addEventListener("click", () => dispatch({ kind: "stampType", stampType: def.type }));
    stampPal.appendChild(b);
  }

  const errorList = el("error-list");
  const errorsPanel = el("panel-errors");

  // сворачивание панелей (состояние — в localStorage)
  for (const panel of document.querySelectorAll<HTMLElement>(".panel[data-panel]")) {
    const btn = panel.querySelector<HTMLButtonElement>(".collapse-btn");
    if (!btn) continue;
    btn.addEventListener("click", () => {
      const id = panel.dataset.panel!;
      const collapsed = !panel.classList.contains("collapsed");
      panel.classList.toggle("collapsed", collapsed);
      btn.textContent = collapsed ? "▸" : "▾";
      const prefs = loadPrefs();
      prefs.collapsed[id] = collapsed;
      savePrefs(prefs);
    });
  }

  const coordsDisplay = el("coords-display");

  const bind: PanelBind = {
    selectTool(t) {
      for (const [tool, btn] of Object.entries(toolBtns)) {
        btn.classList.toggle("active", tool === t);
      }
      // меню штампов видно только при активном инструменте штампа
      stampsPanel.classList.toggle("hidden", t !== "stamp");
    },
    selectBrushNet(net) {
      for (const s of wirePal.querySelectorAll<HTMLButtonElement>("button.swatch")) {
        s.classList.toggle("active", Number(s.dataset.net) === net);
      }
    },
    selectStamp(t) {
      for (const b of stampPal.querySelectorAll<HTMLButtonElement>("button.stamp-btn")) {
        b.classList.toggle("active", b.textContent === STAMP_DEFS.find((d) => d.type === t)?.label);
      }
    },
    setErrors(list) {
      errorList.innerHTML = "";
      for (const e of list) {
        const div = document.createElement("div");
        div.className = e.severity === "error" ? "error-item" : "warning-item";
        div.textContent = e.message;
        if (e.severity === "error") {
          div.addEventListener("click", () => bind.onErrorClick(e.cells));
        }
        errorList.appendChild(div);
      }
      // пустая панель ошибок полностью прячется, чтобы не занимать место
      errorsPanel.classList.toggle("hidden", list.length === 0);
    },
    setCoords(x, y) {
      coordsDisplay.textContent = x < 0 ? "X: — Y: —" : `X: ${x} Y: ${y}`;
    },
    setSimRunning() {
      /* button text updated by main */
    },
    onErrorClick: () => {},
  };

  return bind;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Элемент #${id} не найден`);
  return e as T;
}
