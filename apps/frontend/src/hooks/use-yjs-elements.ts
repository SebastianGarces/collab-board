"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";

import { MIN_ELEMENT_SIZE } from "@/components/canvas/shape-transform";
import type { BoardElement } from "@collab/shared/collab";
import { DEFAULT_FONT_FAMILY, DEFAULT_STICKY_NOTE_FONT_SIZE } from "@collab/shared/collab";

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toSafeSize(value: unknown, fallback: number): number {
  return Math.max(MIN_ELEMENT_SIZE, toFiniteNumber(value, fallback));
}

function yMapToElement(id: string, map: Y.Map<unknown>): BoardElement | null {
  const type = map.get("type") as string | undefined;
  if (!type) return null;

  const base = {
    id,
    type: type as BoardElement["type"],
    x: toFiniteNumber(map.get("x"), 0),
    y: toFiniteNumber(map.get("y"), 0),
    width: toSafeSize(map.get("width"), 200),
    height: toSafeSize(map.get("height"), 200),
  };

  if (type === "sticky-note") {
    return {
      ...base,
      type: "sticky-note",
      text: (map.get("text") as string) ?? "",
      color: (map.get("color") as string) ?? "#facc15",
      fontSize: toFiniteNumber(map.get("fontSize"), DEFAULT_STICKY_NOTE_FONT_SIZE),
      fontFamily: (map.get("fontFamily") as string) || DEFAULT_FONT_FAMILY,
    };
  }

  if (type === "rectangle") {
    return {
      ...base,
      type: "rectangle",
      fill: (map.get("fill") as string) ?? "#3b82f6",
      stroke: (map.get("stroke") as string) ?? "#1e40af",
    };
  }

  if (type === "circle") {
    return {
      ...base,
      type: "circle",
      fill: (map.get("fill") as string) ?? "#8b5cf6",
      stroke: (map.get("stroke") as string) ?? "#6d28d9",
    };
  }

  if (type === "line") {
    const rawPoints = map.get("points");
    const lineWidth = Math.max(0, toFiniteNumber(map.get("width"), 200));
    const lineHeight = Math.max(0, toFiniteNumber(map.get("height"), 200));
    let points = Array.isArray(rawPoints)
      ? (rawPoints as number[])
      : [0, 0, lineWidth, lineHeight];

    let finalX = base.x;
    let finalY = base.y;
    let finalW = lineWidth;
    let finalH = lineHeight;

    if (points.length >= 4) {
      const allX: number[] = [];
      const allY: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        allX.push(points[i]);
        allY.push(points[i + 1]);
      }
      const minPx = Math.min(...allX);
      const minPy = Math.min(...allY);

      if (minPx < 0 || minPy < 0) {
        const maxPx = Math.max(...allX);
        const maxPy = Math.max(...allY);
        finalX = base.x + minPx;
        finalY = base.y + minPy;
        finalW = maxPx - minPx;
        finalH = maxPy - minPy;
        points = points.map((v, i) => (i % 2 === 0 ? v - minPx : v - minPy));

        map.doc?.transact(() => {
          map.set("x", finalX);
          map.set("y", finalY);
          map.set("width", finalW);
          map.set("height", finalH);
          map.set("points", points);
        });
      }
    }

    return {
      id: base.id,
      type: "line",
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
      stroke: (map.get("stroke") as string) ?? "#f8fafc",
      strokeWidth: toFiniteNumber(map.get("strokeWidth"), 3),
      points,
    };
  }

  if (type === "text") {
    return {
      ...base,
      type: "text",
      text: (map.get("text") as string) ?? "",
      fontSize: toFiniteNumber(map.get("fontSize"), 18),
      fontFamily: (map.get("fontFamily") as string) || DEFAULT_FONT_FAMILY,
      fill: (map.get("fill") as string) ?? "#f8fafc",
    };
  }

  return null;
}

export function useYjsElements(doc: Y.Doc | null): BoardElement[] {
  const [elements, setElements] = useState<BoardElement[]>([]);

  useEffect(() => {
    if (!doc) {
      setElements([]);
      return;
    }

    const elementsMap = doc.getMap("elements");

    const sync = () => {
      const next: BoardElement[] = [];
      elementsMap.forEach((value, key) => {
        if (value && typeof (value as Y.Map<unknown>).get === "function") {
          const el = yMapToElement(key, value as Y.Map<unknown>);
          if (el) next.push(el);
        }
      });
      setElements(next);
    };

    sync();
    elementsMap.observeDeep(sync);
    return () => {
      elementsMap.unobserveDeep(sync);
    };
  }, [doc]);

  return elements;
}
