"use client";

import { Group, Rect, Text } from "react-konva";

import type { StickyNoteElement } from "@collab/shared/collab";

type StickyNoteProps = {
  element: StickyNoteElement;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick: (id: string) => void;
  draggable: boolean;
};

export function StickyNote({
  element,
  isSelected,
  onSelect,
  onDragEnd,
  onDblClick,
  draggable,
}: StickyNoteProps) {
  return (
    <Group
      x={element.x}
      y={element.y}
      draggable={draggable}
      onClick={() => onSelect(element.id)}
      onTap={() => onSelect(element.id)}
      onDblClick={() => onDblClick(element.id)}
      onDblTap={() => onDblClick(element.id)}
      onDragEnd={(e) => {
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
    >
      {isSelected && (
        <Rect
          x={-3}
          y={-3}
          width={element.width + 6}
          height={element.height + 6}
          stroke="#60a5fa"
          strokeWidth={2}
          cornerRadius={6}
          dash={[6, 3]}
          listening={false}
        />
      )}
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
    </Group>
  );
}
