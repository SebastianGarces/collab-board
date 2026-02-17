"use client";

import { Rect, Text } from "react-konva";

import type { TextElement } from "@collab/shared/collab";

type TextContentProps = {
  element: TextElement;
};

export function TextContent({ element }: TextContentProps) {
  return (
    <>
      <Rect
        width={element.width}
        height={element.height}
        fill="transparent"
      />
      <Text
        width={element.width}
        height={element.height}
        text={element.text || ""}
        fontSize={element.fontSize}
        fontFamily={element.fontFamily}
        fill={element.fill}
        wrap="word"
        ellipsis
        listening={false}
      />
    </>
  );
}
