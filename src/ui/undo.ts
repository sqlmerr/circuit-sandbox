import type { Grid2D } from "../core/types";
import { copyGrid2D } from "../core/types";

const LIMIT = 64;

export class UndoStack {
  private stack: Grid2D[] = [];
  private index = -1;

  commit(grid: Grid2D): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(copyGrid2D(grid));
    this.index++;
    if (this.stack.length > LIMIT) {
      this.stack.shift();
      this.index--;
    }
  }

  canUndo(): boolean {
    return this.index - 1 >= 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  undo(): Grid2D | null {
    if (!this.canUndo()) return null;
    this.index--;
    return copyGrid2D(this.stack[this.index]);
  }

  redo(): Grid2D | null {
    if (!this.canRedo()) return null;
    this.index++;
    return copyGrid2D(this.stack[this.index]);
  }
}
