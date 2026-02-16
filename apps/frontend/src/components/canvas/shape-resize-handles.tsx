"use client";

import { Circle, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

import type { ElementBox, ResizeHandle } from "./shape-transform";

type Pointer = { x: number; y: number };

type ShapeResizeHandlesProps = {
  box: ElementBox;
  zoomScale: number;
  onResizeStart: (handle: ResizeHandle, pointer: Pointer) => void;
  onResizeMove: (handle: ResizeHandle, pointer: Pointer) => void;
  onResizeEnd: (handle: ResizeHandle, pointer: Pointer) => void;
};

function getWorldPointer(event: KonvaEventObject<DragEvent>): Pointer | null {
  const stage = event.target.getStage();
  if (!stage) return null;
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  const scaleX = stage.scaleX() || 1;
  const scaleY = stage.scaleY() || 1;
  return {
    x: (pos.x - stage.x()) / scaleX,
    y: (pos.y - stage.y()) / scaleY,
  };
}

function getHandlePositions(width: number, height: number): Record<ResizeHandle, Pointer> {
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    nw: { x: 0, y: 0 },
    n: { x: halfW, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: halfH },
    se: { x: width, y: height },
    s: { x: halfW, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: halfH },
  };
}

const HANDLE_ORDER: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

export function ShapeResizeHandles({
  box,
  zoomScale,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: ShapeResizeHandlesProps) {
  const visualScale = Math.max(zoomScale, 0.2);
  const handleRadius = 6 / visualScale;
  const borderPadding = 3 / visualScale;
  const positions = getHandlePositions(box.width, box.height);

  return (
    <>
      <Rect
        x={-borderPadding}
        y={-borderPadding}
        width={box.width + borderPadding * 2}
        height={box.height + borderPadding * 2}
        stroke="#60a5fa"
        strokeWidth={2 / visualScale}
        dash={[6 / visualScale, 3 / visualScale]}
        listening={false}
      />
      {HANDLE_ORDER.map((handle) => {
        const position = positions[handle];
        return (
          <Circle
            key={handle}
            x={position.x}
            y={position.y}
            radius={handleRadius}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={1.5 / visualScale}
            draggable
            dragOnTop={false}
            onMouseEnter={(event) => {
              const container = event.target.getStage()?.container();
              if (container) container.style.cursor = HANDLE_CURSOR[handle];
            }}
            onMouseLeave={(event) => {
              const container = event.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
            onDragStart={(event) => {
              event.cancelBubble = true;
              const pointer = getWorldPointer(event);
              if (pointer) onResizeStart(handle, pointer);
            }}
            onDragMove={(event) => {
              event.cancelBubble = true;
              const pointer = getWorldPointer(event);
              if (pointer) onResizeMove(handle, pointer);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              const pointer = getWorldPointer(event);
              if (pointer) onResizeEnd(handle, pointer);
              event.target.position(position);
            }}
          />
        );
      })}
    </>
  );
}

