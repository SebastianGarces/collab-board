"use client";

import { Line } from "react-konva";

import type { LineElement } from "@collab/shared/collab";

type LineContentProps = {
  element: LineElement;
};

export function LineContent({ element }: LineContentProps) {
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
    />
  );
}
