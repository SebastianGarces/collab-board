"use client";

import { type ReactNode, useRef, useState } from "react";
import { Group, Rect } from "react-konva";

import type { BaseElement } from "@collab/shared/collab";
import { useCanvasStore } from "@/stores/canvas-store";
import { ShapeResizeHandles } from "./shape-resize-handles";
import type { ElementBox, ResizeHandle, ResizeSession } from "./shape-transform";
import { resizeBoxFromHandle } from "./shape-transform";

type InteractiveShapeProps = {
  element: BaseElement;
  isSelected: boolean;
  multiSelected: boolean;
  draggable: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onDragStart?: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  resizable?: boolean;
  onResize?: (id: string, box: ElementBox) => void;
  zoomScale?: number;
  onDblClick?: (id: string) => void;
  hideSelectionOutline?: boolean;
  children: ReactNode;
};

export function InteractiveShape({
  element,
  isSelected,
  multiSelected,
  draggable,
  onSelect,
  onDragStart,
  onDragEnd,
  resizable = false,
  onResize,
  zoomScale = 1,
  onDblClick,
  hideSelectionOutline = false,
  children,
}: InteractiveShapeProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const startGroupDrag = useCanvasStore((s) => s.startGroupDrag);
  const updateGroupDrag = useCanvasStore((s) => s.updateGroupDrag);
  const endGroupDrag = useCanvasStore((s) => s.endGroupDrag);

  const groupDragDx = useCanvasStore((s) =>
    s.groupDrag &&
    s.groupDrag.draggedId !== element.id &&
    s.selectedElementIds.has(element.id)
      ? s.groupDrag.dx
      : 0
  );
  const groupDragDy = useCanvasStore((s) =>
    s.groupDrag &&
    s.groupDrag.draggedId !== element.id &&
    s.selectedElementIds.has(element.id)
      ? s.groupDrag.dy
      : 0
  );

  const effectiveDraggable = draggable && !isResizing;

  const renderX = element.x + groupDragDx;
  const renderY = element.y + groupDragDy;

  const beginResize = (handle: ResizeHandle, pointer: { x: number; y: number }) => {
    resizeSessionRef.current = {
      handle,
      startPointer: pointer,
      startBox: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      },
    };
    setIsResizing(true);
  };

  const updateResize = (handle: ResizeHandle, pointer: { x: number; y: number }) => {
    const session = resizeSessionRef.current;
    if (!session || session.handle !== handle) return;
    onResize?.(element.id, resizeBoxFromHandle(session, pointer));
  };

  const finishResize = (handle: ResizeHandle, pointer: { x: number; y: number }) => {
    const session = resizeSessionRef.current;
    if (!session || session.handle !== handle) return;
    onResize?.(element.id, resizeBoxFromHandle(session, pointer));
    resizeSessionRef.current = null;
    setIsResizing(false);
  };

  const showSingleSelectionOutline =
    isSelected && !multiSelected && !resizable && !hideSelectionOutline;
  const showResizeHandles = isSelected && !multiSelected && resizable;

  return (
    <Group
      x={renderX}
      y={renderY}
      draggable={effectiveDraggable}
      onClick={(e) => {
        const shiftKey = e.evt?.shiftKey ?? false;
        onSelect(element.id, shiftKey);
      }}
      onTap={() => onSelect(element.id, false)}
      onDblClick={onDblClick ? () => onDblClick(element.id) : undefined}
      onDblTap={onDblClick ? () => onDblClick(element.id) : undefined}
      onDragStart={(e) => {
        startGroupDrag(element.id, e.target.x(), e.target.y());
        onDragStart?.(element.id);
      }}
      onDragMove={(e) => {
        const groupDrag = useCanvasStore.getState().groupDrag;
        if (groupDrag && groupDrag.draggedId === element.id) {
          const dx = e.target.x() - groupDrag.startX;
          const dy = e.target.y() - groupDrag.startY;
          updateGroupDrag(dx, dy);
        }
      }}
      onDragEnd={(e) => {
        const delta = endGroupDrag();
        if (delta) {
          e.target.x(element.x + delta.dx);
          e.target.y(element.y + delta.dy);
        }
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
      onMouseEnter={(e) => {
        if (effectiveDraggable) {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grab";
        }
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "";
      }}
    >
      {children}
      {showResizeHandles && (
        <ShapeResizeHandles
          box={{ x: 0, y: 0, width: element.width, height: element.height }}
          zoomScale={zoomScale}
          onResizeStart={beginResize}
          onResizeMove={updateResize}
          onResizeEnd={finishResize}
        />
      )}
      {showSingleSelectionOutline && (
        <Rect
          x={-3}
          y={-3}
          width={element.width + 6}
          height={element.height + 6}
          stroke="#60a5fa"
          strokeWidth={2}
          cornerRadius={6}
          dash={[6, 3]}
          listening={false}
        />
      )}
    </Group>
  );
}
