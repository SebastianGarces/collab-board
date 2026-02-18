"use client";

import { memo } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Rect } from "react-konva";

import type { BoardElement, ConnectorElement } from "@collab/shared/collab";
import { resolveEndpoints, computePath, avoidObstacles } from "./connector-utils";

type ConnectorMidpointHandlesProps = {
  element: ConnectorElement;
  elements: BoardElement[];
  zoomScale: number;
  onMidpointDrag: (segmentIndex: number, worldX: number, worldY: number) => void;
  onMidpointDragEnd: (segmentIndex: number, worldX: number, worldY: number) => void;
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

export const ConnectorMidpointHandles = memo(function ConnectorMidpointHandles({
  element,
  elements,
  zoomScale,
  onMidpointDrag,
  onMidpointDragEnd,
}: ConnectorMidpointHandlesProps) {
  if (element.routingStyle !== "orthogonal") return null;

  const { from, to } = resolveEndpoints(element, elements);
  let absPathPoints = computePath(from, to, element.routingStyle, element.elbowMidpoint, element.fromAnchor, element.toAnchor);

  if (element.elbowMidpoint == null) {
    absPathPoints = avoidObstacles(absPathPoints, element, elements);
  }

  const ox = element.x;
  const oy = element.y;
  const pathPoints = absPathPoints.map((v, i) => (i % 2 === 0 ? v - ox : v - oy));

  if (pathPoints.length < 6) return null;

  const visualScale = Math.max(zoomScale, 0.2);

  // Pill handle dimensions
  const handleLength = 24 / visualScale;
  const handleThickness = 6 / visualScale;
  const cornerRadius = 3 / visualScale;

  // Compute midpoints of each segment
  const midpoints: { x: number; y: number; segIndex: number; isHorizontal: boolean }[] = [];
  for (let i = 0; i < pathPoints.length - 2; i += 2) {
    const x1 = pathPoints[i];
    const y1 = pathPoints[i + 1];
    const x2 = pathPoints[i + 2];
    const y2 = pathPoints[i + 3];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const isHorizontal = Math.abs(y2 - y1) < 1;
    midpoints.push({ x: mx, y: my, segIndex: i / 2, isHorizontal });
  }

  // Only show inner segment midpoints (skip first and last segments)
  const innerMidpoints = midpoints.length > 2
    ? midpoints.slice(1, -1)
    : midpoints;

  return (
    <>
      {innerMidpoints.map((mp) => {
        // Pill oriented along the segment direction to match the line visually
        // Horizontal segment -> horizontal pill
        // Vertical segment -> vertical pill
        const pillWidth = mp.isHorizontal ? handleLength : handleThickness;
        const pillHeight = mp.isHorizontal ? handleThickness : handleLength;

        return (
          <Rect
            key={mp.segIndex}
            x={mp.x - pillWidth / 2}
            y={mp.y - pillHeight / 2}
            width={pillWidth}
            height={pillHeight}
            fill="#60a5fa"
            stroke="#2563eb"
            strokeWidth={1.5 / visualScale}
            cornerRadius={cornerRadius}
            draggable
            dragOnTop={false}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.style.cursor = mp.isHorizontal ? "ns-resize" : "ew-resize";
              }
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const pointer = getWorldPointer(e);
              if (pointer) onMidpointDrag(mp.segIndex, pointer.x, pointer.y);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              const pointer = getWorldPointer(e);
              if (pointer) onMidpointDragEnd(mp.segIndex, pointer.x, pointer.y);
              e.target.position({ x: mp.x - pillWidth / 2, y: mp.y - pillHeight / 2 });
            }}
          />
        );
      })}
    </>
  );
});
