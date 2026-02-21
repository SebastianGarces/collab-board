"use client";

import { memo } from "react";
import { Line } from "react-konva";

import type { LineElement } from "@collab/shared/collab";

const LINE_HIT_PADDING = 12;

function distToSegmentSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const projX = ax + t * abx;
  const projY = ay + t * aby;
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

/**
 * Precise hit-test for lines: returns true when `worldPoint` is within
 * `LINE_HIT_PADDING` of any segment in the line's points array.
 * Converts the world point to element-local coordinates before testing.
 */
export function isPointOnLinePath(
  worldPoint: { x: number; y: number },
  element: LineElement,
): boolean {
  const pts = element.points.length >= 4
    ? element.points
    : [0, 0, element.width, element.height];

  const lx = worldPoint.x - element.x;
  const ly = worldPoint.y - element.y;
  const paddingSq = LINE_HIT_PADDING * LINE_HIT_PADDING;

  for (let i = 0; i < pts.length - 2; i += 2) {
    if (distToSegmentSq(lx, ly, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= paddingSq) {
      return true;
    }
  }
  return false;
}

type LineContentProps = {
  element: LineElement;
};

export const LineContent = memo(function LineContent({ element }: LineContentProps) {
  const points =
    element.points.length >= 4
      ? element.points
      : [0, 0, element.width, element.height];

  return (
    <Line
      points={points}
      stroke={element.stroke}
      strokeWidth={element.strokeWidth}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={Math.max(element.strokeWidth, 12)}
      perfectDrawEnabled={false}
    />
  );
});
