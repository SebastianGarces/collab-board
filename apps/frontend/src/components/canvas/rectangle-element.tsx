"use client";

import { memo } from "react";
import { Rect } from "react-konva";

import type { RectangleElement } from "@collab/shared/collab";

type RectangleContentProps = {
  element: RectangleElement;
};

export const RectangleContent = memo(function RectangleContent({ element }: RectangleContentProps) {
  return (
    <Rect
      width={element.width}
      height={element.height}
      fill={element.fill}
      stroke={element.stroke}
      strokeWidth={2}
      cornerRadius={2}
      perfectDrawEnabled={false}
    />
  );
});
