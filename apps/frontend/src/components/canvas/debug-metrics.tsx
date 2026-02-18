"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";

import type { BoardElement } from "@collab/shared/collab";
import { useCanvasStore } from "@/stores/canvas-store";

type InteractionState = "idle" | "panning" | "dragging" | "drawing" | "editing";

type DebugMetricsProps = {
  camera: { x: number; y: number; scale: number };
  elements: BoardElement[];
  activeTool: string;
  isPanning: boolean;
  isDraggingElement: boolean;
  isDrawing: boolean;
  editingElementId: string | null;
  pointerPositionRef: React.RefObject<{ x: number; y: number }>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
};

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

export function DebugMetrics({
  camera,
  elements,
  activeTool,
  isPanning,
  isDraggingElement,
  isDrawing,
  editingElementId,
  pointerPositionRef,
  surfaceRef,
  stageRef,
}: DebugMetricsProps) {
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);

  const [fps, setFps] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [konvaNodes, setKonvaNodes] = useState(0);
  const [screenPos, setScreenPos] = useState({ x: 0, y: 0 });
  const [worldPos, setWorldPos] = useState({ x: 0, y: 0 });

  const frameTimesRef = useRef<number[]>([]);
  const lastFrameRef = useRef(0);

  const updatePointerPositions = useCallback(() => {
    const ptr = pointerPositionRef.current;
    if (!ptr) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const sx = Math.round(ptr.x - rect.left);
    const sy = Math.round(ptr.y - rect.top);
    setScreenPos({ x: sx, y: sy });
    setWorldPos({
      x: Math.round((sx - camera.x) / camera.scale),
      y: Math.round((sy - camera.y) / camera.scale),
    });
  }, [camera.x, camera.y, camera.scale, pointerPositionRef, surfaceRef]);

  useEffect(() => {
    let rafId = 0;
    const onFrame = (now: number) => {
      if (lastFrameRef.current > 0) {
        const dt = now - lastFrameRef.current;
        const times = frameTimesRef.current;
        times.push(dt);
        if (times.length > 60) times.shift();
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        setFps(Math.round(1000 / avg));
        setFrameTime(+(avg).toFixed(1));
      }
      lastFrameRef.current = now;
      updatePointerPositions();
      rafId = requestAnimationFrame(onFrame);
    };
    rafId = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(rafId);
  }, [updatePointerPositions]);

  useEffect(() => {
    const interval = setInterval(() => {
      const stage = stageRef.current;
      if (stage) {
        try {
          setKonvaNodes(stage.find("*").length);
        } catch {
          setKonvaNodes(0);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [stageRef]);

  const interaction = deriveInteraction(isPanning, isDraggingElement, isDrawing, editingElementId);
  const selectedCount = selectedElementIds.size;

  return (
    <div className="absolute bottom-4 right-4 z-50 pointer-events-none select-none">
      <div className="bg-[#121212]/85 border border-[#2a2a2a] rounded-lg px-4 py-3 text-base font-mono leading-relaxed text-[#999] backdrop-blur-sm">
        <div className="text-[15px] font-semibold tracking-wider text-[#666] mb-1.5">DEBUG</div>
        <div className="border-t border-[#2a2a2a] pt-1.5 space-y-0.5">
          <Row label="FPS" value={fps} highlight />
          <Row label="Frame" value={`${frameTime} ms`} />
        </div>
        <div className="border-t border-[#2a2a2a] mt-1.5 pt-1.5 space-y-0.5">
          <Row label="Objects" value={elements.length} />
          <Row label="Konva nodes" value={konvaNodes} />
          <Row label="Selected" value={selectedCount === 0 ? "none" : selectedCount} />
          <Row label="Interaction" value={interaction} />
          <Row label="Tool" value={activeTool} />
        </div>
        <div className="border-t border-[#2a2a2a] mt-1.5 pt-1.5 space-y-0.5">
          <Row label="Zoom" value={`${Math.round(camera.scale * 100)}%`} />
          <Row label="Pan" value={`${Math.round(camera.x)}, ${Math.round(camera.y)}`} />
          <Row label="Screen" value={`${screenPos.x}, ${screenPos.y}`} />
          <Row label="World" value={`${worldPos.x}, ${worldPos.y}`} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-6">
      <span>{label}</span>
      <span className={highlight ? "text-[#4ade80]" : "text-[#ccc]"}>{value}</span>
    </div>
  );
}
