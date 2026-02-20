import type { BoardElement, ConnectorElement } from "@collab/shared/collab";

export type Point = { x: number; y: number };

export type AABB = { minX: number; minY: number; maxX: number; maxY: number };

/** Hit-test padding around the connector path (world pixels). */
export const CONNECTOR_HIT_PADDING = 20;

/**
 * Compute the axis-aligned bounding box of a connector's curved path,
 * including control points. Used for spatial index and hit testing.
 */
export function getConnectorPathAABB(
  connector: ConnectorElement,
  elementsById: Map<string, BoardElement>,
  padding = CONNECTOR_HIT_PADDING,
): AABB {
  const miniMap = new Map<string, BoardElement>();
  if (connector.fromId) {
    const el = elementsById.get(connector.fromId);
    if (el) miniMap.set(el.id, el);
  }
  if (connector.toId) {
    const el = elementsById.get(connector.toId);
    if (el) miniMap.set(el.id, el);
  }
  const { from, to } = resolveEndpoints(connector, miniMap);
  const pathPoints = computePath(from, to, connector.fromAnchor, connector.toAnchor);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pathPoints.length; i += 2) {
    const px = pathPoints[i];
    const py = pathPoints[i + 1];
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/** Snap threshold in world pixels */
export const SNAP_THRESHOLD = 30;

/** Distance from shape edge at which anchor points become visible */
export const ANCHOR_VISIBILITY_THRESHOLD = 120;

/**
 * Get the 4 edge center anchor points of a shape.
 */
export function getEdgeAnchors(element: BoardElement): Point[] {
  return [
    { x: element.x + element.width / 2, y: element.y },                          // top
    { x: element.x + element.width,     y: element.y + element.height / 2 },     // right
    { x: element.x + element.width / 2, y: element.y + element.height },          // bottom
    { x: element.x,                      y: element.y + element.height / 2 },     // left
  ];
}

/**
 * Find elements near a cursor that should show their anchor points.
 * Returns array of { element, anchors } for elements within threshold.
 * When a SpatialIndex is provided, uses spatial query instead of O(n) scan.
 */
export function findNearbyAnchors(
  cursor: Point,
  elements: BoardElement[],
  excludeIds: Set<string>,
  threshold = ANCHOR_VISIBILITY_THRESHOLD,
  index?: { queryPoint: (x: number, y: number, radius: number, exclude: Set<string>) => BoardElement[] },
): { element: BoardElement; anchors: Point[] }[] {
  const candidates = index
    ? index.queryPoint(cursor.x, cursor.y, threshold, excludeIds)
    : elements;
  const results: { element: BoardElement; anchors: Point[] }[] = [];

  for (const el of candidates) {
    if (!index && excludeIds.has(el.id)) continue;
    if (el.type === "connector") continue;

    const expandedX = el.x - threshold;
    const expandedY = el.y - threshold;
    const expandedW = el.width + threshold * 2;
    const expandedH = el.height + threshold * 2;

    if (
      cursor.x >= expandedX &&
      cursor.x <= expandedX + expandedW &&
      cursor.y >= expandedY &&
      cursor.y <= expandedY + expandedH
    ) {
      results.push({ element: el, anchors: getEdgeAnchors(el) });
    }
  }

  return results;
}

/**
 * Get the nearest discrete edge center anchor point on an element
 * given an approach direction. Snaps to one of 4 fixed points:
 * top-center, right-center, bottom-center, left-center.
 */
export function getAnchorPoint(element: BoardElement, approachFrom: Point): Point {
  const anchors = getEdgeAnchors(element);
  let bestDist = Infinity;
  let bestAnchor = anchors[0];

  for (const anchor of anchors) {
    const dist = Math.hypot(anchor.x - approachFrom.x, anchor.y - approachFrom.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestAnchor = anchor;
    }
  }

  return bestAnchor;
}

/**
 * Find the nearest element within snap threshold of a point.
 * Returns the element and the anchor point on its edge, or null.
 * When a SpatialIndex is provided, uses spatial query instead of O(n) scan.
 */
export function findSnapTarget(
  point: Point,
  elements: BoardElement[],
  excludeIds: Set<string>,
  index?: { queryPoint: (x: number, y: number, radius: number, exclude: Set<string>) => BoardElement[] },
): { element: BoardElement; anchor: Point; anchorIndex: number } | null {
  const candidates = index
    ? index.queryPoint(point.x, point.y, SNAP_THRESHOLD, excludeIds)
    : elements;
  let bestDist = SNAP_THRESHOLD;
  let bestResult: { element: BoardElement; anchor: Point; anchorIndex: number } | null = null;

  for (const el of candidates) {
    if (!index && excludeIds.has(el.id)) continue;
    if (el.type === "connector") continue;

    const anchors = getEdgeAnchors(el);
    for (let i = 0; i < anchors.length; i++) {
      const dist = Math.hypot(anchors[i].x - point.x, anchors[i].y - point.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestResult = { element: el, anchor: anchors[i], anchorIndex: i };
      }
    }
  }

  return bestResult;
}

/**
 * Resolve actual endpoint positions for a connector,
 * looking up connected elements if fromId/toId is set.
 * Uses the stored anchor index (0=top, 1=right, 2=bottom, 3=left)
 * to respect the user's explicit anchor choice.
 * Accepts either an array or a Map for element lookup.
 */
export function resolveEndpoints(
  connector: ConnectorElement,
  elements: BoardElement[] | Map<string, BoardElement>,
): { from: Point; to: Point } {
  const lookup = elements instanceof Map
    ? (id: string) => elements.get(id)
    : (id: string) => elements.find((e) => e.id === id);

  let from: Point = { x: connector.fromX, y: connector.fromY };
  let to: Point = { x: connector.toX, y: connector.toY };

  if (connector.fromId) {
    const fromEl = lookup(connector.fromId);
    if (fromEl) {
      const anchors = getEdgeAnchors(fromEl);
      const idx = connector.fromAnchor;
      from = idx != null && idx >= 0 && idx < anchors.length
        ? anchors[idx]
        : getAnchorPoint(fromEl, to);
    }
  }

  if (connector.toId) {
    const toEl = lookup(connector.toId);
    if (toEl) {
      const anchors = getEdgeAnchors(toEl);
      const idx = connector.toAnchor;
      to = idx != null && idx >= 0 && idx < anchors.length
        ? anchors[idx]
        : getAnchorPoint(toEl, from);
    }
  }

  return { from, to };
}

/** Outward direction vector for each anchor index */
const ANCHOR_DIR: Point[] = [
  { x: 0, y: -1 },  // 0 = top
  { x: 1, y: 0 },   // 1 = right
  { x: 0, y: 1 },   // 2 = bottom
  { x: -1, y: 0 },  // 3 = left
];

function getDir(anchorIdx: number | null | undefined): Point | null {
  if (anchorIdx == null || anchorIdx < 0 || anchorIdx > 3) return null;
  return ANCHOR_DIR[anchorIdx];
}

/**
 * Compute the curved path points for a connector.
 * Always returns 8 values: [fromX, fromY, cp1X, cp1Y, cp2X, cp2Y, toX, toY]
 */
export function computePath(
  from: Point,
  to: Point,
  fromAnchor?: number | null,
  toAnchor?: number | null,
): number[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const offset = Math.max(dist * 0.35, 40);

  const fDir = getDir(fromAnchor);
  const tDir = getDir(toAnchor);

  const cp1: Point = fDir
    ? { x: from.x + fDir.x * offset, y: from.y + fDir.y * offset }
    : Math.abs(to.x - from.x) > Math.abs(to.y - from.y)
      ? { x: from.x + Math.sign(to.x - from.x) * offset, y: from.y }
      : { x: from.x, y: from.y + Math.sign(to.y - from.y) * offset };

  const cp2: Point = tDir
    ? { x: to.x + tDir.x * offset, y: to.y + tDir.y * offset }
    : Math.abs(to.x - from.x) > Math.abs(to.y - from.y)
      ? { x: to.x - Math.sign(to.x - from.x) * offset, y: to.y }
      : { x: to.x, y: to.y - Math.sign(to.y - from.y) * offset };

  return [from.x, from.y, cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y];
}

/**
 * Compute the midpoint of a curved path (used for label positioning).
 * For a cubic bezier, evaluates at t=0.5.
 */
export function getPathMidpoint(pathPoints: number[]): Point {
  if (pathPoints.length < 4) return { x: 0, y: 0 };

  if (pathPoints.length === 8) {
    const t = 0.5;
    const mt = 1 - t;
    const x = mt * mt * mt * pathPoints[0]
      + 3 * mt * mt * t * pathPoints[2]
      + 3 * mt * t * t * pathPoints[4]
      + t * t * t * pathPoints[6];
    const y = mt * mt * mt * pathPoints[1]
      + 3 * mt * mt * t * pathPoints[3]
      + 3 * mt * t * t * pathPoints[5]
      + t * t * t * pathPoints[7];
    return { x, y };
  }

  return {
    x: (pathPoints[0] + pathPoints[pathPoints.length - 2]) / 2,
    y: (pathPoints[1] + pathPoints[pathPoints.length - 1]) / 2,
  };
}

/**
 * Compute arrowhead points for rendering.
 * Returns an array of points forming the arrowhead triangle.
 */
export function computeArrowhead(
  tip: Point,
  from: Point,
  size: number,
): number[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  const halfW = size * 0.5;

  return [
    tip.x, tip.y,
    baseX + px * halfW, baseY + py * halfW,
    baseX - px * halfW, baseY - py * halfW,
  ];
}

/**
 * Compute diamond points for rendering.
 */
export function computeDiamond(
  tip: Point,
  from: Point,
  size: number,
): number[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const halfW = size * 0.4;
  const midX = tip.x - ux * size * 0.5;
  const midY = tip.y - uy * size * 0.5;

  return [
    tip.x, tip.y,
    midX + px * halfW, midY + py * halfW,
    tip.x - ux * size, tip.y - uy * size,
    midX - px * halfW, midY - py * halfW,
  ];
}
