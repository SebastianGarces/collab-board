"use client";

import { memo, useMemo, useRef, useEffect, useState } from "react";
import { Group, Line, Path, Rect, Text } from "react-konva";
import type Konva from "konva";

import type { FrameElement } from "@collab/shared/collab";

type FrameContentProps = {
  element: FrameElement;
  isEditing?: boolean;
  isDropTarget?: boolean;
};

const TITLE_FONT_SIZE = 13;
const TITLE_PAD_X = 8;
const TITLE_PAD_Y = 3;
const TITLE_BOX_HEIGHT = TITLE_FONT_SIZE + TITLE_PAD_Y * 2;
const TITLE_BOX_OFFSET_Y = TITLE_BOX_HEIGHT + 4;

function HiddenOverlay({ width, height }: { width: number; height: number }) {
  const stripeLines = useMemo(() => {
    const lines: { points: number[] }[] = [];
    const spacing = 16;
    const total = width + height;
    for (let offset = 0; offset < total; offset += spacing) {
      const x1 = Math.min(offset, width);
      const y1 = Math.max(0, offset - width);
      const x2 = Math.max(0, offset - height);
      const y2 = Math.min(offset, height);
      lines.push({ points: [x1, y1, x2, y2] });
    }
    return lines;
  }, [width, height]);

  return (
    <Group>
      <Rect
        width={width}
        height={height}
        fill="rgba(200, 200, 200, 0.15)"
        listening={false}
      />
      {stripeLines.map((line, i) => (
        <Line
          key={i}
          points={line.points}
          stroke="rgba(160, 160, 160, 0.3)"
          strokeWidth={1}
          listening={false}
        />
      ))}
      <Path
        x={width / 2 - 32}
        y={height / 2 - 32}
        data="M15 18l-.722-3.25 M2 8a10.645 10.645 0 0 0 20 0 M20 15l-1.726-2.05 M4 15l1.726-2.05 M9 18l.722-3.25"
        stroke="#888"
        strokeWidth={2}
        lineCap="round"
        lineJoin="round"
        scaleX={64 / 24}
        scaleY={64 / 24}
        listening={false}
      />
    </Group>
  );
}

export const FrameContent = memo(function FrameContent({ element, isEditing = false, isDropTarget = false }: FrameContentProps) {
  const hasBorder = element.strokeStyle !== "none";
  const dashArray =
    element.strokeStyle === "dashed" ? [8, 5] : undefined;

  const textRef = useRef<Konva.Text>(null);
  const [titleWidth, setTitleWidth] = useState(60);

  useEffect(() => {
    if (textRef.current) {
      setTitleWidth(textRef.current.width());
    }
  }, [element.title]);

  const boxWidth = titleWidth + TITLE_PAD_X * 2;

  return (
    <>
      {/* Title badge above the frame — hidden during editing so the HTML input takes its place */}
      {!isEditing && (
        <>
          <Rect
            x={0}
            y={-TITLE_BOX_OFFSET_Y}
            width={boxWidth}
            height={TITLE_BOX_HEIGHT}
            fill="#ffffff"
            stroke="#d4d4d4"
            strokeWidth={1}
            cornerRadius={3}
          />
          <Text
            ref={textRef}
            x={TITLE_PAD_X}
            y={-TITLE_BOX_OFFSET_Y + TITLE_PAD_Y}
            text={element.title}
            fontSize={TITLE_FONT_SIZE}
            fontFamily="system-ui, sans-serif"
            fontStyle="500"
            fill="#525252"
          />
        </>
      )}
      {/* Background */}
      <Rect
        width={element.width}
        height={element.height}
        fill={element.fill}
        stroke={hasBorder ? element.stroke : undefined}
        strokeWidth={hasBorder ? 3 : 0}
        dash={dashArray}
        cornerRadius={2}
        perfectDrawEnabled={false}
      />
      {/* Hidden overlay */}
      {element.hidden && (
        <HiddenOverlay width={element.width} height={element.height} />
      )}
      {/* Drop target highlight */}
      {isDropTarget && (
        <Rect
          x={-3}
          y={-3}
          width={element.width + 6}
          height={element.height + 6}
          stroke="#60a5fa"
          strokeWidth={3}
          cornerRadius={4}
          dash={[8, 4]}
          listening={false}
        />
      )}
    </>
  );
});
