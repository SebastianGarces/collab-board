import * as Y from "yjs";
import type { BoardElement } from "@collab/shared/collab";

/**
 * Clone an element from Yjs with a new ID and optional position offset
 */
export function cloneElementFromYjs(
  elementsMap: Y.Map<unknown>,
  id: string,
  offset: { x: number; y: number },
  newId: string
): Y.Map<unknown> | null {
  const sourceMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
  if (!sourceMap) return null;

  const clonedMap = new Y.Map<unknown>();
  
  // Copy all properties
  sourceMap.forEach((value, key) => {
    if (key === "id") {
      clonedMap.set("id", newId);
    } else if (key === "x") {
      const x = typeof value === "number" ? value : 0;
      clonedMap.set("x", x + offset.x);
    } else if (key === "y") {
      const y = typeof value === "number" ? value : 0;
      clonedMap.set("y", y + offset.y);
    } else if (key === "points" && Array.isArray(value)) {
      // Clone the points array for lines
      clonedMap.set("points", [...value]);
    } else {
      clonedMap.set(key, value);
    }
  });

  return clonedMap;
}

/**
 * Serialize a BoardElement to a plain object for clipboard
 */
export function serializeElement(element: BoardElement): Record<string, unknown> {
  // Return a plain object copy of all properties
  return {
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    ...(element.type === "sticky-note" && {
      text: element.text,
      color: element.color,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
    }),
    ...(element.type === "rectangle" && {
      fill: element.fill,
      stroke: element.stroke,
    }),
    ...(element.type === "circle" && {
      fill: element.fill,
      stroke: element.stroke,
    }),
    ...(element.type === "line" && {
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      points: [...element.points],
    }),
    ...(element.type === "text" && {
      text: element.text,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      fill: element.fill,
    }),
  };
}

/**
 * Deserialize a plain object to a Y.Map with a new ID and offset
 */
export function deserializeElement(
  data: Record<string, unknown>,
  newId: string,
  offset: { x: number; y: number }
): Y.Map<unknown> {
  const elementMap = new Y.Map<unknown>();
  
  // Set all properties
  Object.entries(data).forEach(([key, value]) => {
    if (key === "x") {
      const x = typeof value === "number" ? value : 0;
      elementMap.set("x", x + offset.x);
    } else if (key === "y") {
      const y = typeof value === "number" ? value : 0;
      elementMap.set("y", y + offset.y);
    } else if (key === "points" && Array.isArray(value)) {
      // Clone the points array
      elementMap.set("points", [...value]);
    } else {
      elementMap.set(key, value);
    }
  });
  
  elementMap.set("id", newId);
  
  return elementMap;
}

/**
 * Compute the axis-aligned bounding box of a single element accounting for rotation.
 */
export function getElementAABB(el: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}): { minX: number; minY: number; maxX: number; maxY: number } {
  const rotation = ((el.rotation ?? 0) * Math.PI) / 180;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const hw = el.width / 2;
  const hh = el.height / 2;
  const cosR = Math.abs(Math.cos(rotation));
  const sinR = Math.abs(Math.sin(rotation));
  const rotatedHW = hw * cosR + hh * sinR;
  const rotatedHH = hw * sinR + hh * cosR;
  return {
    minX: cx - rotatedHW,
    minY: cy - rotatedHH,
    maxX: cx + rotatedHW,
    maxY: cy + rotatedHH,
  };
}

/**
 * Calculate bounding box of multiple elements (accounts for rotation)
 */
export function getBoundingBox(elements: BoardElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (elements.length === 0) return null;
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  elements.forEach((el) => {
    const aabb = getElementAABB(el);
    minX = Math.min(minX, aabb.minX);
    minY = Math.min(minY, aabb.minY);
    maxX = Math.max(maxX, aabb.maxX);
    maxY = Math.max(maxY, aabb.maxY);
  });
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
