"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle as KonvaCircle, Layer, Rect, Stage } from "react-konva";

import type { BoardElement, ConnectorElement, FrameElement } from "@collab/shared/collab";

import { findFrameAtPoint, getElementAABB, getFrameChildIds } from "@/lib/element-utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { InteractiveShape } from "./interactive-shape";
import { StickyNote } from "./sticky-note";
import { RectangleContent } from "./rectangle-element";
import { CircleContent } from "./circle-element";
import { LineContent } from "./line-element";
import { LineEndpointHandles } from "./line-endpoint-handles";
import { TextContent } from "./text-element";
import { FrameContent } from "./frame-element";
import { ConnectorContent } from "./connector-element";
import { ConnectorEndpointHandles } from "./connector-endpoint-handles";
import { ConnectorMidpointHandles } from "./connector-midpoint-handles";
import type { ElementBox } from "./shape-transform";

import type { RotationCursorState } from "./interactive-shape";

type BoardCanvasProps = {
  camera: { x: number; y: number; scale: number };
  syntheticObjectCount?: number;
  elements?: BoardElement[];
  activeTool?: string;
  onSelectElement?: (id: string, shiftKey: boolean) => void;
  onDragElementStart?: (id: string) => void;
  onDragElementMove?: (id: string, x: number, y: number) => void;
  onDragElement?: (id: string, x: number, y: number) => void;
  onDragSelectedElements?: (deltaX: number, deltaY: number) => void;
  onResizeElement?: (id: string, box: ElementBox) => void;
  onRotateElement?: (id: string, rotation: number) => void;
  onRotateCursorChange?: (state: RotationCursorState) => void;
  onDblClickElement?: (id: string) => void;
  onLineEndpointDrag?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onLineEndpointDragEnd?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onConnectorEndpointDrag?: (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => void;
  onConnectorEndpointDragEnd?: (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => void;
  onConnectorMidpointDrag?: (id: string, segmentIndex: number, worldX: number, worldY: number) => void;
  onConnectorMidpointDragEnd?: (id: string, segmentIndex: number, worldX: number, worldY: number) => void;
  onConnectorLabelClick?: (id: string) => void;
  onStagePointerDown?: (worldX: number, worldY: number) => void;
  onStagePointerMove?: (worldX: number, worldY: number) => void;
  onStagePointerUp?: () => void;
  onMarqueeSelect?: (ids: string[]) => void;
  marqueeRect?: { x: number; y: number; width: number; height: number } | null;
  editingElementId?: string | null;
  connectorSnapAnchors?: { x: number; y: number }[];
  connectorSnapTarget?: { x: number; y: number } | null;
  getFrameChildIdsFn?: (frameId: string) => string[];
};

export function BoardCanvas({
  camera,
  syntheticObjectCount = 0,
  elements = [],
  activeTool = "pointer",
  onSelectElement,
  onDragElementStart,
  onDragElementMove,
  onDragElement,
  onDragSelectedElements,
  onResizeElement,
  onRotateElement,
  onRotateCursorChange,
  onDblClickElement,
  onLineEndpointDrag,
  onLineEndpointDragEnd,
  onConnectorEndpointDrag,
  onConnectorEndpointDragEnd,
  onConnectorMidpointDrag,
  onConnectorMidpointDragEnd,
  onConnectorLabelClick,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  marqueeRect = null,
  editingElementId = null,
  connectorSnapAnchors = [],
  connectorSnapTarget = null,
  getFrameChildIdsFn,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const groupDrag = useCanvasStore((s) => s.groupDrag);
  const dropTargetFrameId = useCanvasStore((s) => s.dropTargetFrameId);
  const setDropTargetFrameId = useCanvasStore((s) => s.setDropTargetFrameId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const isMultiSelect = selectedElementIds.size > 1;

  const frameElements = useMemo(
    () => elements.filter((e) => e.type === "frame") as FrameElement[],
    [elements]
  );

  const groupBounds = useMemo(() => {
    if (!isMultiSelect) return null;
    const selectedEls = elements.filter((e) => selectedElementIds.has(e.id));
    if (selectedEls.length <= 1) return null;

    const offsetX = groupDrag?.dx ?? 0;
    const offsetY = groupDrag?.dy ?? 0;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const e of selectedEls) {
      const aabb = getElementAABB(e);
      minX = Math.min(minX, aabb.minX + offsetX);
      minY = Math.min(minY, aabb.minY + offsetY);
      maxX = Math.max(maxX, aabb.maxX + offsetX);
      maxY = Math.max(maxY, aabb.maxY + offsetY);
    }

    return { x: minX - 4, y: minY - 4, width: maxX - minX + 8, height: maxY - minY + 8 };
  }, [isMultiSelect, elements, selectedElementIds, groupDrag]);

  // Sort elements: frames first (behind), then regular shapes, then connectors on top.
  // Connectors render above shapes so they remain visible over the objects they connect.
  // Also filter out children of hidden frames.
  const sortedElements = useMemo(() => {
    const frames: BoardElement[] = [];
    const connectors: BoardElement[] = [];
    const nonFrames: BoardElement[] = [];
    for (const el of elements) {
      if (el.type === "frame") {
        frames.push(el);
      } else if (el.type === "connector") {
        connectors.push(el);
      } else {
        nonFrames.push(el);
      }
    }

    // Compute hidden child IDs using explicit frameId membership
    const hiddenIds = new Set<string>();
    for (const f of frames) {
      if ((f as FrameElement).hidden) {
        const children = getFrameChildIdsFn ? getFrameChildIdsFn(f.id) : getFrameChildIds(f.id, elements);
        for (const id of children) hiddenIds.add(id);
      }
    }

    const visibleNonFrames = nonFrames.filter((el) => !hiddenIds.has(el.id));
    return [...frames, ...visibleNonFrames, ...connectors];
  }, [elements, getFrameChildIdsFn]);

  const isPointerMode = activeTool === "pointer";
  const draggable = isPointerMode;

  const handleSelect = (id: string, shiftKey: boolean) => {
    onSelectElement?.(id, shiftKey);
  };

  const handleMultiDragEnd = (draggedId: string, newX: number, newY: number) => {
    setDropTargetFrameId(null);
    const el = elements.find((e) => e.id === draggedId);
    if (!el) return;
    const deltaX = newX - el.x;
    const deltaY = newY - el.y;
    if (selectedElementIds.size > 1 && selectedElementIds.has(draggedId)) {
      onDragSelectedElements?.(deltaX, deltaY);
    } else {
      onDragElement?.(draggedId, newX, newY);
    }
  };

  const handleResize = (id: string, box: ElementBox) => {
    onResizeElement?.(id, box);
  };

  const handleRotate = (id: string, rotation: number) => {
    onRotateElement?.(id, rotation);
  };

  const handleDblClick = (id: string) => {
    onDblClickElement?.(id);
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={camera.x}
          y={camera.y}
          scaleX={camera.scale}
          scaleY={camera.scale}
          listening={isPointerMode}
          onPointerDown={(e) => {
            if (!isPointerMode) return;
            const stage = e.target.getStage();
            if (!stage) return;
            if (e.target === stage) {
              const pos = stage.getPointerPosition();
              if (!pos) return;
              const worldX = (pos.x - camera.x) / camera.scale;
              const worldY = (pos.y - camera.y) / camera.scale;
              onStagePointerDown?.(worldX, worldY);
            }
          }}
          onPointerMove={(e) => {
            if (!isPointerMode) return;
            const stage = e.target.getStage();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const worldX = (pos.x - camera.x) / camera.scale;
            const worldY = (pos.y - camera.y) / camera.scale;
            onStagePointerMove?.(worldX, worldY);
          }}
          onPointerUp={() => {
            if (!isPointerMode) return;
            onStagePointerUp?.();
          }}
        >
          <Layer>
            {/* Synthetic objects for perf testing */}
            {Array.from({ length: syntheticObjectCount }).map((_, index) => {
              const row = Math.floor(index / 25);
              const col = index % 25;
              return (
                <Rect
                  key={`synthetic-${index}`}
                  x={col * 56}
                  y={row * 36}
                  width={48}
                  height={28}
                  cornerRadius={4}
                  fill={index % 2 === 0 ? "#2f7aeb" : "#55c2a0"}
                  opacity={0.8}
                  listening={false}
                />
              );
            })}

            {/* Real board elements (frames first, then connectors, then non-frames; hidden children filtered out) */}
            {sortedElements.map((el) => {
              const isLine = el.type === "line";
              const isConnector = el.type === "connector";
              const isFrame = el.type === "frame";
              const resizable = !isLine && !isConnector;
              const editable = el.type === "sticky-note" || el.type === "text" || isFrame;
              const isSelected = selectedElementIds.has(el.id);
              return (
                <InteractiveShape
                  key={el.id}
                  element={el}
                  isSelected={isSelected}
                  multiSelected={isSelected && isMultiSelect}
                  draggable={draggable && !isConnector}
                  onSelect={handleSelect}
                  onDragStart={onDragElementStart}
                  onDragMove={onDragElementMove}
                  onDragEnd={handleMultiDragEnd}
                  resizable={resizable}
                  onResize={resizable ? handleResize : undefined}
                  onRotate={resizable ? handleRotate : undefined}
                  onRotateCursorChange={resizable ? onRotateCursorChange : undefined}
                  zoomScale={camera.scale}
                  onDblClick={editable ? handleDblClick : undefined}
                  hideSelectionOutline={isLine || isConnector}
                  getDragChildIds={
                    el.type === "frame"
                      ? () => (getFrameChildIdsFn ? getFrameChildIdsFn(el.id) : getFrameChildIds(el.id, elements))
                      : undefined
                  }
                  onDragPositionUpdate={
                    !isFrame
                      ? (x, y) => {
                          const cx = x + el.width / 2;
                          const cy = y + el.height / 2;
                          const target = findFrameAtPoint(cx, cy, frameElements);
                          setDropTargetFrameId(target);
                        }
                      : undefined
                  }
                >
                  {el.type === "sticky-note" && <StickyNote element={el} />}
                  {el.type === "rectangle" && <RectangleContent element={el} />}
                  {el.type === "circle" && <CircleContent element={el} />}
                  {el.type === "line" && <LineContent element={el} />}
                  {el.type === "text" && <TextContent element={el} />}
                  {el.type === "frame" && (
                    <FrameContent
                      element={el}
                      isEditing={el.id === editingElementId}
                      isDropTarget={dropTargetFrameId === el.id}
                    />
                  )}
                  {isConnector && el.type === "connector" && (
                    <ConnectorContent
                      element={el}
                      elements={elements}
                      onLabelClick={
                        isSelected && el.labelText.trim() !== ""
                          ? () => onConnectorLabelClick?.(el.id)
                          : undefined
                      }
                    />
                  )}
                  {isLine && isSelected && el.type === "line" && (
                    <LineEndpointHandles
                      points={el.points}
                      zoomScale={camera.scale}
                      onEndpointDrag={(idx, wx, wy) =>
                        onLineEndpointDrag?.(el.id, idx, wx, wy)
                      }
                      onEndpointDragEnd={(idx, wx, wy) =>
                        onLineEndpointDragEnd?.(el.id, idx, wx, wy)
                      }
                    />
                  )}
                  {isConnector && isSelected && el.type === "connector" && (
                    <>
                      <ConnectorEndpointHandles
                        element={el}
                        elements={elements}
                        zoomScale={camera.scale}
                        onEndpointDrag={(endpoint, wx, wy) =>
                          onConnectorEndpointDrag?.(el.id, endpoint, wx, wy)
                        }
                        onEndpointDragEnd={(endpoint, wx, wy) =>
                          onConnectorEndpointDragEnd?.(el.id, endpoint, wx, wy)
                        }
                      />
                      <ConnectorMidpointHandles
                        element={el}
                        elements={elements}
                        zoomScale={camera.scale}
                        onMidpointDrag={(segIdx, wx, wy) =>
                          onConnectorMidpointDrag?.(el.id, segIdx, wx, wy)
                        }
                        onMidpointDragEnd={(segIdx, wx, wy) =>
                          onConnectorMidpointDragEnd?.(el.id, segIdx, wx, wy)
                        }
                      />
                    </>
                  )}
                </InteractiveShape>
              );
            })}

            {/* Group selection bounding box */}
            {groupBounds && (
              <Rect
                x={groupBounds.x}
                y={groupBounds.y}
                width={groupBounds.width}
                height={groupBounds.height}
                stroke="#60a5fa"
                strokeWidth={2 / camera.scale}
                cornerRadius={6 / camera.scale}
                dash={[6 / camera.scale, 3 / camera.scale]}
                listening={false}
              />
            )}

            {/* Connector snap anchor points */}
            {connectorSnapAnchors.map((anchor, i) => (
              <KonvaCircle
                key={`snap-anchor-${i}`}
                x={anchor.x}
                y={anchor.y}
                radius={7 / camera.scale}
                fill="white"
                stroke="#60a5fa"
                strokeWidth={2 / camera.scale}
                opacity={1}
                listening={false}
              />
            ))}

            {/* Active snap target highlight */}
            {connectorSnapTarget && (
              <KonvaCircle
                x={connectorSnapTarget.x}
                y={connectorSnapTarget.y}
                radius={10 / camera.scale}
                fill="rgba(96, 165, 250, 0.4)"
                stroke="#2563eb"
                strokeWidth={2.5 / camera.scale}
                listening={false}
              />
            )}

            {/* Marquee selection rectangle */}
            {marqueeRect && (
              <Rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.width}
                height={marqueeRect.height}
                fill="rgba(96, 165, 250, 0.1)"
                stroke="#60a5fa"
                strokeWidth={1 / camera.scale}
                dash={[6 / camera.scale, 3 / camera.scale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
