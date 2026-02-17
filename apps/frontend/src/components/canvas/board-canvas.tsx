"use client";

import { useEffect, useRef, useState } from "react";
import { Layer, Rect, Stage } from "react-konva";

import type { BoardElement } from "@collab/shared/collab";

import { InteractiveShape } from "./interactive-shape";
import { StickyNote } from "./sticky-note";
import { RectangleContent } from "./rectangle-element";
import type { ElementBox } from "./shape-transform";

type BoardCanvasProps = {
  camera: { x: number; y: number; scale: number };
  syntheticObjectCount?: number;
  elements?: BoardElement[];
  selectedElementId?: string | null;
  activeTool?: string;
  onSelectElement?: (id: string) => void;
  onDragElement?: (id: string, x: number, y: number) => void;
  onResizeElement?: (id: string, box: ElementBox) => void;
  onDblClickElement?: (id: string) => void;
  onStagePointerDown?: (worldX: number, worldY: number) => void;
  onStagePointerMove?: (worldX: number, worldY: number) => void;
  onStagePointerUp?: () => void;
};

export function BoardCanvas({
  camera,
  syntheticObjectCount = 0,
  elements = [],
  selectedElementId = null,
  activeTool = "pointer",
  onSelectElement,
  onDragElement,
  onResizeElement,
  onDblClickElement,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  const isPointerMode = activeTool === "pointer";
  const draggable = isPointerMode;

  const handleSelect = (id: string) => {
    onSelectElement?.(id);
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    onDragElement?.(id, x, y);
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
              onStagePointerDown?.(0, 0);
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
              const resizable = el.type !== "sticky-note";
              return (
                <InteractiveShape
                  key={el.id}
                  element={el}
                  isSelected={selectedElementId === el.id}
                  draggable={draggable}
                  onSelect={handleSelect}
                  onDragEnd={handleDragEnd}
                  resizable={resizable}
                  onResize={resizable ? handleResize : undefined}
                  zoomScale={camera.scale}
                  onDblClick={el.type === "sticky-note" ? handleDblClick : undefined}
                >
                  {el.type === "sticky-note" && <StickyNote element={el} />}
                  {el.type === "rectangle" && <RectangleContent element={el} />}
                </InteractiveShape>
              );
            })}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
