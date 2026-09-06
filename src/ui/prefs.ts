export interface UiPrefs {
  collapsed: Record<string, boolean>;
  uiScale: number;
  uiHidden: boolean;
  tool: "stamp" | "brush" | "pipette";
}

const KEY = "pixel-logic-ui";

export const UI_SCALE_MIN = 0.6;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_STEP = 0.1;

export function defaultPrefs(): UiPrefs {
  return { collapsed: {}, uiScale: 1, uiHidden: false, tool: "brush" };
}

export function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrefs();
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      collapsed: p.collapsed ?? {},
      uiScale: clampScale(p.uiScale ?? 1),
      uiHidden: p.uiHidden ?? false,
      tool: p.tool === "stamp" || p.tool === "pipette" || p.tool === "brush" ? p.tool : "brush",
    };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function clampScale(v: number): number {
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, Math.round(v * 10) / 10));
}

export function applyPrefs(p: UiPrefs): void {
  document.documentElement.style.setProperty("--ui-scale", String(p.uiScale));
  document.body.classList.toggle("hide-ui", p.uiHidden);
  for (const panel of document.querySelectorAll<HTMLElement>(".panel[data-panel]")) {
    const id = panel.dataset.panel!;
    const collapsed = p.collapsed[id] ?? false;
    panel.classList.toggle("collapsed", collapsed);
    const btn = panel.querySelector<HTMLButtonElement>(".collapse-btn");
    if (btn) btn.textContent = collapsed ? "▸" : "▾";
  }
  const scaleVal = document.getElementById("ui-scale-val");
  if (scaleVal) scaleVal.textContent = `${Math.round(p.uiScale * 100)}%`;
}
