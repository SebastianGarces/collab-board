"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";

import type { BoardElement } from "@collab/shared/collab";
import { MIN_ELEMENT_SIZE } from "@/components/canvas/shape-transform";

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
