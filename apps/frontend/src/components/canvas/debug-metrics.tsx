"use client";

import { memo, useEffect, useRef } from "react";
import type Konva from "konva";

import type { BoardElement } from "@collab/shared/collab";
import { useCanvasStore } from "@/stores/canvas-store";

type InteractionState = "idle" | "panning" | "dragging" | "drawing" | "editing";

type DebugMetricsProps = {
  camera: { x: number; y: number; scale: number };
  elements: BoardElement[];
  isPanning: boolean;
  isDrawing: boolean;
  editingElementId: string | null;
  pointerPositionRef: React.RefObject<{ x: number; y: number }>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
};

const MAX_FRAME_TIMES = 60;
const KONVA_NODE_POLL_MS = 2000;
const POINTER_THROTTLE_FRAMES = 3;

function deriveInteraction(
  isPanning: boolean,
  isDragging: boolean,
  isDrawing: boolean,
  editingId: string | null,
): InteractionState {
  if (editingId) return "editing";
  if (isDrawing) return "drawing";
  if (isDragging) return "dragging";
  if (isPanning) return "panning";
  return "idle";
}

function DebugMetricsInner({
  camera,
  elements,
  isPanning,
  isDrawing,
  editingElementId,
  pointerPositionRef,
  surfaceRef,
  stageRef,
}: DebugMetricsProps) {
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const isDraggingElement = useCanvasStore((s) => s.isDraggingElement);

  // DOM refs for high-frequency values (bypass React reconciliation)
  const fpsRef = useRef<HTMLSpanElement>(null);
  const frameTimeRef = useRef<HTMLSpanElement>(null);
  const konvaNodesRef = useRef<HTMLSpanElement>(null);
  const screenPosRef = useRef<HTMLSpanElement>(null);
  const worldPosRef = useRef<HTMLSpanElement>(null);

  const frameTimesRef = useRef(new Float64Array(MAX_FRAME_TIMES));
  const frameTimesCount = useRef(0);
  const frameTimesHead = useRef(0);
  const lastFrameRef = useRef(0);
  const frameCountRef = useRef(0);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  useEffect(() => {
    let rafId = 0;
    const buf = frameTimesRef.current;

    const onFrame = (now: number) => {
      if (lastFrameRef.current > 0) {
        const dt = now - lastFrameRef.current;
        buf[frameTimesHead.current] = dt;
        frameTimesHead.current = (frameTimesHead.current + 1) % MAX_FRAME_TIMES;
        if (frameTimesCount.current < MAX_FRAME_TIMES) frameTimesCount.current++;

        const count = frameTimesCount.current;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += buf[i];
        const avg = sum / count;

        if (fpsRef.current) fpsRef.current.textContent = String(Math.round(1000 / avg));
        if (frameTimeRef.current) frameTimeRef.current.textContent = `${avg.toFixed(1)} ms`;
      }
      lastFrameRef.current = now;

      frameCountRef.current++;
      if (frameCountRef.current % POINTER_THROTTLE_FRAMES === 0) {
        const ptr = pointerPositionRef.current;
        const surface = surfaceRef.current;
        if (ptr && surface) {
          const rect = surface.getBoundingClientRect();
          const cam = cameraRef.current;
          const sx = Math.round(ptr.x - rect.left);
          const sy = Math.round(ptr.y - rect.top);
          if (screenPosRef.current) screenPosRef.current.textContent = `${sx}, ${sy}`;
          if (worldPosRef.current) {
            const wx = Math.round((sx - cam.x) / cam.scale);
            const wy = Math.round((sy - cam.y) / cam.scale);
            worldPosRef.current.textContent = `${wx}, ${wy}`;
          }
        }
      }

      rafId = requestAnimationFrame(onFrame);
    };
    rafId = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(rafId);
  }, [pointerPositionRef, surfaceRef]);

  useEffect(() => {
    const interval = setInterval(() => {
      const stage = stageRef.current;
      if (!konvaNodesRef.current) return;
      if (stage) {
        try {
          const layers = stage.getLayers();
          let count = 0;
          for (const layer of layers) {
            count += layer.children?.length ?? 0;
          }
          konvaNodesRef.current.textContent = String(count);
        } catch {
          konvaNodesRef.current.textContent = "0";
        }
      }
    }, KONVA_NODE_POLL_MS);
    return () => clearInterval(interval);
  }, [stageRef]);

  const interaction = deriveInteraction(isPanning, isDraggingElement, isDrawing, editingElementId);
  const selectedCount = selectedElementIds.size;

  return (
    <div className="absolute bottom-4 left-4 z-50 pointer-events-none select-none">
      <div className="bg-[#121212]/85 border border-[#2a2a2a] rounded-lg px-4 py-3 text-base font-mono leading-relaxed text-[#999] backdrop-blur-sm">
        <div className="text-[15px] font-semibold tracking-wider text-[#666] mb-1.5">DEBUG</div>
        <div className="border-t border-[#2a2a2a] pt-1.5 space-y-0.5">
          <Row label="FPS" valueRef={fpsRef} initial="0" highlight />
          <Row label="Frame" valueRef={frameTimeRef} initial="0 ms" />
        </div>
        <div className="border-t border-[#2a2a2a] mt-1.5 pt-1.5 space-y-0.5">
          <Row label="Objects" value={elements.length} />
          <Row label="Konva nodes" valueRef={konvaNodesRef} initial="0" />
          <Row label="Selected" value={selectedCount === 0 ? "none" : selectedCount} />
          <Row label="Interaction" value={interaction} />
          <Row label="Tool" value={activeTool} />
        </div>
        <div className="border-t border-[#2a2a2a] mt-1.5 pt-1.5 space-y-0.5">
          <Row label="Zoom" value={`${Math.round(camera.scale * 100)}%`} />
          <Row label="Pan" value={`${Math.round(camera.x)}, ${Math.round(camera.y)}`} />
          <Row label="Screen" valueRef={screenPosRef} initial="0, 0" />
          <Row label="World" valueRef={worldPosRef} initial="0, 0" />
        </div>
      </div>
    </div>
  );
}

type RowProps = {
  label: string;
  highlight?: boolean;
} & (
  | { value: string | number; valueRef?: never; initial?: never }
  | { valueRef: React.RefObject<HTMLSpanElement | null>; initial: string; value?: never }
);

function Row({ label, value, valueRef, initial, highlight }: RowProps) {
  return (
    <div className="flex justify-between gap-6">
      <span>{label}</span>
      <span
        ref={valueRef ?? undefined}
        className={`min-w-[10ch] text-right ${highlight ? "text-[#4ade80]" : "text-[#ccc]"}`}
      >
        {value ?? initial}
      </span>
    </div>
  );
}

export const DebugMetrics = memo(DebugMetricsInner);
