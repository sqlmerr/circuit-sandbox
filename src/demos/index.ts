import type { Grid2D } from "../core/types";
import { ringNot } from "./ringNot";
import { halfAdder } from "./halfAdder";
import { rsLatch } from "./rsLatch";
import { toggleMemory } from "./memory";
import { fourBitAdder } from "./fourBitAdder";

// Реестр демо-схем: меню «Демо» строит по нему кнопки, а тесты — прогон
// каждой схемы через парсер/симулятор. `build()` каждый раз отдаёт свежий grid,
// поэтому вставка в редактор не мутирует общий экземпляр.
export interface DemoDef {
  id: string;
  label: string;
  hint: string;
  build: () => Grid2D;
}

export const DEMOS: DemoDef[] = [
  { id: "ringNot", label: "Кольцо из двух NOT", hint: "Мигает с периодом 2 тика", build: ringNot },
  { id: "halfAdder", label: "Полусумматор", hint: "XOR + AND, входы — тумблеры", build: halfAdder },
  { id: "rsLatch", label: "RS-триггер", hint: "OR + NOT: set / hold / reset", build: rsLatch },
  { id: "memory", label: "Ячейка памяти", hint: "SWITCH → T-триггер → BULB", build: toggleMemory },
  { id: "fourBitAdder", label: "4-битный сумматор", hint: "8 переключателей → 5 лампочек", build: fourBitAdder },
];
