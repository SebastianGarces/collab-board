"use client";

import { memo } from "react";
import { Circle, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

import type { ElementBox, ResizeHandle } from "./shape-transform";

type Pointer = { x: number; y: number };

type ShapeResizeHandlesProps = {
  box: ElementBox;
  rotation: number;
  zoomScale: number;
  onResizeStart: (handle: ResizeHandle, pointer: Pointer) => void;
  onResizeMove: (handle: ResizeHandle, pointer: Pointer) => void;
  onResizeEnd: (handle: ResizeHandle, pointer: Pointer) => void;
  onRotateStart?: (pointer: Pointer) => void;
  onRotateMove?: (pointer: Pointer, shiftKey: boolean) => void;
  onRotateEnd?: (pointer: Pointer) => void;
  onRotateHover?: (corner: RotationCorner | null) => void;
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

const CURSOR_CYCLE = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const;

const HANDLE_BASE_ANGLE: Record<ResizeHandle, number> = {
  n: 0, ne: 45, e: 90, se: 135,
  s: 180, sw: 225, w: 270, nw: 315,
};

function getRotatedCursor(handle: ResizeHandle, rotation: number): string {
  const effectiveAngle = ((HANDLE_BASE_ANGLE[handle] + rotation) % 360 + 360) % 360;
  const index = Math.round(effectiveAngle / 45) % 4;
  return CURSOR_CYCLE[index];
}

// Corners that get rotation zones
type RotationCorner = "nw" | "ne" | "se" | "sw";
const ROTATION_CORNERS: RotationCorner[] = ["nw", "ne", "se", "sw"];

export const ShapeResizeHandles = memo(function ShapeResizeHandles({
  box,
  rotation,
  zoomScale,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
  onRotateHover,
}: ShapeResizeHandlesProps) {
  const visualScale = Math.max(zoomScale, 0.2);
  const handleRadius = 6 / visualScale;
  const borderPadding = 3 / visualScale;
  const positions = getHandlePositions(box.width, box.height);

  const rotationZoneSize = 16 / visualScale;
  const rotationZoneOffset = 8 / visualScale; // distance from corner

  // Get rotation zone positions outside corners
  const getRotationZonePosition = (corner: RotationCorner): { x: number; y: number } => {
    const offset = rotationZoneOffset;
    const size = rotationZoneSize;
    switch (corner) {
      case "nw":
        return { x: -offset - size, y: -offset - size };
      case "ne":
        return { x: box.width + offset, y: -offset - size };
      case "se":
        return { x: box.width + offset, y: box.height + offset };
      case "sw":
        return { x: -offset - size, y: box.height + offset };
    }
  };

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
      {/* Rotation zones - render before resize handles so handles take precedence */}
      {onRotateStart && onRotateMove && onRotateEnd &&
        ROTATION_CORNERS.map((corner) => {
          const zonePos = getRotationZonePosition(corner);
          let isDragging = false;
          return (
            <Rect
              key={`rotate-${corner}`}
              name="rotation-zone"
              x={zonePos.x}
              y={zonePos.y}
              width={rotationZoneSize}
              height={rotationZoneSize}
              fill="transparent"
              draggable
              dragOnTop={false}
              onMouseEnter={(event) => {
                const container = event.target.getStage()?.container();
                if (container) container.style.cursor = "none";
                onRotateHover?.(corner);
              }}
              onMouseLeave={(event) => {
                // Don't reset during active drag — cursor managed by page-level state
                if (isDragging) return;
                const container = event.target.getStage()?.container();
                if (container) container.style.cursor = "default";
                onRotateHover?.(null);
              }}
              onDragStart={(event) => {
                isDragging = true;
                event.cancelBubble = true;
                const container = event.target.getStage()?.container();
                if (container) container.style.cursor = "none";
                const pointer = getWorldPointer(event);
                if (pointer) onRotateStart(pointer);
              }}
              onDragMove={(event) => {
                event.cancelBubble = true;
                const pointer = getWorldPointer(event);
                const shiftKey = event.evt?.shiftKey ?? false;
                if (pointer) onRotateMove(pointer, shiftKey);
              }}
              onDragEnd={(event) => {
                isDragging = false;
                event.cancelBubble = true;
                const container = event.target.getStage()?.container();
                if (container) container.style.cursor = "default";
                const pointer = getWorldPointer(event);
                if (pointer) onRotateEnd(pointer);
                event.target.position(zonePos);
              }}
            />
          );
        })}
      {/* Resize handles - render after rotation zones to take cursor priority */}
      {HANDLE_ORDER.map((handle) => {
        const position = positions[handle];
        return (
          <Circle
            key={handle}
            name="resize-handle"
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
              if (container) container.style.cursor = getRotatedCursor(handle, rotation);
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
});
