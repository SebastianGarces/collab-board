"use client";

import { memo } from "react";
import { Rect, Text } from "react-konva";

import type { TextElement } from "@collab/shared/collab";

type TextContentProps = {
  element: TextElement;
  isEditing?: boolean;
};

export const TextContent = memo(function TextContent({ element, isEditing = false }: TextContentProps) {
  return (
    <>
      <Rect
        width={element.width}
        height={element.height}
        fill="transparent"
      />
      {!isEditing && (
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
      )}
    </>
  );
});
