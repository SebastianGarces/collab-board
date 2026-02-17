"use client";

import { type ReactNode, useRef, useState } from "react";
import { Group, Rect } from "react-konva";

import type { BaseElement } from "@collab/shared/collab";
import { ShapeResizeHandles } from "./shape-resize-handles";
import type { ElementBox, ResizeHandle, ResizeSession } from "./shape-transform";
import { resizeBoxFromHandle } from "./shape-transform";

type InteractiveShapeProps = {
  element: BaseElement;
  isSelected: boolean;
  draggable: boolean;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  resizable?: boolean;
  onResize?: (id: string, box: ElementBox) => void;
  zoomScale?: number;
  onDblClick?: (id: string) => void;
  children: ReactNode;
};

export function InteractiveShape({
  element,
  isSelected,
  draggable,
  onSelect,
  onDragEnd,
  resizable = false,
  onResize,
  zoomScale = 1,
  onDblClick,
  children,
}: InteractiveShapeProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const effectiveDraggable = draggable && !isResizing;

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

  return (
    <Group
      x={element.x}
      y={element.y}
      draggable={effectiveDraggable}
      onClick={() => onSelect(element.id)}
      onTap={() => onSelect(element.id)}
      onDblClick={onDblClick ? () => onDblClick(element.id) : undefined}
      onDblTap={onDblClick ? () => onDblClick(element.id) : undefined}
      onDragEnd={(e) => {
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
      {isSelected && resizable && (
        <ShapeResizeHandles
          box={{ x: 0, y: 0, width: element.width, height: element.height }}
          zoomScale={zoomScale}
          onResizeStart={beginResize}
          onResizeMove={updateResize}
          onResizeEnd={finishResize}
        />
      )}
      {isSelected && !resizable && (
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
