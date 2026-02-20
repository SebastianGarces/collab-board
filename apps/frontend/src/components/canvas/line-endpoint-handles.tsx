"use client";

import { memo } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle } from "react-konva";

import { useCanvasStore } from "@/stores/canvas-store";

type Pointer = { x: number; y: number };

type LineEndpointHandlesProps = {
  points: number[];
  onEndpointDragStart?: () => void;
  onEndpointDrag: (endpointIndex: number, worldX: number, worldY: number) => void;
  onEndpointDragEnd: (endpointIndex: number, worldX: number, worldY: number) => void;
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

export const LineEndpointHandles = memo(function LineEndpointHandles({
  points,
  onEndpointDragStart,
  onEndpointDrag,
  onEndpointDragEnd,
}: LineEndpointHandlesProps) {
  const zoomScale = useCanvasStore((s) => s.zoomScale);
  if (points.length < 4) return null;

  const visualScale = Math.max(zoomScale, 0.2);
  const handleRadius = 7 / visualScale;

  const endpoints = [
    { x: points[0], y: points[1], index: 0 },
    { x: points[2], y: points[3], index: 1 },
  ];

  const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    onEndpointDragStart?.();
  };

  const handleDragMove = (e: KonvaEventObject<DragEvent>, index: number) => {
    e.cancelBubble = true;
    const pointer = getWorldPointer(e);
    if (pointer) onEndpointDrag(index, pointer.x, pointer.y);
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>, ep: { x: number; y: number; index: number }) => {
    e.cancelBubble = true;
    const pointer = getWorldPointer(e);
    if (pointer) onEndpointDragEnd(ep.index, pointer.x, pointer.y);
    e.target.position({ x: ep.x, y: ep.y });
  };

  return (
    <>
      {endpoints.map((ep) => (
        <Circle
          key={ep.index}
          x={ep.x}
          y={ep.y}
          radius={handleRadius}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={1.5 / visualScale}
          draggable
          dragOnTop={false}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "crosshair";
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "default";
          }}
          onDragStart={handleDragStart}
          onDragMove={(e) => handleDragMove(e, ep.index)}
          onDragEnd={(e) => handleDragEnd(e, ep)}
        />
      ))}
    </>
  );
});
