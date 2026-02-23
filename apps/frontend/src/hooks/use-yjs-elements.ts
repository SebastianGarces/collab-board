"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

import { MIN_ELEMENT_SIZE } from "@/components/canvas/shape-transform";
import type { BoardElement } from "@collab/shared/collab";
import {
    DEFAULT_CONNECTOR_STROKE,
    DEFAULT_CONNECTOR_STROKE_WIDTH,
    DEFAULT_FONT_FAMILY,
    DEFAULT_STICKY_NOTE_FONT_SIZE,
} from "@collab/shared/collab";

type YjsElementsSnapshot = {
  elements: BoardElement[];
  changedIds: ReadonlySet<string>;
  orderChanged: boolean;
  version: number;
};

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  // Handle plain objects
  if (a != null && b != null && typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = Object.keys(aObj);
    if (keys.length !== Object.keys(bObj).length) return false;
    for (const key of keys) {
      if (aObj[key] !== bObj[key]) return false;
    }
    return true;
  }
  return false;
}

function elementsEqual(a: BoardElement, b: BoardElement): boolean {
  if (a.id !== b.id || a.type !== b.type) return false;
  const aObj = a as unknown as Record<string, unknown>;
  const bObj = b as unknown as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!valuesEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

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
    rotation: toFiniteNumber(map.get("rotation"), 0),
    frameId: (map.get("frameId") as string) || null,
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

  if (type === "frame") {
    const strokeStyle = map.get("strokeStyle") as string | undefined;
    return {
      ...base,
      type: "frame",
      title: (map.get("title") as string) ?? "Section",
      fill: (map.get("fill") as string) ?? "#f5f5f5",
      stroke: (map.get("stroke") as string) ?? "#d4d4d4",
      strokeStyle:
        strokeStyle === "solid" || strokeStyle === "dashed" || strokeStyle === "none"
          ? strokeStyle
          : "solid",
      hidden: (map.get("hidden") as boolean) ?? false,
    };
  }

  if (type === "connector") {
    const startArrow = map.get("startArrow") as string | undefined;
    const endArrow = map.get("endArrow") as string | undefined;
    const dashStyle = map.get("dashStyle") as string | undefined;

    const fromX = toFiniteNumber(map.get("fromX"), 0);
    const fromY = toFiniteNumber(map.get("fromY"), 0);
    const toX = toFiniteNumber(map.get("toX"), 0);
    const toY = toFiniteNumber(map.get("toY"), 0);

    const bboxX = Math.min(fromX, toX);
    const bboxY = Math.min(fromY, toY);
    const bboxW = Math.max(Math.abs(toX - fromX), 1);
    const bboxH = Math.max(Math.abs(toY - fromY), 1);

    return {
      id: base.id,
      type: "connector",
      x: bboxX,
      y: bboxY,
      width: bboxW,
      height: bboxH,
      fromId: (map.get("fromId") as string) ?? "",
      toId: (map.get("toId") as string) ?? "",
      fromAnchor: (() => {
        const raw = map.get("fromAnchor");
        if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 3) return raw;
        return null;
      })(),
      toAnchor: (() => {
        const raw = map.get("toAnchor");
        if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 3) return raw;
        return null;
      })(),
      fromX,
      fromY,
      toX,
      toY,
      routingStyle: "curved" as const,
      startArrow:
        startArrow === "none" || startArrow === "arrow" || startArrow === "diamond"
          ? startArrow
          : "none",
      endArrow:
        endArrow === "none" || endArrow === "arrow" || endArrow === "diamond"
          ? endArrow
          : "none",
      stroke: (map.get("stroke") as string) ?? DEFAULT_CONNECTOR_STROKE,
      strokeWidth: toFiniteNumber(map.get("strokeWidth"), DEFAULT_CONNECTOR_STROKE_WIDTH),
      dashStyle:
        dashStyle === "solid" || dashStyle === "dashed" || dashStyle === "dotted"
          ? dashStyle
          : "solid",
      labelText: (map.get("labelText") as string) ?? "",
      labelFontSize: toFiniteNumber(map.get("labelFontSize"), 14),
      labelFontFamily: (map.get("labelFontFamily") as string) || DEFAULT_FONT_FAMILY,
      labelFill: (map.get("labelFill") as string) ?? "#f8fafc",
      labelBold: (map.get("labelBold") as boolean) ?? false,
      labelStrikethrough: (map.get("labelStrikethrough") as boolean) ?? false,
    };
  }

  return null;
}

export function useYjsElements(doc: Y.Doc | null): YjsElementsSnapshot {
  const [snapshot, setSnapshot] = useState<YjsElementsSnapshot>({
    elements: [],
    changedIds: new Set<string>(),
    orderChanged: false,
    version: 0,
  });
  const orderRef = useRef<string[]>([]);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!doc) {
      setSnapshot({ elements: [], changedIds: new Set<string>(), orderChanged: true, version: 0 });
      orderRef.current = [];
      return;
    }

    const elementsMap = doc.getMap("elements");

    const buildOrder = () => {
      const order: string[] = [];
      elementsMap.forEach((_value, key) => {
        order.push(key);
      });
      return order;
    };

    const syncAll = () => {
      const order = buildOrder();
      const next: BoardElement[] = [];
      for (const key of order) {
        const value = elementsMap.get(key);
        if (value && typeof (value as Y.Map<unknown>).get === "function") {
          const el = yMapToElement(key, value as Y.Map<unknown>);
          if (el) next.push(el);
        }
      }
      orderRef.current = order;
      prevCountRef.current = next.length;
      setSnapshot((prev) => ({
        elements: next,
        changedIds: new Set(order),
        orderChanged: true,
        version: prev.version + 1,
      }));
    };

    const LOCAL_INTERACTIVE_ORIGINS = new Set([
      "group-drag-move",
      "element-drag-move",
    ]);

    let pendingChangedIds = new Set<string>();
    let pendingOrderChange = false;
    let rafId = 0;

    const flushPending = () => {
      rafId = 0;
      const changedIds = pendingChangedIds;
      const orderMayHaveChanged = pendingOrderChange;
      pendingChangedIds = new Set();
      pendingOrderChange = false;

      if (changedIds.size === 0 && !orderMayHaveChanged) return;

      const nextOrder = orderMayHaveChanged ? buildOrder() : orderRef.current;
      if (nextOrder.length === 0) {
        const previousIds = new Set(orderRef.current);
        orderRef.current = nextOrder;
        // Hint Yjs GC after mass deletion to free tombstone memory
        if (prevCountRef.current > 0 && doc) {
          doc.gc = true;
          doc.transact(() => {}, "gc-hint");
        }
        prevCountRef.current = 0;
        setSnapshot((prev) => ({
          elements: [],
          changedIds: previousIds,
          orderChanged: true,
          version: prev.version + 1,
        }));
        return;
      }

      setSnapshot((prevSnapshot) => {
        const prev = prevSnapshot.elements;
        const byId = new Map(prev.map((element) => [element.id, element]));
        let anyChanged = false;

        for (const id of changedIds) {
          const value = elementsMap.get(id);
          if (!value || typeof (value as Y.Map<unknown>).get !== "function") {
            if (byId.has(id)) {
              byId.delete(id);
              anyChanged = true;
            }
            continue;
          }

          const nextElement = yMapToElement(id, value as Y.Map<unknown>);
          if (nextElement) {
            const existing = byId.get(id);
            if (existing && elementsEqual(existing, nextElement)) {
              byId.set(id, existing);
            } else {
              byId.set(id, nextElement);
              anyChanged = true;
            }
          } else if (byId.has(id)) {
            byId.delete(id);
            anyChanged = true;
          }
        }

        if (!anyChanged && !orderMayHaveChanged) return prevSnapshot;

        const nextElements = nextOrder
          .map((id) => byId.get(id))
          .filter((value): value is BoardElement => !!value);

        // Structural equality: skip update if same length and all refs match
        if (nextElements.length === prev.length) {
          let same = true;
          for (let i = 0; i < nextElements.length; i++) {
            if (nextElements[i] !== prev[i]) { same = false; break; }
          }
          if (same) return prevSnapshot;
        }

        orderRef.current = nextOrder;
        prevCountRef.current = nextElements.length;
        return {
          elements: nextElements,
          changedIds: new Set(changedIds),
          orderChanged: orderMayHaveChanged,
          version: prevSnapshot.version + 1,
        };
      });
    };

    const syncIncremental = (events: Y.YEvent<Y.AbstractType<any>>[], transaction: Y.Transaction) => {
      if (
        transaction.local &&
        typeof transaction.origin === "string" &&
        LOCAL_INTERACTIVE_ORIGINS.has(transaction.origin)
      ) return;
      for (const event of events) {
        const keyPath = event.path?.[0];
        if (typeof keyPath === "string") {
          pendingChangedIds.add(keyPath);
        }

        if (event.target === elementsMap) {
          pendingOrderChange = true;
          if ("keysChanged" in event && event.keysChanged instanceof Set) {
            for (const key of event.keysChanged) {
              if (typeof key === "string") {
                pendingChangedIds.add(key);
              }
            }
          }
        }
      }

      if (rafId === 0) {
        rafId = requestAnimationFrame(flushPending);
      }
    };

    syncAll();
    elementsMap.observeDeep(syncIncremental);
    return () => {
      elementsMap.unobserveDeep(syncIncremental);
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [doc]);

  return snapshot;
}
