import type { BoardElement, ConnectorElement, ConnectorRoutingStyle } from "@collab/shared/collab";

export type Point = { x: number; y: number };

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
 */
export function findNearbyAnchors(
  cursor: Point,
  elements: BoardElement[],
  excludeIds: Set<string>,
  threshold = ANCHOR_VISIBILITY_THRESHOLD,
): { element: BoardElement; anchors: Point[] }[] {
  const results: { element: BoardElement; anchors: Point[] }[] = [];

  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;
    if (el.type === "connector") continue;

    // Check if cursor is within threshold of the element's bounding box
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
 */
export function findSnapTarget(
  point: Point,
  elements: BoardElement[],
  excludeIds: Set<string>,
): { element: BoardElement; anchor: Point; anchorIndex: number } | null {
  let bestDist = SNAP_THRESHOLD;
  let bestResult: { element: BoardElement; anchor: Point; anchorIndex: number } | null = null;

  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;
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
 */
export function resolveEndpoints(
  connector: ConnectorElement,
  elements: BoardElement[],
): { from: Point; to: Point } {
  let from: Point = { x: connector.fromX, y: connector.fromY };
  let to: Point = { x: connector.toX, y: connector.toY };

  if (connector.fromId) {
    const fromEl = elements.find((e) => e.id === connector.fromId);
    if (fromEl) {
      const anchors = getEdgeAnchors(fromEl);
      const idx = connector.fromAnchor;
      from = idx != null && idx >= 0 && idx < anchors.length
        ? anchors[idx]
        : getAnchorPoint(fromEl, to);
    }
  }

  if (connector.toId) {
    const toEl = elements.find((e) => e.id === connector.toId);
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

/**
 * Compute the path points for a connector based on routing style.
 * For orthogonal routing, fromAnchor/toAnchor (0=top,1=right,2=bottom,3=left)
 * determine the exit/entry directions for a clean path.
 * elbowMidpoint overrides the auto-calculated bend position if set.
 */
export function computePath(
  from: Point,
  to: Point,
  routingStyle: ConnectorRoutingStyle,
  elbowMidpoint?: number | null,
  fromAnchor?: number | null,
  toAnchor?: number | null,
): number[] {
  switch (routingStyle) {
    case "straight":
      return computeStraightPath(from, to);
    case "curved":
      return computeCurvedPath(from, to, fromAnchor, toAnchor);
    case "orthogonal":
      return computeOrthogonalPath(from, to, elbowMidpoint, fromAnchor, toAnchor);
    default:
      return computeStraightPath(from, to);
  }
}

function computeStraightPath(from: Point, to: Point): number[] {
  return [from.x, from.y, to.x, to.y];
}

/** Outward direction vector for each anchor index */
const ANCHOR_DIR: Point[] = [
  { x: 0, y: -1 },  // 0 = top → exits upward
  { x: 1, y: 0 },   // 1 = right → exits rightward
  { x: 0, y: 1 },   // 2 = bottom → exits downward
  { x: -1, y: 0 },  // 3 = left → exits leftward
];

/** Margin to extend outward from anchor before bending */
const ROUTING_MARGIN = 30;

function getDir(anchorIdx: number | null | undefined): Point | null {
  if (anchorIdx == null || anchorIdx < 0 || anchorIdx > 3) return null;
  return ANCHOR_DIR[anchorIdx];
}

function computeCurvedPath(
  from: Point, to: Point,
  fromAnchor?: number | null, toAnchor?: number | null,
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
 * Determine whether an orthogonal path is horizontal-first or vertical-first.
 */
export function isOrthogonalHorizontalFirst(
  from: Point, to: Point,
  fromAnchor?: number | null, toAnchor?: number | null,
): boolean {
  const fDir = getDir(fromAnchor);
  if (fDir) return fDir.x !== 0;
  const tDir = getDir(toAnchor);
  if (tDir) return tDir.x !== 0;
  return Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
}

/**
 * Anchor-side-aware orthogonal routing.
 * Extends outward from each anchor in its natural direction, then connects
 * the two stubs with at most one additional bend segment.
 */
function computeOrthogonalPath(
  from: Point, to: Point,
  elbowMidpoint?: number | null,
  fromAnchor?: number | null, toAnchor?: number | null,
): number[] {
  // If user has set a manual elbowMidpoint, use the legacy simple algorithm
  if (elbowMidpoint != null) {
    return computeOrthogonalPathSimple(from, to, elbowMidpoint, fromAnchor, toAnchor);
  }

  const fDir = getDir(fromAnchor);
  const tDir = getDir(toAnchor);

  // If we don't have anchor info for either side, fall back to simple
  if (!fDir && !tDir) {
    return computeOrthogonalPathSimple(from, to, null, fromAnchor, toAnchor);
  }

  // Extend outward from each anchor
  const margin = ROUTING_MARGIN;
  const fExt: Point = fDir
    ? { x: from.x + fDir.x * margin, y: from.y + fDir.y * margin }
    : { ...from };
  const tExt: Point = tDir
    ? { x: to.x + tDir.x * margin, y: to.y + tDir.y * margin }
    : { ...to };

  const fHoriz = fDir ? fDir.x !== 0 : false;
  const tHoriz = tDir ? tDir.x !== 0 : false;

  // Build path: from → fExt → [connection segments] → tExt → to
  const points: number[] = [from.x, from.y];

  if (fHoriz && tHoriz) {
    // Both exit horizontally: connect with a vertical jog
    const midX = (fExt.x + tExt.x) / 2;
    points.push(midX, fExt.y, midX, tExt.y);
  } else if (!fHoriz && !tHoriz) {
    // Both exit vertically: connect with a horizontal jog
    const midY = (fExt.y + tExt.y) / 2;
    points.push(fExt.x, midY, tExt.x, midY);
  } else if (fHoriz && !tHoriz) {
    // From exits horizontally, to exits vertically → L-bend
    points.push(tExt.x, fExt.y);
  } else {
    // From exits vertically, to exits horizontally → L-bend
    points.push(fExt.x, tExt.y);
  }

  points.push(to.x, to.y);
  return deduplicatePoints(points);
}

/** Simple midpoint-based orthogonal routing (used when manual elbowMidpoint is set) */
function computeOrthogonalPathSimple(
  from: Point, to: Point,
  elbowMidpoint: number | null,
  fromAnchor?: number | null, toAnchor?: number | null,
): number[] {
  const hFirst = isOrthogonalHorizontalFirst(from, to, fromAnchor, toAnchor);

  if (hFirst) {
    const midX = elbowMidpoint != null ? elbowMidpoint : (from.x + to.x) / 2;
    return [from.x, from.y, midX, from.y, midX, to.y, to.x, to.y];
  } else {
    const midY = elbowMidpoint != null ? elbowMidpoint : (from.y + to.y) / 2;
    return [from.x, from.y, from.x, midY, to.x, midY, to.x, to.y];
  }
}

/** Remove consecutive duplicate points from a path */
function deduplicatePoints(pts: number[]): number[] {
  if (pts.length < 4) return pts;
  const result = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const prevX = result[result.length - 2];
    const prevY = result[result.length - 1];
    if (Math.abs(pts[i] - prevX) > 0.5 || Math.abs(pts[i + 1] - prevY) > 0.5) {
      result.push(pts[i], pts[i + 1]);
    }
  }
  return result;
}

/**
 * Compute the midpoint of a path (used for label positioning).
 */
export function getPathMidpoint(pathPoints: number[]): Point {
  if (pathPoints.length < 4) return { x: 0, y: 0 };

  if (pathPoints.length === 4) {
    return {
      x: (pathPoints[0] + pathPoints[2]) / 2,
      y: (pathPoints[1] + pathPoints[3]) / 2,
    };
  }

  // For multi-segment paths, find the physical midpoint
  const segments: { length: number; startIdx: number }[] = [];
  let totalLength = 0;
  for (let i = 0; i < pathPoints.length - 2; i += 2) {
    const segLen = Math.hypot(
      pathPoints[i + 2] - pathPoints[i],
      pathPoints[i + 3] - pathPoints[i + 1],
    );
    segments.push({ length: segLen, startIdx: i });
    totalLength += segLen;
  }

  let halfDist = totalLength / 2;
  for (const seg of segments) {
    if (halfDist <= seg.length) {
      const t = seg.length > 0 ? halfDist / seg.length : 0;
      return {
        x: pathPoints[seg.startIdx] + t * (pathPoints[seg.startIdx + 2] - pathPoints[seg.startIdx]),
        y: pathPoints[seg.startIdx + 1] + t * (pathPoints[seg.startIdx + 3] - pathPoints[seg.startIdx + 1]),
      };
    }
    halfDist -= seg.length;
  }

  const last = pathPoints.length;
  return { x: pathPoints[last - 2], y: pathPoints[last - 1] };
}

// ---------------------------------------------------------------------------
// Obstacle avoidance post-processor
// ---------------------------------------------------------------------------

const OBSTACLE_MARGIN = 20;

/** Check if an orthogonal segment crosses a rectangle */
function segmentCrossesRect(
  x1: number, y1: number, x2: number, y2: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const rl = rect.x;
  const rt = rect.y;
  const rr = rect.x + rect.width;
  const rb = rect.y + rect.height;

  const isHoriz = Math.abs(y1 - y2) < 1;
  const isVert = Math.abs(x1 - x2) < 1;

  if (isHoriz) {
    const y = (y1 + y2) / 2;
    if (y <= rt || y >= rb) return false;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    return maxX > rl && minX < rr;
  }

  if (isVert) {
    const x = (x1 + x2) / 2;
    if (x <= rl || x >= rr) return false;
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return maxY > rt && minY < rb;
  }

  return false;
}

/**
 * Post-process an orthogonal path to avoid crossing obstacle shapes.
 * Only applies to orthogonal routing. Skips connected shapes and other connectors.
 */
export function avoidObstacles(
  pathPoints: number[],
  connector: ConnectorElement,
  elements: BoardElement[],
): number[] {
  const excludeIds = new Set(
    [connector.id, connector.fromId, connector.toId].filter(Boolean),
  );
  const obstacles = elements.filter(
    (el) => el.type !== "connector" && !excludeIds.has(el.id),
  );

  if (obstacles.length === 0 || pathPoints.length < 4) return pathPoints;

  let current = pathPoints;

  // Iterate a few passes (a detour segment may itself cross another obstacle)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const next: number[] = [current[0], current[1]];

    for (let i = 0; i < current.length - 2; i += 2) {
      const ax = current[i];
      const ay = current[i + 1];
      const bx = current[i + 2];
      const by = current[i + 3];

      const isHoriz = Math.abs(ay - by) < 1;
      const isVert = Math.abs(ax - bx) < 1;

      if (!isHoriz && !isVert) {
        next.push(bx, by);
        continue;
      }

      let rerouted = false;
      for (const obs of obstacles) {
        if (!segmentCrossesRect(ax, ay, bx, by, obs)) continue;

        const ol = obs.x - OBSTACLE_MARGIN;
        const ot = obs.y - OBSTACLE_MARGIN;
        const or_ = obs.x + obs.width + OBSTACLE_MARGIN;
        const ob = obs.y + obs.height + OBSTACLE_MARGIN;

        if (isHoriz) {
          // Pick shorter detour: above or below
          const aboveDist = Math.abs(ay - ot);
          const belowDist = Math.abs(ob - ay);
          const dy = aboveDist <= belowDist ? ot : ob;
          next.push(ol, ay, ol, dy, or_, dy, or_, ay);
        } else {
          // Pick shorter detour: left or right
          const leftDist = Math.abs(ax - ol);
          const rightDist = Math.abs(or_ - ax);
          const dx = leftDist <= rightDist ? ol : or_;
          next.push(ax, ot, dx, ot, dx, ob, ax, ob);
        }

        rerouted = true;
        changed = true;
        break; // handle one obstacle per segment per pass
      }

      if (!rerouted) {
        next.push(bx, by);
      } else {
        next.push(bx, by);
      }
    }

    current = deduplicatePoints(next);
    if (!changed) break;
  }

  return current;
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
