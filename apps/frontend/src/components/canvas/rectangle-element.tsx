"use client";

import { useRef, useState } from "react";
import { Group, Rect } from "react-konva";

import type { RectangleElement } from "@collab/shared/collab";
import { ShapeResizeHandles } from "./shape-resize-handles";
import type { ElementBox, ResizeHandle, ResizeSession } from "./shape-transform";
import { resizeBoxFromHandle } from "./shape-transform";

type RectangleElementProps = {
  element: RectangleElement;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onResize: (id: string, box: ElementBox) => void;
  draggable: boolean;
  zoomScale: number;
};

export function RectangleShape({
  element,
  isSelected,
  onSelect,
  onDragEnd,
  onResize,
  draggable,
  zoomScale,
}: RectangleElementProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [isResizing, setIsResizing] = useState(false);

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
    onResize(element.id, resizeBoxFromHandle(session, pointer));
  };

  const finishResize = (handle: ResizeHandle, pointer: { x: number; y: number }) => {
    const session = resizeSessionRef.current;
    if (!session || session.handle !== handle) return;
    onResize(element.id, resizeBoxFromHandle(session, pointer));
    resizeSessionRef.current = null;
    setIsResizing(false);
  };

  return (
    <Group
      x={element.x}
      y={element.y}
      draggable={draggable && !isResizing}
      onClick={() => onSelect(element.id)}
      onTap={() => onSelect(element.id)}
      onDragEnd={(e) => {
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
    >
      <Rect
        width={element.width}
        height={element.height}
        fill={element.fill}
        stroke={element.stroke}
        strokeWidth={2}
        cornerRadius={2}
      />
      {isSelected && (
        <ShapeResizeHandles
          box={{ x: 0, y: 0, width: element.width, height: element.height }}
          zoomScale={zoomScale}
          onResizeStart={beginResize}
          onResizeMove={updateResize}
          onResizeEnd={finishResize}
        />
      )}
    </Group>
  );
}
