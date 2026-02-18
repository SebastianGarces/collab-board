"use client";

import { memo } from "react";
import { Rect, Text } from "react-konva";

import type { StickyNoteElement } from "@collab/shared/collab";

type StickyNoteProps = {
  element: StickyNoteElement;
  isEditing?: boolean;
};

export const StickyNote = memo(function StickyNote({ element, isEditing = false }: StickyNoteProps) {
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
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      {!isEditing && (
        <Text
          x={12}
          y={12}
          width={element.width - 24}
          height={element.height - 24}
          text={element.text}
          fontSize={element.fontSize}
          fontFamily={element.fontFamily}
          fill="#1a1a1a"
          wrap="word"
          ellipsis
          listening={false}
        />
      )}
    </>
  );
});
