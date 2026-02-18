"use client";

import { memo, useMemo } from "react";
import { Line, Path, Rect, Text } from "react-konva";

import type { BoardElement, ConnectorElement } from "@collab/shared/collab";
import {
  avoidObstacles,
  computeArrowhead,
  computeDiamond,
  computePath,
  getPathMidpoint,
  resolveEndpoints,
} from "./connector-utils";

type ConnectorContentProps = {
  element: ConnectorElement;
  elements: BoardElement[];
  elementsById?: Map<string, BoardElement>;
  isLabelEditing?: boolean;
  onLabelClick?: () => void;
};

function getDash(dashStyle: string, strokeWidth: number): number[] | undefined {
  if (dashStyle === "dashed") return [strokeWidth * 4, strokeWidth * 3];
  if (dashStyle === "dotted") return [strokeWidth, strokeWidth * 2.5];
  return undefined;
}

function pathPointsToSvg(points: number[]): string {
  if (points.length < 4) return "";
  let d = `M ${points[0]} ${points[1]}`;
  if (points.length === 8) {
    // Cubic bezier (4 points = start, cp1, cp2, end)
    d += ` C ${points[2]} ${points[3]}, ${points[4]} ${points[5]}, ${points[6]} ${points[7]}`;
  } else {
    for (let i = 2; i < points.length; i += 2) {
      d += ` L ${points[i]} ${points[i + 1]}`;
    }
  }
  return d;
}

export const ConnectorContent = memo(function ConnectorContent({
  element,
  elements,
  elementsById,
  isLabelEditing = false,
  onLabelClick,
}: ConnectorContentProps) {
  const lookupSource = elementsById ?? elements;

  const pathPoints = useMemo(() => {
    const { from, to } = resolveEndpoints(element, lookupSource);
    let absPath = computePath(from, to, element.routingStyle, element.elbowMidpoint, element.fromAnchor, element.toAnchor);

    if (element.routingStyle === "orthogonal" && element.elbowMidpoint == null) {
      absPath = avoidObstacles(absPath, element, elements);
    }

    const ox = element.x;
    const oy = element.y;
    return absPath.map((v, i) => (i % 2 === 0 ? v - ox : v - oy));
  }, [element, elements, lookupSource]);

  const dash = getDash(element.dashStyle, element.strokeWidth);

  const isCurved = element.routingStyle === "curved" && pathPoints.length === 8;

  // Render arrowheads
  const arrowSize = Math.max(element.strokeWidth * 4, 10);
  const startArrowPoints =
    element.startArrow !== "none" && pathPoints.length >= 4
      ? element.startArrow === "diamond"
        ? computeDiamond(
            { x: pathPoints[0], y: pathPoints[1] },
            { x: pathPoints[2], y: pathPoints[3] },
            arrowSize,
          )
        : computeArrowhead(
            { x: pathPoints[0], y: pathPoints[1] },
            { x: pathPoints[2], y: pathPoints[3] },
            arrowSize,
          )
      : null;

  const endIdx = pathPoints.length;
  const endArrowPoints =
    element.endArrow !== "none" && pathPoints.length >= 4
      ? element.endArrow === "diamond"
        ? computeDiamond(
            { x: pathPoints[endIdx - 2], y: pathPoints[endIdx - 1] },
            { x: pathPoints[endIdx - 4], y: pathPoints[endIdx - 3] },
            arrowSize,
          )
        : computeArrowhead(
            { x: pathPoints[endIdx - 2], y: pathPoints[endIdx - 1] },
            { x: pathPoints[endIdx - 4], y: pathPoints[endIdx - 3] },
            arrowSize,
          )
      : null;

  return (
    <>
      {isCurved ? (
        <Path
          data={pathPointsToSvg(pathPoints)}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          lineCap="round"
          lineJoin="round"
          dash={dash}
          fill=""
          hitStrokeWidth={Math.max(element.strokeWidth, 14)}
        />
      ) : (
        <Line
          points={pathPoints}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          lineCap="round"
          lineJoin="round"
          dash={dash}
          hitStrokeWidth={Math.max(element.strokeWidth, 14)}
        />
      )}

      {startArrowPoints && startArrowPoints.length >= 6 && (
        <Line
          points={startArrowPoints}
          fill={element.stroke}
          stroke={element.stroke}
          strokeWidth={1}
          closed
          listening={false}
        />
      )}

      {endArrowPoints && endArrowPoints.length >= 6 && (
        <Line
          points={endArrowPoints}
          fill={element.stroke}
          stroke={element.stroke}
          strokeWidth={1}
          closed
          listening={false}
        />
      )}

      {/* Text label at path midpoint (already in local coords) */}
      {!isLabelEditing && element.labelText.trim() !== "" && (() => {
        const midpoint = getPathMidpoint(pathPoints);
        const labelPadding = 4;
        const estimatedWidth = element.labelText.length * element.labelFontSize * 0.55 + labelPadding * 2;
        const estimatedHeight = element.labelFontSize * 1.3 + labelPadding * 2;
        return (
          <>
            <Rect
              x={midpoint.x - estimatedWidth / 2}
              y={midpoint.y - estimatedHeight / 2}
              width={estimatedWidth}
              height={estimatedHeight}
              fill="#121212"
              opacity={0.85}
              cornerRadius={4}
              listening={!!onLabelClick}
              onClick={onLabelClick}
            />
            <Text
              x={midpoint.x - estimatedWidth / 2 + labelPadding}
              y={midpoint.y - estimatedHeight / 2 + labelPadding}
              width={estimatedWidth - labelPadding * 2}
              height={estimatedHeight - labelPadding * 2}
              text={element.labelText}
              fontSize={element.labelFontSize}
              fontFamily={element.labelFontFamily}
              fontStyle={element.labelBold ? "bold" : "normal"}
              textDecoration={element.labelStrikethrough ? "line-through" : ""}
              fill={element.labelFill}
              align="center"
              verticalAlign="middle"
              listening={!!onLabelClick}
              onClick={onLabelClick}
            />
          </>
        );
      })()}
    </>
  );
});
