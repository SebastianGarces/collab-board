"use client";

import { memo } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle } from "react-konva";

import type { BoardElement, ConnectorElement } from "@collab/shared/collab";
import { resolveEndpoints } from "./connector-utils";

type ConnectorEndpointHandlesProps = {
  element: ConnectorElement;
  elements: BoardElement[];
  zoomScale: number;
  onEndpointDragStart?: () => void;
  onEndpointDrag: (endpoint: "from" | "to", worldX: number, worldY: number) => void;
  onEndpointDragEnd: (endpoint: "from" | "to", worldX: number, worldY: number) => void;
};

function getWorldPointer(event: KonvaEventObject<DragEvent>): { x: number; y: number } | null {
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

export const ConnectorEndpointHandles = memo(function ConnectorEndpointHandles({
  element,
  elements,
  zoomScale,
  onEndpointDragStart,
  onEndpointDrag,
  onEndpointDragEnd,
}: ConnectorEndpointHandlesProps) {
  const { from, to } = resolveEndpoints(element, elements);
  const visualScale = Math.max(zoomScale, 0.2);
  const handleRadius = 7 / visualScale;

  // Convert to local coordinates (InteractiveShape Group is at element.x, element.y)
  const ox = element.x;
  const oy = element.y;

  const endpoints: { key: "from" | "to"; x: number; y: number }[] = [
    { key: "from", x: from.x - ox, y: from.y - oy },
    { key: "to", x: to.x - ox, y: to.y - oy },
  ];

  const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    onEndpointDragStart?.();
  };

  const handleDragMove = (e: KonvaEventObject<DragEvent>, key: "from" | "to") => {
    e.cancelBubble = true;
    const pointer = getWorldPointer(e);
    if (pointer) onEndpointDrag(key, pointer.x, pointer.y);
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>, ep: { key: "from" | "to"; x: number; y: number }) => {
    e.cancelBubble = true;
    const pointer = getWorldPointer(e);
    if (pointer) onEndpointDragEnd(ep.key, pointer.x, pointer.y);
    e.target.position({ x: ep.x, y: ep.y });
  };

  return (
    <>
      {endpoints.map((ep) => (
        <Circle
          key={ep.key}
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
          onDragMove={(e) => handleDragMove(e, ep.key)}
          onDragEnd={(e) => handleDragEnd(e, ep)}
        />
      ))}
    </>
  );
});
