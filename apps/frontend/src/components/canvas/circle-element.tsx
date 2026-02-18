"use client";

import { memo } from "react";
import { Ellipse } from "react-konva";

import type { CircleElement } from "@collab/shared/collab";

type CircleContentProps = {
  element: CircleElement;
};

export const CircleContent = memo(function CircleContent({ element }: CircleContentProps) {
  return (
    <Ellipse
      x={element.width / 2}
      y={element.height / 2}
      radiusX={element.width / 2}
      radiusY={element.height / 2}
      fill={element.fill}
      stroke={element.stroke}
      strokeWidth={2}
      perfectDrawEnabled={false}
    />
  );
});
