"use client";

import { useEffect, useState, type RefObject } from "react";
import { RotateCw, RotateCcw } from "lucide-react";

type RotationCorner = "nw" | "ne" | "se" | "sw";

type RotationCursorProps = {
  pointerRef: RefObject<{ x: number; y: number }>;
  corner: RotationCorner;
  elementRotation: number;
};

export function RotationCursor({ pointerRef, corner, elementRotation }: RotationCursorProps) {
  const isClockwise = corner === "ne" || corner === "sw";
  const Icon = isClockwise ? RotateCw : RotateCcw;
  const [position, setPosition] = useState(() => pointerRef.current ?? { x: 0, y: 0 });

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const next = pointerRef.current ?? { x: 0, y: 0 };
      setPosition((prev) => (prev.x === next.x && prev.y === next.y ? prev : next));
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [pointerRef]);

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `translate(-50%, -50%) rotate(${elementRotation}deg)`,
      }}
    >
      <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2} />
    </div>
  );
}
