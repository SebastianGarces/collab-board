"use client";

import { RotateCw, RotateCcw } from "lucide-react";

type RotationCorner = "nw" | "ne" | "se" | "sw";

type RotationCursorProps = {
  x: number;
  y: number;
  corner: RotationCorner;
  elementRotation: number;
};

export function RotationCursor({ x, y, corner, elementRotation }: RotationCursorProps) {
  const isClockwise = corner === "ne" || corner === "sw";
  const Icon = isClockwise ? RotateCw : RotateCcw;

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: `translate(-50%, -50%) rotate(${elementRotation}deg)`,
      }}
    >
      <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2} />
    </div>
  );
}
