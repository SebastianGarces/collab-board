"use client";

import { Rect, Text } from "react-konva";

import type { StickyNoteElement } from "@collab/shared/collab";

type StickyNoteProps = {
  element: StickyNoteElement;
};

export function StickyNote({ element }: StickyNoteProps) {
  return (
    <>
      <Rect
        width={element.width}
        height={element.height}
        fill={element.color}
        cornerRadius={4}
        shadowColor="rgba(0,0,0,0.25)"
        shadowBlur={8}
        shadowOffsetY={2}
      />
      <Text
        x={12}
        y={12}
        width={element.width - 24}
        height={element.height - 24}
        text={element.text}
        fontSize={14}
        fontFamily="system-ui, sans-serif"
        fill="#1a1a1a"
        wrap="word"
        ellipsis
        listening={false}
      />
    </>
  );
}
