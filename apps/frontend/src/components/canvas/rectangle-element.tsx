"use client";

import { Rect } from "react-konva";

import type { RectangleElement } from "@collab/shared/collab";

type RectangleContentProps = {
  element: RectangleElement;
};

export function RectangleContent({ element }: RectangleContentProps) {
  return (
    <Rect
      width={element.width}
      height={element.height}
      fill={element.fill}
      stroke={element.stroke}
      strokeWidth={2}
      cornerRadius={2}
    />
  );
}
