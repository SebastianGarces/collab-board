import { create } from "zustand";

type GroupDrag = {
  draggedId: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
};

type CanvasStoreState = {
  selectedElementIds: ReadonlySet<string>;
  groupDrag: GroupDrag | null;
};

type CanvasStoreActions = {
  selectElement: (id: string, shiftKey: boolean) => void;
  setSelectedElementIds: (ids: ReadonlySet<string>) => void;
  clearSelection: () => void;
  startGroupDrag: (draggedId: string, startX: number, startY: number) => void;
  updateGroupDrag: (dx: number, dy: number) => void;
  endGroupDrag: () => { dx: number; dy: number } | null;
};

export type CanvasStore = CanvasStoreState & CanvasStoreActions;

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  selectedElementIds: new Set<string>(),
  groupDrag: null,

  selectElement: (id, shiftKey) => {
    set((state) => {
      if (shiftKey) {
        const next = new Set(state.selectedElementIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedElementIds: next };
      }
      return { selectedElementIds: new Set([id]) };
    });
  },

  setSelectedElementIds: (ids) => {
    set({ selectedElementIds: ids });
  },

  clearSelection: () => {
    set({ selectedElementIds: new Set<string>() });
  },

  startGroupDrag: (draggedId, startX, startY) => {
    const { selectedElementIds } = get();
    if (selectedElementIds.size > 1 && selectedElementIds.has(draggedId)) {
      set({ groupDrag: { draggedId, startX, startY, dx: 0, dy: 0 } });
    }
  },

  updateGroupDrag: (dx, dy) => {
    set((state) => {
      if (!state.groupDrag) return state;
      return { groupDrag: { ...state.groupDrag, dx, dy } };
    });
  },

  endGroupDrag: () => {
    const { groupDrag } = get();
    set({ groupDrag: null });
    if (!groupDrag) return null;
    return { dx: groupDrag.dx, dy: groupDrag.dy };
  },
}));
