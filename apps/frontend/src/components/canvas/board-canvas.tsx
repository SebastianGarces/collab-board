"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Rect, Stage } from "react-konva";

import type { BoardElement } from "@collab/shared/collab";

import { useCanvasStore } from "@/stores/canvas-store";
import { InteractiveShape } from "./interactive-shape";
import { StickyNote } from "./sticky-note";
import { RectangleContent } from "./rectangle-element";
import { CircleContent } from "./circle-element";
import { LineContent } from "./line-element";
import { LineEndpointHandles } from "./line-endpoint-handles";
import { TextContent } from "./text-element";
import type { ElementBox } from "./shape-transform";

type BoardCanvasProps = {
  camera: { x: number; y: number; scale: number };
  syntheticObjectCount?: number;
  elements?: BoardElement[];
  activeTool?: string;
  onSelectElement?: (id: string, shiftKey: boolean) => void;
  onDragElementStart?: (id: string) => void;
  onDragElement?: (id: string, x: number, y: number) => void;
  onDragSelectedElements?: (deltaX: number, deltaY: number) => void;
  onResizeElement?: (id: string, box: ElementBox) => void;
  onDblClickElement?: (id: string) => void;
  onLineEndpointDrag?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onLineEndpointDragEnd?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onStagePointerDown?: (worldX: number, worldY: number) => void;
  onStagePointerMove?: (worldX: number, worldY: number) => void;
  onStagePointerUp?: () => void;
  onMarqueeSelect?: (ids: string[]) => void;
  marqueeRect?: { x: number; y: number; width: number; height: number } | null;
};

export function BoardCanvas({
  camera,
  syntheticObjectCount = 0,
  elements = [],
  activeTool = "pointer",
  onSelectElement,
  onDragElementStart,
  onDragElement,
  onDragSelectedElements,
  onResizeElement,
  onDblClickElement,
  onLineEndpointDrag,
  onLineEndpointDragEnd,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  marqueeRect = null,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const groupDrag = useCanvasStore((s) => s.groupDrag);

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

  const groupBounds = useMemo(() => {
    if (!isMultiSelect) return null;
    const selectedEls = elements.filter((e) => selectedElementIds.has(e.id));
    if (selectedEls.length <= 1) return null;

    const offsetX = groupDrag?.dx ?? 0;
    const offsetY = groupDrag?.dy ?? 0;

    const minX = Math.min(...selectedEls.map((e) => e.x + offsetX));
    const minY = Math.min(...selectedEls.map((e) => e.y + offsetY));
    const maxX = Math.max(...selectedEls.map((e) => e.x + e.width + offsetX));
    const maxY = Math.max(...selectedEls.map((e) => e.y + e.height + offsetY));

    return { x: minX - 4, y: minY - 4, width: maxX - minX + 8, height: maxY - minY + 8 };
  }, [isMultiSelect, elements, selectedElementIds, groupDrag]);

  const isPointerMode = activeTool === "pointer";
  const draggable = isPointerMode;

  const handleSelect = (id: string, shiftKey: boolean) => {
    onSelectElement?.(id, shiftKey);
  };

  const handleMultiDragEnd = (draggedId: string, newX: number, newY: number) => {
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

            {/* Real board elements */}
            {elements.map((el) => {
              const isLine = el.type === "line";
              const resizable = !isLine;
              const editable = el.type === "sticky-note" || el.type === "text";
              const isSelected = selectedElementIds.has(el.id);
              return (
                <InteractiveShape
                  key={el.id}
                  element={el}
                  isSelected={isSelected}
                  multiSelected={isSelected && isMultiSelect}
                  draggable={draggable}
                  onSelect={handleSelect}
                  onDragStart={onDragElementStart}
                  onDragEnd={handleMultiDragEnd}
                  resizable={resizable}
                  onResize={resizable ? handleResize : undefined}
                  zoomScale={camera.scale}
                  onDblClick={editable ? handleDblClick : undefined}
                  hideSelectionOutline={isLine}
                >
                  {el.type === "sticky-note" && <StickyNote element={el} />}
                  {el.type === "rectangle" && <RectangleContent element={el} />}
                  {el.type === "circle" && <CircleContent element={el} />}
                  {el.type === "line" && <LineContent element={el} />}
                  {el.type === "text" && <TextContent element={el} />}
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
