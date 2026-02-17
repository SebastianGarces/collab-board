"use client";

import { type ReactNode, useRef, useState } from "react";
import { Group, Rect } from "react-konva";

import type { BaseElement } from "@collab/shared/collab";
import { useCanvasStore } from "@/stores/canvas-store";
import { ShapeResizeHandles } from "./shape-resize-handles";
import type { ElementBox, ResizeHandle, ResizeSession } from "./shape-transform";
import { resizeBoxFromHandle } from "./shape-transform";

type RotationSession = {
  startAngle: number; // initial angle of pointer relative to element center
  startRotation: number; // element's rotation at start of drag
};

export type RotationCorner = "nw" | "ne" | "se" | "sw";

export type RotationCursorState = {
  corner: RotationCorner;
  elementRotation: number;
} | null;

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
  onRotate?: (id: string, rotation: number) => void;
  onRotateCursorChange?: (state: RotationCursorState) => void;
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
  onRotate,
  onRotateCursorChange,
  zoomScale = 1,
  onDblClick,
  hideSelectionOutline = false,
  children,
}: InteractiveShapeProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const rotationSessionRef = useRef<RotationSession | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const rotationCornerRef = useRef<RotationCorner | null>(null);

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

  const effectiveDraggable = draggable && !isResizing && !isRotating;

  // For center-pivot rotation: position is top-left + half width/height, offset is half width/height
  const renderX = element.x + groupDragDx + element.width / 2;
  const renderY = element.y + groupDragDy + element.height / 2;

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

  const handleRotateCornerHover = (corner: RotationCorner | null) => {
    rotationCornerRef.current = corner;
    if (corner) {
      onRotateCursorChange?.({ corner, elementRotation: element.rotation ?? 0 });
    } else if (!isRotating) {
      onRotateCursorChange?.(null);
    }
  };

  const beginRotate = (pointer: { x: number; y: number }) => {
    // Calculate angle from element center to pointer
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const angle = (Math.atan2(pointer.y - centerY, pointer.x - centerX) * 180) / Math.PI;
    rotationSessionRef.current = {
      startAngle: angle,
      startRotation: element.rotation ?? 0,
    };
    setIsRotating(true);
  };

  const updateRotate = (pointer: { x: number; y: number }, shiftKey: boolean) => {
    const session = rotationSessionRef.current;
    if (!session) return;
    
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const currentAngle = (Math.atan2(pointer.y - centerY, pointer.x - centerX) * 180) / Math.PI;
    const deltaAngle = currentAngle - session.startAngle;
    let newRotation = session.startRotation + deltaAngle;
    
    // Snap to 15 degree increments when Shift is held
    if (shiftKey) {
      newRotation = Math.round(newRotation / 15) * 15;
    }
    
    // Normalize to 0-360 range
    newRotation = ((newRotation % 360) + 360) % 360;
    
    onRotate?.(element.id, newRotation);

    // Update cursor icon rotation in real-time
    const corner = rotationCornerRef.current;
    if (corner) {
      onRotateCursorChange?.({ corner, elementRotation: newRotation });
    }
  };

  const finishRotate = (_pointer: { x: number; y: number }) => {
    // Don't recalculate rotation here — the last updateRotate already wrote
    // the correct (possibly shift-snapped) value. Just clean up session state.
    rotationSessionRef.current = null;
    setIsRotating(false);
    onRotateCursorChange?.(null);
  };

  const showSingleSelectionOutline =
    isSelected && !multiSelected && !resizable && !hideSelectionOutline;
  const showResizeHandles = isSelected && !multiSelected && resizable;

  return (
    <Group
      x={renderX}
      y={renderY}
      offsetX={element.width / 2}
      offsetY={element.height / 2}
      rotation={element.rotation ?? 0}
      draggable={effectiveDraggable}
      onClick={(e) => {
        const shiftKey = e.evt?.shiftKey ?? false;
        onSelect(element.id, shiftKey);
      }}
      onTap={() => onSelect(element.id, false)}
      onDblClick={onDblClick ? () => onDblClick(element.id) : undefined}
      onDblTap={onDblClick ? () => onDblClick(element.id) : undefined}
      onDragStart={(e) => {
        // Group position is center due to offset, convert back to top-left for tracking
        const topLeftX = e.target.x() - element.width / 2;
        const topLeftY = e.target.y() - element.height / 2;
        startGroupDrag(element.id, topLeftX, topLeftY);
        onDragStart?.(element.id);
      }}
      onDragMove={(e) => {
        const groupDrag = useCanvasStore.getState().groupDrag;
        if (groupDrag && groupDrag.draggedId === element.id) {
          const topLeftX = e.target.x() - element.width / 2;
          const topLeftY = e.target.y() - element.height / 2;
          const dx = topLeftX - groupDrag.startX;
          const dy = topLeftY - groupDrag.startY;
          updateGroupDrag(dx, dy);
        }
      }}
      onDragEnd={(e) => {
        const delta = endGroupDrag();
        if (delta) {
          // Set Group position back to center of final position
          e.target.x(element.x + delta.dx + element.width / 2);
          e.target.y(element.y + delta.dy + element.height / 2);
        }
        // Convert Group center position back to top-left for Yjs storage
        const finalTopLeftX = e.target.x() - element.width / 2;
        const finalTopLeftY = e.target.y() - element.height / 2;
        onDragEnd(element.id, finalTopLeftX, finalTopLeftY);
      }}
      onMouseEnter={(e) => {
        const targetName = e.target.name?.();
        if (targetName === "resize-handle" || targetName === "rotation-zone") return;
        if (effectiveDraggable && !rotationCornerRef.current && !isRotating) {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grab";
        }
      }}
      onMouseLeave={(e) => {
        if (!rotationCornerRef.current && !isRotating) {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }
      }}
    >
      {children}
      {showResizeHandles && (
        <ShapeResizeHandles
          box={{ x: 0, y: 0, width: element.width, height: element.height }}
          rotation={element.rotation ?? 0}
          zoomScale={zoomScale}
          onResizeStart={beginResize}
          onResizeMove={updateResize}
          onResizeEnd={finishResize}
          onRotateStart={onRotate ? beginRotate : undefined}
          onRotateMove={onRotate ? updateRotate : undefined}
          onRotateEnd={onRotate ? finishRotate : undefined}
          onRotateHover={onRotate ? handleRotateCornerHover : undefined}
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
