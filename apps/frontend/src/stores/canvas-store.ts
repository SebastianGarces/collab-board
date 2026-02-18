import { create } from "zustand";

type GroupDrag = {
  draggedId: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  childIds: ReadonlySet<string>;
};

type CanvasStoreState = {
  selectedElementIds: ReadonlySet<string>;
  groupDrag: GroupDrag | null;
  dropTargetFrameId: string | null;
};

type CanvasStoreActions = {
  selectElement: (id: string, shiftKey: boolean) => void;
  setSelectedElementIds: (ids: ReadonlySet<string>) => void;
  clearSelection: () => void;
  startGroupDrag: (draggedId: string, startX: number, startY: number, childIds?: string[]) => void;
  updateGroupDrag: (dx: number, dy: number) => void;
  endGroupDrag: () => { dx: number; dy: number } | null;
  setDropTargetFrameId: (id: string | null) => void;
};

export type CanvasStore = CanvasStoreState & CanvasStoreActions;

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  selectedElementIds: new Set<string>(),
  groupDrag: null,
  dropTargetFrameId: null,

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

  startGroupDrag: (draggedId, startX, startY, childIds = []) => {
    const { selectedElementIds } = get();
    const hasMultiSelect = selectedElementIds.size > 1 && selectedElementIds.has(draggedId);
    const hasChildren = childIds.length > 0;
    if (hasMultiSelect || hasChildren) {
      set({ groupDrag: { draggedId, startX, startY, dx: 0, dy: 0, childIds: new Set(childIds) } });
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
    set({ groupDrag: null, dropTargetFrameId: null });
    if (!groupDrag) return null;
    return { dx: groupDrag.dx, dy: groupDrag.dy };
  },

  setDropTargetFrameId: (id) => {
    set({ dropTargetFrameId: id });
  },
}));
