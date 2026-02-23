import type { BoardElement } from "@collab/shared/collab";

const DEFAULT_CELL_SIZE = 200;

export type AABB = { minX: number; minY: number; maxX: number; maxY: number };

function elementAABB(el: BoardElement): AABB {
  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + el.width,
    maxY: el.y + el.height,
  };
}

export type GetAABB = (el: BoardElement) => AABB;

function cellKey(cx: number, cy: number): number {
  // Cantor-style pairing with signed support
  const a = cx >= 0 ? cx * 2 : -cx * 2 - 1;
  const b = cy >= 0 ? cy * 2 : -cy * 2 - 1;
  return ((a + b) * (a + b + 1)) / 2 + b;
}

export class SpatialIndex {
  private cells = new Map<number, Set<string>>();
  private elementCells = new Map<string, number[]>();
  private elementsById = new Map<string, BoardElement>();
  private cellSize: number;
  private getAABB: GetAABB = elementAABB;

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  private aabb(el: BoardElement): AABB {
    return this.getAABB(el);
  }

  setGetAABB(getAABB?: GetAABB) {
    this.getAABB = getAABB ?? elementAABB;
  }

  private getCells(aabb: AABB): number[] {
    const cs = this.cellSize;
    const minCX = Math.floor(aabb.minX / cs);
    const minCY = Math.floor(aabb.minY / cs);
    const maxCX = Math.floor(aabb.maxX / cs);
    const maxCY = Math.floor(aabb.maxY / cs);

    const keys: number[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        keys.push(cellKey(cx, cy));
      }
    }
    return keys;
  }

  insert(el: BoardElement) {
    const aabb = this.aabb(el);
    const cells = this.getCells(aabb);
    this.elementCells.set(el.id, cells);
    this.elementsById.set(el.id, el);

    for (const key of cells) {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(el.id);
    }
  }

  remove(id: string) {
    const prevCells = this.elementCells.get(id);
    if (prevCells) {
      for (const key of prevCells) {
        const set = this.cells.get(key);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.cells.delete(key);
        }
      }
    }
    this.elementCells.delete(id);
    this.elementsById.delete(id);
  }

  update(el: BoardElement) {
    this.remove(el.id);
    this.insert(el);
  }

  queryRect(bounds: AABB, excludeIds?: Set<string>): BoardElement[] {
    const cells = this.getCells(bounds);
    const seen = new Set<string>();
    const results: BoardElement[] = [];

    for (const key of cells) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const id of set) {
        if (seen.has(id)) continue;
        if (excludeIds?.has(id)) continue;
        seen.add(id);

        const el = this.elementsById.get(id);
        if (!el) continue;

        const aabb = this.aabb(el);
        if (
          aabb.maxX >= bounds.minX &&
          aabb.minX <= bounds.maxX &&
          aabb.maxY >= bounds.minY &&
          aabb.minY <= bounds.maxY
        ) {
          results.push(el);
        }
      }
    }

    return results;
  }

  queryPoint(x: number, y: number, radius: number, excludeIds?: Set<string>): BoardElement[] {
    return this.queryRect(
      {
        minX: x - radius,
        minY: y - radius,
        maxX: x + radius,
        maxY: y + radius,
      },
      excludeIds,
    );
  }

  /** Returns elements whose bounding box contains (x, y), ordered by insertion. */
  queryPointHit(x: number, y: number, excludeIds?: Set<string>): BoardElement[] {
    const key = cellKey(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    const set = this.cells.get(key);
    if (!set) return [];
    const results: BoardElement[] = [];
    for (const id of set) {
      if (excludeIds?.has(id)) continue;
      const el = this.elementsById.get(id);
      if (!el) continue;
      const aabb = this.aabb(el);
      if (x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY) {
        results.push(el);
      }
    }
    return results;
  }

  get(id: string): BoardElement | undefined {
    return this.elementsById.get(id);
  }

  get size(): number {
    return this.elementsById.size;
  }

  clear() {
    this.cells.clear();
    this.elementCells.clear();
    this.elementsById.clear();
  }

  /** Full rebuild from an array of elements */
  rebuild(elements: BoardElement[]) {
    this.clear();
    for (const el of elements) {
      this.insert(el);
    }
  }

  /**
   * Incremental update: sync the index with the latest elements array.
   * When getAABB is provided, connectors use path-based bounds for hit testing.
   * Returns true if the index was changed.
   */
  sync(elements: BoardElement[], getAABB?: GetAABB): boolean {
    this.setGetAABB(getAABB);
    const newIds = new Set<string>();
    let changed = false;

    for (const el of elements) {
      newIds.add(el.id);
      const existing = this.elementsById.get(el.id);
      if (!existing) {
        this.insert(el);
        changed = true;
      } else if (
        el.type === "connector" ||
        existing.x !== el.x ||
        existing.y !== el.y ||
        existing.width !== el.width ||
        existing.height !== el.height
      ) {
        this.update(el);
        changed = true;
      } else if (existing !== el) {
        // Same geometry but different object reference - update the stored ref
        this.elementsById.set(el.id, el);
      }
    }

    // Remove stale elements
    for (const id of this.elementsById.keys()) {
      if (!newIds.has(id)) {
        this.remove(id);
        changed = true;
      }
    }

    return changed;
  }
}
