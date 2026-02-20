"use client";

import { memo, useMemo } from "react";
import { Line, Path, Rect, Text } from "react-konva";

import type { ConnectorElement } from "@collab/shared/collab";
import type { BoardElement } from "@collab/shared/collab";
import {
    CONNECTOR_HIT_PADDING,
    computeArrowhead,
    computeDiamond,
    computePath,
    getPathMidpoint,
    resolveEndpoints,
} from "./connector-utils";

type ConnectorContentProps = {
  element: ConnectorElement;
  elementsById: Map<string, BoardElement>;
  dragPositionOverrides?: Map<string, { x: number; y: number }>;
  isLabelEditing?: boolean;
  onLabelClick?: () => void;
};

let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) {
    const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
    _measureCtx = c?.getContext("2d") ?? null;
  }
  return _measureCtx;
}

export function measureLabelWidth(text: string, fontSize: number, fontFamily: string, bold: boolean): number {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * fontSize * 0.6;
  ctx.font = `${bold ? "bold " : ""}${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

function getDash(dashStyle: string, strokeWidth: number): number[] | undefined {
  if (dashStyle === "dashed") return [strokeWidth * 4, strokeWidth * 3];
  if (dashStyle === "dotted") return [strokeWidth, strokeWidth * 2.5];
  return undefined;
}

function pathPointsToSvg(points: number[]): string {
  if (points.length < 4) return "";
  let d = `M ${points[0]} ${points[1]}`;
  if (points.length === 8) {
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
  elementsById,
  dragPositionOverrides,
  isLabelEditing = false,
  onLabelClick,
}: ConnectorContentProps) {
  const fromEl = element.fromId ? elementsById.get(element.fromId) : undefined;
  const toEl = element.toId ? elementsById.get(element.toId) : undefined;

  const fromOverride = element.fromId ? dragPositionOverrides?.get(element.fromId) : undefined;
  const toOverride = element.toId ? dragPositionOverrides?.get(element.toId) : undefined;

  const selfOverride = dragPositionOverrides?.get(element.id);
  const selfOx = selfOverride?.x;
  const selfOy = selfOverride?.y;

  const pathPoints = useMemo(() => {
    const miniMap = new Map<string, BoardElement>();
    if (fromEl) {
      const el = fromOverride
        ? { ...fromEl, x: fromOverride.x, y: fromOverride.y }
        : fromEl;
      miniMap.set(el.id, el);
    }
    if (toEl) {
      const el = toOverride
        ? { ...toEl, x: toOverride.x, y: toOverride.y }
        : toEl;
      miniMap.set(el.id, el);
    }

    const selfDx = selfOx != null ? selfOx - element.x : 0;
    const selfDy = selfOy != null ? selfOy - element.y : 0;

    const resolveEl = (selfDx || selfDy)
      ? { ...element,
          fromX: element.fromX + (!element.fromId ? selfDx : 0),
          fromY: element.fromY + (!element.fromId ? selfDy : 0),
          toX: element.toX + (!element.toId ? selfDx : 0),
          toY: element.toY + (!element.toId ? selfDy : 0),
        }
      : element;

    const { from, to } = resolveEndpoints(resolveEl, miniMap);
    const absPath = computePath(from, to, resolveEl.fromAnchor, resolveEl.toAnchor);

    const ox = selfOx ?? element.x;
    const oy = selfOy ?? element.y;
    return absPath.map((v, i) => (i % 2 === 0 ? v - ox : v - oy));
  }, [element, fromEl, toEl, fromOverride, toOverride, selfOx, selfOy]);

  const dash = getDash(element.dashStyle, element.strokeWidth);

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
      <Path
        data={pathPointsToSvg(pathPoints)}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        lineCap="round"
        lineJoin="round"
        dash={dash}
        fill=""
        hitStrokeWidth={Math.max(element.strokeWidth, CONNECTOR_HIT_PADDING)}
      />

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

      {!isLabelEditing && element.labelText.trim() !== "" && (() => {
        const midpoint = getPathMidpoint(pathPoints);
        const labelPadding = 4;
        const textWidth = measureLabelWidth(
          element.labelText,
          element.labelFontSize,
          element.labelFontFamily,
          element.labelBold,
        );
        const boxWidth = textWidth + labelPadding * 2;
        const boxHeight = element.labelFontSize * 1.3 + labelPadding * 2;
        return (
          <>
            <Rect
              x={midpoint.x - boxWidth / 2}
              y={midpoint.y - boxHeight / 2}
              width={boxWidth}
              height={boxHeight}
              fill="#ffffff"
              stroke="#d4d4d4"
              strokeWidth={1}
              cornerRadius={3}
              listening={!!onLabelClick}
              onClick={onLabelClick}
            />
            <Text
              x={midpoint.x - boxWidth / 2 + labelPadding}
              y={midpoint.y - boxHeight / 2 + labelPadding}
              width={textWidth}
              height={boxHeight - labelPadding * 2}
              text={element.labelText}
              fontSize={element.labelFontSize}
              fontFamily={element.labelFontFamily}
              fontStyle={element.labelBold ? "bold" : "normal"}
              textDecoration={element.labelStrikethrough ? "line-through" : ""}
              fill="#525252"
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
