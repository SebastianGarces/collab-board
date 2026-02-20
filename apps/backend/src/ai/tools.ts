import {
  DEFAULT_CIRCLE_SIZE,
  DEFAULT_CONNECTOR_STROKE,
  DEFAULT_CONNECTOR_STROKE_WIDTH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FRAME_SIZE,
  DEFAULT_RECTANGLE_SIZE,
  DEFAULT_STICKY_NOTE_FONT_SIZE,
  DEFAULT_STICKY_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  STICKY_NOTE_COLORS,
} from "@collab/shared/collab";
import { tool } from "@langchain/core/tools";
import * as Y from "yjs";
import { z } from "zod";

function generateId(): string {
  return crypto.randomUUID();
}

function yMapToPlainObject(ymap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

const AI_FIELDS_BY_TYPE: Record<string, string[]> = {
  "sticky-note": ["id", "type", "x", "y", "width", "height", "text", "color"],
  rectangle:     ["id", "type", "x", "y", "width", "height", "fill"],
  circle:        ["id", "type", "x", "y", "width", "height", "fill"],
  line:          ["id", "type", "x", "y", "width", "height", "stroke"],
  text:          ["id", "type", "x", "y", "width", "height", "text", "fontSize"],
  frame:         ["id", "type", "x", "y", "width", "height", "title", "fill"],
  connector:     ["id", "type", "fromId", "toId"],
};

/**
 * Normalize internal property names to match the batchModifyElements schema
 * so the model sees "color" (which it can use in modifications) instead of
 * "fill"/"stroke" (which don't exist in the modify schema).
 */
const FIELD_RENAMES: Record<string, string> = { fill: "color", stroke: "color" };

function slimElementForAI(ymap: Y.Map<unknown>): Record<string, unknown> {
  const elType = ymap.get("type") as string;
  const fields = AI_FIELDS_BY_TYPE[elType];
  if (!fields) return yMapToPlainObject(ymap);
  const obj: Record<string, unknown> = {};
  for (const key of fields) {
    const val = ymap.get(key);
    if (val !== undefined) {
      const outKey = FIELD_RENAMES[key] ?? key;
      obj[outKey] = val;
    }
  }
  return obj;
}

function setElementProps(elementMap: Y.Map<unknown>, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      elementMap.set(key, value);
    }
  }
}

/**
 * Find the smallest frame whose bounds contain the point (cx, cy).
 * When `candidateFrameIds` is provided, only those frames are considered.
 */
function findContainingFrameId(
  cx: number,
  cy: number,
  elementsMap: Y.Map<unknown>,
  excludeId: string,
  candidateFrameIds?: Set<string>,
): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  elementsMap.forEach((val, key) => {
    if (key === excludeId) return;
    if (candidateFrameIds && !candidateFrameIds.has(key)) return;
    const m = val as Y.Map<unknown>;
    if (m.get("type") !== "frame") return;
    const fx = m.get("x") as number;
    const fy = m.get("y") as number;
    const fw = m.get("width") as number;
    const fh = m.get("height") as number;
    if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) {
      const area = fw * fh;
      if (area < bestArea) {
        bestArea = area;
        bestId = key;
      }
    }
  });
  return bestId;
}

/**
 * Find the nearest batch frame that the element rectangle overlaps or
 * nearly touches (within PROXIMITY_PX). This handles the case where the
 * AI miscalculates frame width but still positions children in a logical
 * grid relative to the frame.
 */
const FRAME_PROXIMITY_PX = 150;

function findOverlappingBatchFrameId(
  ex: number,
  ey: number,
  ew: number,
  eh: number,
  elementsMap: Y.Map<unknown>,
  excludeId: string,
  candidateFrameIds: Set<string>,
): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  const p = FRAME_PROXIMITY_PX;
  elementsMap.forEach((val, key) => {
    if (key === excludeId) return;
    if (!candidateFrameIds.has(key)) return;
    const m = val as Y.Map<unknown>;
    if (m.get("type") !== "frame") return;
    const fx = m.get("x") as number;
    const fy = m.get("y") as number;
    const fw = m.get("width") as number;
    const fh = m.get("height") as number;
    const nearby =
      ex <= fx + fw + p && ex + ew >= fx - p &&
      ey <= fy + fh + p && ey + eh >= fy - p;
    if (nearby) {
      const area = fw * fh;
      if (area < bestArea) {
        bestArea = area;
        bestId = key;
      }
    }
  });
  return bestId;
}

const FRAME_PAD = 20;
const FRAME_TITLE_BAR = 40;

/**
 * Recompute a frame's bounds to tightly wrap its children.
 * Returns true if the frame was resized.
 */
function autoFitFrame(fid: string, elementsMap: Y.Map<unknown>): boolean {
  const frameMap = elementsMap.get(fid) as Y.Map<unknown> | undefined;
  if (!frameMap || frameMap.get("type") !== "frame") return false;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  let hasChildren = false;

  elementsMap.forEach((val) => {
    const m = val as Y.Map<unknown>;
    if (m.get("frameId") !== fid) return;
    hasChildren = true;
    const cx = m.get("x") as number;
    const cy = m.get("y") as number;
    const cw = m.get("width") as number;
    const ch = m.get("height") as number;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx + cw > maxX) maxX = cx + cw;
    if (cy + ch > maxY) maxY = cy + ch;
  });

  if (!hasChildren) return false;

  const correctX = minX - FRAME_PAD;
  const correctY = minY - FRAME_TITLE_BAR - FRAME_PAD;
  const correctW = (maxX - minX) + FRAME_PAD * 2;
  const correctH = FRAME_TITLE_BAR + (maxY - minY) + FRAME_PAD * 2;

  let changed = false;
  if (correctX !== frameMap.get("x")) { frameMap.set("x", correctX); changed = true; }
  if (correctY !== frameMap.get("y")) { frameMap.set("y", correctY); changed = true; }
  if (correctW !== frameMap.get("width")) { frameMap.set("width", correctW); changed = true; }
  if (correctH !== frameMap.get("height")) { frameMap.set("height", correctH); changed = true; }
  return changed;
}

const DIAGRAM_LAYER_GAP = 200;
const DIAGRAM_NODE_GAP = 80;
const DIAGRAM_NODE_SIZES = {
  "sticky-note": { width: 160, height: 70 },
};

/**
 * Simplified Sugiyama-style layered graph layout. Assigns layers via
 * longest-path from roots, orders within layers using a median heuristic,
 * then positions nodes centered per layer.
 */
function computeLayeredLayout(
  nodeSizes: Array<{ width: number; height: number }>,
  edges: Array<{ from: number; to: number }>,
  direction: "TB" | "LR",
  originX: number,
  originY: number,
): Array<{ x: number; y: number }> {
  const n = nodeSizes.length;
  if (n === 0) return [];

  const adj: number[][] = Array.from({ length: n }, () => []);
  const revAdj: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Array(n).fill(0);

  for (const e of edges) {
    if (e.from < 0 || e.from >= n || e.to < 0 || e.to >= n || e.from === e.to) continue;
    adj[e.from].push(e.to);
    revAdj[e.to].push(e.from);
    inDeg[e.to]++;
  }

  const layers = new Array(n).fill(0);
  const remaining = [...inDeg];
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (remaining[i] === 0) queue.push(i);
  }
  if (queue.length === 0) {
    queue.push(0);
    remaining[0] = 0;
  }

  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    for (const child of adj[node]) {
      layers[child] = Math.max(layers[child], layers[node] + 1);
      if (--remaining[child] === 0) queue.push(child);
    }
  }
  for (let i = 0; i < n; i++) {
    if (remaining[i] > 0) layers[i] = 0;
  }

  const maxLayer = Math.max(...layers);
  const groups: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (let i = 0; i < n; i++) groups[layers[i]].push(i);

  for (let l = 1; l <= maxLayer; l++) {
    const prevPos = new Map<number, number>();
    groups[l - 1].forEach((node, idx) => prevPos.set(node, idx));

    const scored = groups[l].map((node) => {
      const ppos = revAdj[node]
        .map((p) => prevPos.get(p))
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => a - b);
      return { node, median: ppos.length > 0 ? ppos[Math.floor(ppos.length / 2)] : Infinity };
    });
    scored.sort((a, b) => a.median - b.median);
    groups[l] = scored.map((s) => s.node);
  }

  const isTB = direction === "TB";
  const positions: Array<{ x: number; y: number }> = new Array(n);

  let mainCursor = 0;
  const layerMainOffset: number[] = [];
  for (let l = 0; l <= maxLayer; l++) {
    layerMainOffset.push(mainCursor);
    let maxMain = 0;
    for (const node of groups[l]) {
      const s = isTB ? nodeSizes[node].height : nodeSizes[node].width;
      if (s > maxMain) maxMain = s;
    }
    mainCursor += maxMain + DIAGRAM_LAYER_GAP;
  }

  for (let l = 0; l <= maxLayer; l++) {
    const group = groups[l];
    let totalCross = 0;
    for (const node of group) {
      totalCross += isTB ? nodeSizes[node].width : nodeSizes[node].height;
    }
    totalCross += Math.max(0, group.length - 1) * DIAGRAM_NODE_GAP;

    let crossCursor = -totalCross / 2;
    for (const node of group) {
      const { width, height } = nodeSizes[node];
      if (isTB) {
        positions[node] = { x: crossCursor, y: layerMainOffset[l] };
        crossCursor += width + DIAGRAM_NODE_GAP;
      } else {
        positions[node] = { x: layerMainOffset[l], y: crossCursor };
        crossCursor += height + DIAGRAM_NODE_GAP;
      }
    }
  }

  let minX = Infinity, minY = Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  for (const p of positions) {
    p.x = Math.round(p.x - minX + originX);
    p.y = Math.round(p.y - minY + originY);
  }

  return positions;
}

/** Anchor indices: 0=top, 1=right, 2=bottom, 3=left */
function getAnchorXY(
  x: number, y: number, w: number, h: number, anchor: number,
): { x: number; y: number } {
  switch (anchor) {
    case 0: return { x: x + w / 2, y };
    case 1: return { x: x + w, y: y + h / 2 };
    case 2: return { x: x + w / 2, y: y + h };
    case 3: return { x, y: y + h / 2 };
    default: return { x: x + w / 2, y: y + h / 2 };
  }
}

type AABB = { minX: number; minY: number; maxX: number; maxY: number };

function getTopLevelObstacles(
  elementsMap: Y.Map<unknown>,
  excludeIds?: Set<string>,
): AABB[] {
  const obstacles: AABB[] = [];
  elementsMap.forEach((val, key) => {
    if (excludeIds?.has(key)) return;
    const m = val as Y.Map<unknown>;
    const type = m.get("type") as string;
    if (type === "connector") return;
    const frameId = m.get("frameId") as string | null | undefined;
    if (frameId) return;
    const x = m.get("x") as number | undefined;
    const y = m.get("y") as number | undefined;
    const w = m.get("width") as number | undefined;
    const h = m.get("height") as number | undefined;
    if (x == null || y == null || w == null || h == null) return;
    obstacles.push({ minX: x, minY: y, maxX: x + w, maxY: y + h });
  });
  return obstacles;
}

const COLLISION_PAD = 20;
const MAX_SHIFT_ATTEMPTS = 50;
const SHIFT_STEP = 60;

function rectsOverlap(a: AABB, b: AABB, pad: number): boolean {
  return (
    a.minX < b.maxX + pad &&
    a.maxX > b.minX - pad &&
    a.minY < b.maxY + pad &&
    a.maxY > b.minY - pad
  );
}

/**
 * Find a position for a rectangle that doesn't overlap any existing top-level
 * obstacles. Shifts right first, then wraps down. Returns the adjusted {x, y}.
 */
function findOpenPosition(
  desiredX: number,
  desiredY: number,
  width: number,
  height: number,
  obstacles: AABB[],
): { x: number; y: number } {
  if (obstacles.length === 0) return { x: desiredX, y: desiredY };

  let x = desiredX;
  let y = desiredY;
  const candidate: AABB = { minX: x, minY: y, maxX: x + width, maxY: y + height };

  for (let attempt = 0; attempt < MAX_SHIFT_ATTEMPTS; attempt++) {
    const hit = obstacles.find((o) => rectsOverlap(candidate, o, COLLISION_PAD));
    if (!hit) return { x: candidate.minX, y: candidate.minY };
    candidate.minX = hit.maxX + COLLISION_PAD;
    candidate.maxX = candidate.minX + width;
    if (candidate.minX > desiredX + 3000) {
      candidate.minX = desiredX;
      candidate.maxX = desiredX + width;
      candidate.minY += height + SHIFT_STEP;
      candidate.maxY = candidate.minY + height;
    }
  }
  return { x: candidate.minX, y: candidate.minY };
}

export function createBoardTools(doc: Y.Doc, opts?: { useGeminiSchema?: boolean }) {
  const useGeminiSchema = opts?.useGeminiSchema ?? false;
  const elementsMap = doc.getMap("elements");
  const aiCreatedIds = new Set<string>();

  const createConnector = tool(
    async (args) => {
      const fromEl = elementsMap.get(args.fromId) as Y.Map<unknown> | undefined;
      const toEl = elementsMap.get(args.toId) as Y.Map<unknown> | undefined;
      if (!fromEl || !toEl) {
        return JSON.stringify({ error: "Source or target element not found" });
      }
      const id = generateId();
      const fromX = (fromEl.get("x") as number) + (fromEl.get("width") as number) / 2;
      const fromY = (fromEl.get("y") as number) + (fromEl.get("height") as number) / 2;
      const toX = (toEl.get("x") as number) + (toEl.get("width") as number) / 2;
      const toY = (toEl.get("y") as number) + (toEl.get("height") as number) / 2;

      const elementMap = new Y.Map<unknown>();
      doc.transact(() => {
        setElementProps(elementMap, {
          id,
          type: "connector",
          x: Math.min(fromX, toX),
          y: Math.min(fromY, toY),
          width: Math.abs(toX - fromX) || 1,
          height: Math.abs(toY - fromY) || 1,
          fromId: args.fromId,
          toId: args.toId,
          fromAnchor: null,
          toAnchor: null,
          fromX,
          fromY,
          toX,
          toY,
          routingStyle: "curved",
          startArrow: "none",
          endArrow: "arrow",
          stroke: DEFAULT_CONNECTOR_STROKE,
          strokeWidth: DEFAULT_CONNECTOR_STROKE_WIDTH,
          dashStyle: "solid",
          labelText: "",
          labelFontSize: 14,
          labelFontFamily: DEFAULT_FONT_FAMILY,
          labelFill: "#000000",
          labelBold: false,
          labelStrikethrough: false,
          rotation: 0,
        });
        elementsMap.set(id, elementMap);
      });
      return JSON.stringify({ id, type: "connector" });
    },
    {
      name: "createConnector",
      description: "Create a connector (line/arrow) between two existing elements.",
      schema: z.object({
        fromId: z.string().describe("ID of the source element"),
        toId: z.string().describe("ID of the target element"),
      }),
    }
  );

  const deleteObject = tool(
    async (args) => {
      const exists = elementsMap.has(args.objectId);
      if (!exists) return JSON.stringify({ error: "Element not found" });
      if (!aiCreatedIds.has(args.objectId)) {
        return JSON.stringify({
          error:
            "Cannot delete element not created in this conversation. Ask the user to delete pre-existing elements manually.",
        });
      }
      doc.transact(() => {
        elementsMap.delete(args.objectId);
      });
      aiCreatedIds.delete(args.objectId);
      return JSON.stringify({ id: args.objectId, deleted: true });
    },
    {
      name: "deleteObject",
      description:
        "Delete an element from the board. Only elements created by the AI in this conversation can be deleted.",
      schema: z.object({
        objectId: z.string().describe("ID of the element to delete"),
      }),
    }
  );

  const getBoardState = tool(
    async (args) => {
      const elements: Record<string, unknown>[] = [];
      if (args.elementIds && args.elementIds.length > 0) {
        for (const id of args.elementIds) {
          const val = elementsMap.get(id);
          if (val instanceof Y.Map) {
            elements.push(slimElementForAI(val as Y.Map<unknown>));
          }
        }
      } else {
        elementsMap.forEach((value) => {
          if (value instanceof Y.Map) {
            elements.push(slimElementForAI(value as Y.Map<unknown>));
          }
        });
      }
      return JSON.stringify({ elementCount: elements.length, elements });
    },
    {
      name: "getBoardState",
      description:
        "Get a snapshot of elements on the board. Only call for modify/delete — never for create commands. Pass elementIds from SELECTION CONTEXT when available to reduce tokens. Omit elementIds to get all elements.",
      schema: z.object({
        elementIds: z
          .array(z.string())
          .optional()
          .describe("Optional list of element IDs to fetch. If omitted, returns all elements."),
      }),
    }
  );

  // -------------------------------------------------------------------------
  // Per-type schemas — each variant only exposes its own fields so the model
  // can't waste output tokens on inapplicable properties.
  // -------------------------------------------------------------------------

  const stickyNoteSchema = z.object({
    type: z.literal("sticky-note"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().optional().describe("Text content"),
    color: z.string().optional().describe("Hex color"),
  });

  const rectangleSchema = z.object({
    type: z.literal("rectangle"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    color: z.string().optional().describe("Hex fill color"),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
  });

  const circleSchema = z.object({
    type: z.literal("circle"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    color: z.string().optional().describe("Hex fill color"),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
  });

  const lineSchema = z.object({
    type: z.literal("line"),
    x: z.number().describe("Start X"),
    y: z.number().describe("Start Y"),
    endX: z.number().describe("End X — use lines for axis dividers, borders, or separators"),
    endY: z.number().describe("End Y"),
    color: z.string().optional().describe("Hex stroke color"),
    strokeWidth: z.number().optional().describe("Stroke width in px. Default 2."),
  });

  const textSchema = z.object({
    type: z.literal("text"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().optional().describe("Text content"),
    fontSize: z.number().optional().describe("Font size"),
    fill: z.string().optional().describe("Text color hex. Default #000000."),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
  });

  const frameSchema = z.object({
    type: z.literal("frame"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    title: z.string().optional().describe("Frame title"),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
    children: z.array(z.number()).optional().describe(
      "0-based indices of other elements in this batch that belong inside this frame"
    ),
  });

  // OpenAI-compatible: discriminatedUnion with z.literal (uses JSON Schema `const`)
  const batchElementSchemaOpenAI = z.discriminatedUnion("type", [
    stickyNoteSchema,
    rectangleSchema,
    circleSchema,
    lineSchema,
    textSchema,
    frameSchema,
  ]);

  // Gemini-compatible: flat object with z.enum (no `const` / `oneOf`)
  const batchElementSchemaGemini = z.object({
    type: z.enum(["sticky-note", "rectangle", "circle", "line", "text", "frame"])
      .describe("Element type"),
    x: z.number().describe("X position (or Start X for lines)"),
    y: z.number().describe("Y position (or Start Y for lines)"),
    text: z.string().optional().describe("Text content (sticky-note, text)"),
    color: z.string().optional().describe("Hex color"),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
    endX: z.number().optional().describe("End X (line only) — use lines for axis dividers, borders, or separators"),
    endY: z.number().optional().describe("End Y (line only)"),
    strokeWidth: z.number().optional().describe("Stroke width in px (line only). Default 2."),
    fontSize: z.number().optional().describe("Font size (text only)"),
    fill: z.string().optional().describe("Text color hex (text only). Default #000000."),
    title: z.string().optional().describe("Frame title (frame only)"),
    children: z.array(z.number()).optional().describe(
      "0-based indices of child elements in this batch (frame only)"
    ),
  });

  const batchElementSchema = useGeminiSchema
    ? batchElementSchemaGemini
    : batchElementSchemaOpenAI;

  const batchCreateElements = tool(
    async (args) => {
        const created: { id: string; type: string }[] = [];
        doc.transact(() => {
          // Build set of indices that are children of a frame in this batch
          const childIndices = new Set<number>();
          for (const el of args.elements) {
            if (el.type === "frame" && el.children?.length) {
              for (const idx of el.children) childIndices.add(idx);
            }
          }

          // Pre-compute obstacles from existing board elements (top-level only).
          // When inserting into an existing frame, skip collision checks entirely.
          const obstacles = args.frameId ? [] : getTopLevelObstacles(elementsMap);
          const frameDeltas = new Map<number, { dx: number; dy: number }>();
          const createdPositions = new Map<number, { x: number; y: number; w: number; h: number }>();

          for (let idx = 0; idx < args.elements.length; idx++) {
            const el = args.elements[idx];
            const id = generateId();
            const elementMap = new Y.Map<unknown>();
            const isChild = childIndices.has(idx);

            // Resolve dimensions for collision check
            let elW: number, elH: number;
            switch (el.type) {
              case "sticky-note": elW = DEFAULT_STICKY_NOTE_SIZE.width; elH = DEFAULT_STICKY_NOTE_SIZE.height; break;
              case "rectangle": elW = el.width ?? DEFAULT_RECTANGLE_SIZE.width; elH = el.height ?? DEFAULT_RECTANGLE_SIZE.height; break;
              case "circle": elW = el.width ?? DEFAULT_CIRCLE_SIZE.width; elH = el.height ?? DEFAULT_CIRCLE_SIZE.height; break;
              case "text": elW = el.width ?? DEFAULT_TEXT_SIZE.width; elH = el.height ?? DEFAULT_TEXT_SIZE.height; break;
              case "frame": elW = el.width ?? DEFAULT_FRAME_SIZE.width; elH = el.height ?? DEFAULT_FRAME_SIZE.height; break;
              case "line": {
                const lx1 = el.x, ly1 = el.y;
                const lx2 = el.endX ?? lx1 + 100, ly2 = el.endY ?? ly1;
                elW = Math.abs(lx2 - lx1) || 1;
                elH = Math.abs(ly2 - ly1) || 1;
                break;
              }
              default: elW = 200; elH = 200;
            }

            // Only collision-check top-level elements (not children of batch frames)
            let posX = el.x;
            let posY = el.y;
            if (!isChild && obstacles.length > 0) {
              const adjusted = findOpenPosition(el.x, el.y, elW, elH, obstacles);
              posX = adjusted.x;
              posY = adjusted.y;
              if (el.type === "frame" && (posX !== el.x || posY !== el.y)) {
                frameDeltas.set(idx, { dx: posX - el.x, dy: posY - el.y });
              }
              if (el.type === "frame" && el.children?.length) {
                // Defer obstacle registration until we have frame+children bounding box
              } else {
                obstacles.push({ minX: posX, minY: posY, maxX: posX + elW, maxY: posY + elH });
              }
            } else if (isChild) {
              for (let fi = 0; fi < args.elements.length; fi++) {
                const f = args.elements[fi];
                if (f.type === "frame" && f.children?.includes(idx)) {
                  const d = frameDeltas.get(fi);
                  if (d) {
                    posX += d.dx;
                    posY += d.dy;
                  }
                  break;
                }
              }
            }

            createdPositions.set(idx, { x: posX, y: posY, w: elW, h: elH });

            // When we finish the last child of a frame, register the frame+children bounding box
            if (isChild && !args.frameId && obstacles.length > 0) {
              for (let fi = 0; fi < args.elements.length; fi++) {
                const f = args.elements[fi];
                if (f.type === "frame" && f.children?.length) {
                  const lastChildIdx = Math.max(...f.children);
                  if (lastChildIdx === idx) {
                    const framePos = createdPositions.get(fi);
                    if (framePos) {
                      let minX = framePos.x;
                      let minY = framePos.y;
                      let maxX = framePos.x + framePos.w;
                      let maxY = framePos.y + framePos.h;
                      for (const cIdx of f.children) {
                        const cp = createdPositions.get(cIdx);
                        if (cp) {
                          minX = Math.min(minX, cp.x);
                          minY = Math.min(minY, cp.y);
                          maxX = Math.max(maxX, cp.x + cp.w);
                          maxY = Math.max(maxY, cp.y + cp.h);
                        }
                      }
                      obstacles.push({ minX, minY, maxX, maxY });
                    }
                    break;
                  }
                }
              }
            }

            switch (el.type) {
              case "sticky-note": {
                const color =
                  el.color ||
                  STICKY_NOTE_COLORS[Math.floor(Math.random() * STICKY_NOTE_COLORS.length)];
                setElementProps(elementMap, {
                  id,
                  type: "sticky-note",
                  x: posX,
                  y: posY,
                  width: DEFAULT_STICKY_NOTE_SIZE.width,
                  height: DEFAULT_STICKY_NOTE_SIZE.height,
                  text: el.text ?? "",
                  color,
                  fontSize: DEFAULT_STICKY_NOTE_FONT_SIZE,
                  fontFamily: DEFAULT_FONT_FAMILY,
                  rotation: 0,
                });
                break;
              }
              case "rectangle": {
                setElementProps(elementMap, {
                  id,
                  type: "rectangle",
                  x: posX,
                  y: posY,
                  width: el.width ?? DEFAULT_RECTANGLE_SIZE.width,
                  height: el.height ?? DEFAULT_RECTANGLE_SIZE.height,
                  fill: el.color ?? "#ffffff",
                  stroke: "#a3a3a3",
                  rotation: 0,
                });
                break;
              }
              case "circle": {
                setElementProps(elementMap, {
                  id,
                  type: "circle",
                  x: posX,
                  y: posY,
                  width: el.width ?? DEFAULT_CIRCLE_SIZE.width,
                  height: el.height ?? DEFAULT_CIRCLE_SIZE.height,
                  fill: el.color ?? "#ffffff",
                  stroke: "#a3a3a3",
                  rotation: 0,
                });
                break;
              }
              case "line": {
                const x1 = posX, y1 = posY;
                const dx = (el.endX ?? el.x + 100) - el.x;
                const dy = (el.endY ?? el.y) - el.y;
                const x2 = posX + dx, y2 = posY + dy;
                const lx = Math.min(x1, x2);
                const ly = Math.min(y1, y2);
                const lw = Math.abs(x2 - x1) || 1;
                const lh = Math.abs(y2 - y1) || 1;
                const pts = [x1 - lx, y1 - ly, x2 - lx, y2 - ly];

                setElementProps(elementMap, {
                  id,
                  type: "line",
                  x: lx,
                  y: ly,
                  width: lw,
                  height: lh,
                  stroke: el.color ?? "#a3a3a3",
                  strokeWidth: el.strokeWidth ?? 2,
                  points: pts,
                  rotation: 0,
                });
                break;
              }
              case "text": {
                setElementProps(elementMap, {
                  id,
                  type: "text",
                  x: posX,
                  y: posY,
                  width: el.width ?? DEFAULT_TEXT_SIZE.width,
                  height: el.height ?? DEFAULT_TEXT_SIZE.height,
                  text: el.text ?? "",
                  fontSize: el.fontSize ?? 16,
                  fontFamily: DEFAULT_FONT_FAMILY,
                  fill: el.fill ?? "#000000",
                  rotation: 0,
                });
                break;
              }
              case "frame": {
                setElementProps(elementMap, {
                  id,
                  type: "frame",
                  x: posX,
                  y: posY,
                  width: el.width ?? DEFAULT_FRAME_SIZE.width,
                  height: el.height ?? DEFAULT_FRAME_SIZE.height,
                  title: el.title ?? "Frame",
                  fill: "#f5f5f5",
                  stroke: "#d4d4d4",
                  strokeStyle: "solid",
                  hidden: false,
                  rotation: 0,
                });
                break;
              }
            }
            elementsMap.set(id, elementMap);
            created.push({ id, type: el.type });
          }

          // Track all created IDs for provenance-based delete guardrails
          for (const { id } of created) {
            aiCreatedIds.add(id);
          }

          // Auto-parent non-frame elements to frames created in THIS batch.
          // First pass: use explicit `children` indices declared on frames.
          const batchFrameIds = new Set(
            created.filter((c) => c.type === "frame").map((c) => c.id),
          );
          const parentedIds = new Set<string>();

          for (let i = 0; i < args.elements.length; i++) {
            const el = args.elements[i];
            if (el.type !== "frame" || !el.children?.length) continue;
            const frameId = created[i].id;
            for (const childIdx of el.children) {
              if (childIdx < 0 || childIdx >= created.length) continue;
              if (created[childIdx].type === "frame") continue;
              const childMap = elementsMap.get(created[childIdx].id) as Y.Map<unknown>;
              if (childMap) {
                childMap.set("frameId", frameId);
                parentedIds.add(created[childIdx].id);
              }
            }
          }

          // Second pass: proximity fallback for elements not claimed by
          // any frame's explicit children array.
          for (const { id, type } of created) {
            if (type === "frame" || parentedIds.has(id)) continue;
            const elMap = elementsMap.get(id) as Y.Map<unknown>;
            if (!elMap) continue;
            const ex = elMap.get("x") as number;
            const ey = elMap.get("y") as number;
            const ew = elMap.get("width") as number;
            const eh = elMap.get("height") as number;
            const parentFrameId = findOverlappingBatchFrameId(
              ex, ey, ew, eh,
              elementsMap,
              id,
              batchFrameIds,
            );
            if (parentFrameId) {
              elMap.set("frameId", parentFrameId);
            }
          }

          // Third pass: if args.frameId provided, parent any still-unparented
          // non-frame elements to that existing frame.
          if (args.frameId && elementsMap.has(args.frameId)) {
            for (const { id, type } of created) {
              if (type === "frame" || parentedIds.has(id)) continue;
              const elMap = elementsMap.get(id) as Y.Map<unknown>;
              if (elMap && !elMap.get("frameId")) {
                elMap.set("frameId", args.frameId);
              }
            }
          }

          // Auto-fit frames to tightly wrap their children with padding.
          const frameIds = created
            .filter((c) => c.type === "frame")
            .map((c) => c.id);
          if (args.frameId && !frameIds.includes(args.frameId)) {
            frameIds.push(args.frameId);
          }
          for (const fid of frameIds) {
            autoFitFrame(fid, elementsMap);
          }
        });
        return JSON.stringify({ created });
    },
    {
      name: "batchCreateElements",
      description:
        "Create one or more elements in a single atomic operation. Put ALL elements in ONE call. Supports mixed element types — use for diagrams that combine lines (axes/dividers), text (labels/annotations), and sticky-notes (content). For quadrant diagrams, prefer createQuadrant instead. When asked to create elements in a grid, row, or column, position them directly — do NOT call layoutElements. For templates (SWOT, retro, etc.), include frame(s) + children together. Use the frame's `children` array to list 0-based indices of child elements in the batch (e.g. if element[0] is a frame and elements [1,2,3] are stickies inside it, set children:[1,2,3] on the frame). ALWAYS include every child index — omit none. For horizontal layouts (e.g. journey map stages), list all indices [1,2,3,4,5]. Place children in a grid: x = frame.x + 20 + col*(childWidth+20), y = frame.y + 60 + row*(childHeight+20). Server auto-fits the frame. Put text directly in sticky notes — never create separate text elements to label them.",
      schema: z.object({
        elements: z
          .array(batchElementSchema)
          .min(1)
          .describe("Array of elements to create. Each must include type and position."),
        frameId: z
          .string()
          .optional()
          .describe("Parent frame ID. All created elements become children of this existing frame and the frame auto-resizes. Pass the frameId returned by createQuadrant so sticky notes move with the frame."),
      }),
    }
  );

  const SHAPE_COLORS = [
    "#ffffff", "#d4d4d4", "#facc15", "#f472b6", "#60a5fa",
    "#4ade80", "#c084fc", "#fb923c", "#f87171", "#2dd4bf",
  ];

  const bulkCreateElements = tool(
    async (args) => {
      const count = args.count;
      const cols = args.columns ?? Math.ceil(Math.sqrt(count));
      const gap = args.gap ?? 20;

      let defaultW: number, defaultH: number;
      switch (args.type) {
        case "sticky-note":
          defaultW = DEFAULT_STICKY_NOTE_SIZE.width;
          defaultH = DEFAULT_STICKY_NOTE_SIZE.height;
          break;
        case "rectangle":
          defaultW = DEFAULT_RECTANGLE_SIZE.width;
          defaultH = DEFAULT_RECTANGLE_SIZE.height;
          break;
        case "circle":
          defaultW = DEFAULT_CIRCLE_SIZE.width;
          defaultH = DEFAULT_CIRCLE_SIZE.height;
          break;
        case "text":
          defaultW = DEFAULT_TEXT_SIZE.width;
          defaultH = DEFAULT_TEXT_SIZE.height;
          break;
      }

      const w = args.width ?? defaultW;
      const h = args.height ?? defaultH;
      const rows = Math.ceil(count / cols);
      const gridW = cols * w + (cols - 1) * gap;
      const gridH = rows * h + (rows - 1) * gap;
      const obstacles = getTopLevelObstacles(elementsMap);
      const adjusted = findOpenPosition(args.startX ?? 100, args.startY ?? 100, gridW, gridH, obstacles);
      const startX = adjusted.x;
      const startY = adjusted.y;
      const palette =
        args.type === "sticky-note" ? STICKY_NOTE_COLORS : SHAPE_COLORS;

      const created: { id: string; type: string }[] = [];

      doc.transact(() => {
        for (let i = 0; i < count; i++) {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const x = startX + col * (w + gap);
          const y = startY + row * (h + gap);

          const color = args.colors?.length
            ? args.colors[i % args.colors.length]
            : palette[Math.floor(Math.random() * palette.length)];

          let text = "";
          if (args.texts?.length) {
            text = i < args.texts.length
              ? args.texts[i]
              : args.texts[i % args.texts.length];
          } else if (args.textPattern) {
            text = args.textPattern.replace("{n}", String(i + 1));
          }

          const id = generateId();
          const elementMap = new Y.Map<unknown>();

          switch (args.type) {
            case "sticky-note":
              setElementProps(elementMap, {
                id, type: "sticky-note", x, y,
                width: w, height: h, text, color,
                fontSize: DEFAULT_STICKY_NOTE_FONT_SIZE,
                fontFamily: DEFAULT_FONT_FAMILY, rotation: 0,
              });
              break;
            case "rectangle":
              setElementProps(elementMap, {
                id, type: "rectangle", x, y,
                width: w, height: h,
                fill: color, stroke: "#a3a3a3", rotation: 0,
              });
              break;
            case "circle":
              setElementProps(elementMap, {
                id, type: "circle", x, y,
                width: w, height: h,
                fill: color, stroke: "#a3a3a3", rotation: 0,
              });
              break;
            case "text":
              setElementProps(elementMap, {
                id, type: "text", x, y,
                width: w, height: h, text,
                fontSize: 16, fontFamily: DEFAULT_FONT_FAMILY,
                fill: "#000000", rotation: 0,
              });
              break;
          }

          elementsMap.set(id, elementMap);
          created.push({ id, type: args.type });
          aiCreatedIds.add(id);
        }

        if (args.frameTitle) {
          const frameId = generateId();
          const frameMap = new Y.Map<unknown>();
          setElementProps(frameMap, {
            id: frameId, type: "frame",
            x: startX - FRAME_PAD,
            y: startY - FRAME_TITLE_BAR - FRAME_PAD,
            width: DEFAULT_FRAME_SIZE.width,
            height: DEFAULT_FRAME_SIZE.height,
            title: args.frameTitle, fill: "#f5f5f5",
            stroke: "#d4d4d4", strokeStyle: "solid",
            hidden: false, rotation: 0,
          });
          elementsMap.set(frameId, frameMap);

          for (const { id } of created) {
            const childMap = elementsMap.get(id) as Y.Map<unknown>;
            if (childMap) childMap.set("frameId", frameId);
          }

          created.push({ id: frameId, type: "frame" });
          aiCreatedIds.add(frameId);
          autoFitFrame(frameId, elementsMap);
        }
      });

      return JSON.stringify({
        created: created.length,
        type: args.type,
        hasFrame: !!args.frameTitle,
      });
    },
    {
      name: "bulkCreateElements",
      description:
        "Create many elements of the SAME type in a uniform grid layout. The server expands a compact template — specify type, count, colors, and layout instead of listing every element. Use for 7+ elements of one type. NOT suitable for structured diagrams (quadrants, matrices, categorized layouts) — use createQuadrant or batchCreateElements instead. For mixed types or <7 elements, use batchCreateElements.",
      schema: z.object({
        type: z
          .enum(["sticky-note", "rectangle", "circle", "text"])
          .describe("Element type to create"),
        count: z.number().min(1).describe("Exact number of elements to create"),
        startX: z.number().optional().describe("X of top-left element. Default 100."),
        startY: z.number().optional().describe("Y of top-left element. Default 100."),
        columns: z.number().optional().describe("Grid columns. Default: sqrt(count)."),
        gap: z.number().optional().describe("Spacing in px. Default 20."),
        colors: z
          .array(z.string())
          .optional()
          .describe("Hex colors to cycle through. Omit for random palette."),
        texts: z
          .array(z.string())
          .optional()
          .describe("Text labels — cycled if fewer than count."),
        textPattern: z
          .string()
          .optional()
          .describe("Pattern with {n} for 1,2,3… e.g. 'Note {n}'."),
        frameTitle: z
          .string()
          .optional()
          .describe("If set, wraps all elements in a frame with this title."),
        width: z.number().optional().describe("Override element width."),
        height: z.number().optional().describe("Override element height."),
      }),
    }
  );

  const batchModifyElements = tool(
    async (args) => {
        let modified = 0;
        const affectedFrameIds = new Set<string>();
        const ECHO_TOLERANCE = 2;

        doc.transact(() => {
          for (const mod of args.modifications) {
            const el = elementsMap.get(mod.objectId) as Y.Map<unknown> | undefined;
            if (!el) continue;
            const elType = el.get("type") as string;

            const hasCosmeticChange =
              (mod.color != null && mod.color !== "") ||
              (mod.text != null && mod.text !== "") ||
              (mod.title != null && mod.title !== "");

            const xEchoed = mod.x === undefined ||
              Math.abs(mod.x - (el.get("x") as number)) < ECHO_TOLERANCE;
            const yEchoed = mod.y === undefined ||
              Math.abs(mod.y - (el.get("y") as number)) < ECHO_TOLERANCE;
            const wEchoed = mod.width === undefined ||
              Math.abs(mod.width - (el.get("width") as number)) < ECHO_TOLERANCE;
            const hEchoed = mod.height === undefined ||
              Math.abs(mod.height - (el.get("height") as number)) < ECHO_TOLERANCE;

            if (hasCosmeticChange && xEchoed && yEchoed && wEchoed && hEchoed) {
              mod.x = undefined;
              mod.y = undefined;
              mod.width = undefined;
              mod.height = undefined;
            }

            if (mod.x !== undefined && mod.x !== el.get("x")) el.set("x", mod.x);
            if (mod.y !== undefined && mod.y !== el.get("y")) el.set("y", mod.y);
            if (mod.width !== undefined) {
              const clamped = Math.max(10, mod.width);
              if (clamped !== el.get("width")) el.set("width", clamped);
            }
            if (mod.height !== undefined) {
              const clamped = Math.max(10, mod.height);
              if (clamped !== el.get("height")) el.set("height", clamped);
            }
            if (mod.color != null && mod.color !== "") {
              if (elType === "sticky-note") {
                if (mod.color !== el.get("color")) el.set("color", mod.color);
              } else if (elType === "line" || elType === "connector") {
                if (mod.color !== el.get("stroke")) el.set("stroke", mod.color);
              } else {
                if (mod.color !== el.get("fill")) el.set("fill", mod.color);
              }
            }
            if (mod.title != null && mod.title !== "" && elType === "frame") {
              if (mod.title !== el.get("title")) el.set("title", mod.title);
            }
            if (mod.text != null && mod.text !== "") {
              if (elType === "frame") {
                if (mod.text !== el.get("title")) el.set("title", mod.text);
              } else {
                if (mod.text !== el.get("text")) el.set("text", mod.text);
              }
            }
            modified++;

            // Track frames that may need auto-expansion
            if (elType === "frame") {
              affectedFrameIds.add(mod.objectId);
            }
            const parentFrameId = el.get("frameId") as string | null | undefined;
            if (parentFrameId) {
              affectedFrameIds.add(parentFrameId);
            }
          }

          // Auto-expand any affected frames whose children now overflow
          for (const fid of affectedFrameIds) {
            autoFitFrame(fid, elementsMap);
          }
        });
        return JSON.stringify({ modified });
    },
    {
      name: "batchModifyElements",
      description:
        "Modify one or more existing elements. ONLY include objectId + changed fields — omitted fields are preserved. Server auto-expands parent frames if children overflow after modification.",
      schema: z.object({
        modifications: z
          .array(
            z.object({
              objectId: z.string().describe("ID of the element to modify"),
              x: z.number().optional().describe("New X position"),
              y: z.number().optional().describe("New Y position"),
              width: z.number().optional().describe("New width"),
              height: z.number().optional().describe("New height"),
              color: z.string().optional().describe("New color (mapped to color/fill/stroke based on element type)"),
              text: z.string().optional().describe("New text content (for sticky-note and text elements)"),
              title: z.string().optional().describe("New title (for frame elements only)"),
            })
          )
          .min(1)
          .describe("Array of modifications to apply"),
      }),
    }
  );

  const resizeFrameToFitContent = tool(
    async (args) => {
      let modified = 0;
      const errors: string[] = [];

      doc.transact(() => {
        for (const fid of args.frameIds) {
          const frameMap = elementsMap.get(fid) as Y.Map<unknown> | undefined;
          if (!frameMap) {
            errors.push(`Element ${fid} not found`);
            continue;
          }
          if (frameMap.get("type") !== "frame") {
            errors.push(`Element ${fid} is a ${frameMap.get("type")}, not a frame`);
            continue;
          }
          if (autoFitFrame(fid, elementsMap)) {
            modified++;
          } else {
            errors.push(`Frame ${fid} has no children`);
          }
        }
      });

      const result: Record<string, unknown> = { resized: modified };
      if (errors.length > 0) result.errors = errors;
      return JSON.stringify(result);
    },
    {
      name: "resizeFrameToFitContent",
      description:
        "Resize one or more frames to tightly wrap their child elements with padding. Use this instead of manually computing bounding boxes. The server calculates the exact bounds.",
      schema: z.object({
        frameIds: z
          .array(z.string())
          .min(1)
          .describe("IDs of the frame(s) to resize"),
      }),
    }
  );

  const layoutElements = tool(
    async (args) => {
        const gap = args.gap ?? 20;
        const maps: Array<{ id: string; m: Y.Map<unknown> }> = [];
        for (const id of args.elementIds) {
          const m = elementsMap.get(id) as Y.Map<unknown> | undefined;
          if (m) maps.push({ id, m });
        }
        if (maps.length === 0) {
          return JSON.stringify({ error: "No valid elements found" });
        }

        let cols: number;
        switch (args.strategy) {
          case "row":
            cols = maps.length;
            break;
          case "column":
            cols = 1;
            break;
          case "wrap":
            cols = args.columns ?? Math.ceil(Math.sqrt(maps.length));
            break;
          case "grid":
          default:
            cols = Math.ceil(Math.sqrt(maps.length));
            break;
        }

        let sumX = 0, sumY = 0;
        let maxW = 0, maxH = 0;
        for (const { m } of maps) {
          const w = m.get("width") as number;
          const h = m.get("height") as number;
          sumX += (m.get("x") as number) + w / 2;
          sumY += (m.get("y") as number) + h / 2;
          if (w > maxW) maxW = w;
          if (h > maxH) maxH = h;
        }
        const centroidX = sumX / maps.length;
        const centroidY = sumY / maps.length;

        const rows = Math.ceil(maps.length / cols);
        const gridW = cols * maxW + (cols - 1) * gap;
        const gridH = rows * maxH + (rows - 1) * gap;
        const originX = centroidX - gridW / 2;
        const originY = centroidY - gridH / 2;

        doc.transact(() => {
          for (let i = 0; i < maps.length; i++) {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const x = Math.round(originX + c * (maxW + gap));
            const y = Math.round(originY + r * (maxH + gap));
            const { m } = maps[i];
            if (x !== m.get("x")) m.set("x", x);
            if (y !== m.get("y")) m.set("y", y);
          }
        });

        return JSON.stringify({
          organized: maps.length,
          strategy: args.strategy,
          columns: cols,
          rows,
        });
    },
    {
      name: "layoutElements",
      description:
        "ONLY for rearranging existing elements on the board. Never use this to create new elements. Arrange existing elements using a layout strategy. The server computes all positions centered on the elements' current location. Strategies: grid (auto columns), row (horizontal), column (vertical), wrap (grid with explicit column count).",
      schema: z.object({
        elementIds: z
          .array(z.string())
          .min(1)
          .describe("IDs of the elements to arrange"),
        strategy: z
          .enum(["grid", "row", "column", "wrap"])
          .describe("Layout strategy: grid (auto cols), row (1 row), column (1 col), wrap (explicit cols)"),
        columns: z
          .number()
          .optional()
          .describe("Number of columns (only for wrap strategy). Ignored by row/column. Grid auto-calculates."),
        gap: z
          .number()
          .optional()
          .describe("Spacing between elements in pixels. Defaults to 20."),
      }),
    }
  );

  const QUADRANT_AXIS_MARGIN = 60;
  const QUADRANT_INNER_PAD = 20;
  const STICKY_CELL = DEFAULT_STICKY_NOTE_SIZE.width + QUADRANT_INNER_PAD; // 220
  const AXIS_LABEL_HEIGHT = 30;

  function computeQuadrantZone(itemsPerQuadrant: number, hasSectionLabels: boolean) {
    const n = Math.max(1, itemsPerQuadrant);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const sectionTitleOffset = hasSectionLabels ? 34 : 0;
    const zoneW = Math.max(460, cols * STICKY_CELL + QUADRANT_INNER_PAD);
    const zoneH = Math.max(460, rows * STICKY_CELL + QUADRANT_INNER_PAD + sectionTitleOffset + AXIS_LABEL_HEIGHT);
    return { zoneW, zoneH, cols, rows };
  }

  const QUADRANT_COLORS = {
    topLeft: "#60a5fa",
    topRight: "#4ade80",
    bottomLeft: "#facc15",
    bottomRight: "#f472b6",
  } as const;

  const createQuadrant = tool(
    async (args) => {
      const items = args.items;
      const maxItemsFromItems = items
        ? Math.max(
            items.topLeft?.length ?? 0,
            items.topRight?.length ?? 0,
            items.bottomLeft?.length ?? 0,
            items.bottomRight?.length ?? 0,
          )
        : 0;
      const effectiveItemsPerQuadrant = Math.max(args.itemsPerQuadrant ?? 4, maxItemsFromItems);
      const { zoneW, zoneH, cols: gridCols } = computeQuadrantZone(effectiveItemsPerQuadrant, !!args.quadrantLabels);
      const qTotalW = 2 * zoneW + 2 * QUADRANT_AXIS_MARGIN;
      const qTotalH = 2 * zoneH + 2 * QUADRANT_AXIS_MARGIN;
      const qObstacles = getTopLevelObstacles(elementsMap);
      const qAdj = findOpenPosition(args.x ?? 100, args.y ?? 100, qTotalW, qTotalH, qObstacles);
      const originX = qAdj.x;
      const originY = qAdj.y;
      const totalW = 2 * zoneW + 2 * QUADRANT_AXIS_MARGIN;
      const totalH = 2 * zoneH + 2 * QUADRANT_AXIS_MARGIN;
      const centerX = originX + totalW / 2;
      const centerY = originY + totalH / 2;

      const created: { id: string; type: string }[] = [];

      doc.transact(() => {
        const makeElement = (type: string, props: Record<string, unknown>) => {
          const id = generateId();
          const m = new Y.Map<unknown>();
          setElementProps(m, { id, type, rotation: 0, ...props });
          elementsMap.set(id, m);
          created.push({ id, type });
          aiCreatedIds.add(id);
          return id;
        };

        const frameId = makeElement("frame", {
          x: originX - FRAME_PAD,
          y: originY - FRAME_TITLE_BAR - FRAME_PAD,
          width: totalW + FRAME_PAD * 2,
          height: totalH + FRAME_TITLE_BAR + FRAME_PAD * 2,
          title: args.title ?? "Quadrant",
          fill: "#f5f5f5",
          stroke: "#d4d4d4",
          strokeStyle: "solid",
          hidden: false,
        });

        const hLineX1 = originX + QUADRANT_AXIS_MARGIN;
        const hLineX2 = originX + totalW - QUADRANT_AXIS_MARGIN;
        const hLineY = centerY;
        const hx = Math.min(hLineX1, hLineX2);
        const hw = Math.abs(hLineX2 - hLineX1) || 1;
        makeElement("line", {
          x: hx, y: hLineY, width: hw, height: 1,
          stroke: "#737373", strokeWidth: 2,
          points: [hLineX1 - hx, 0, hLineX2 - hx, 0],
        });

        const vLineY1 = originY + QUADRANT_AXIS_MARGIN;
        const vLineY2 = originY + totalH - QUADRANT_AXIS_MARGIN;
        const vy = Math.min(vLineY1, vLineY2);
        const vh = Math.abs(vLineY2 - vLineY1) || 1;
        makeElement("line", {
          x: centerX, y: vy, width: 1, height: vh,
          stroke: "#737373", strokeWidth: 2,
          points: [0, vLineY1 - vy, 0, vLineY2 - vy],
        });

        const xLabel = args.xAxisLabel ?? "X Axis";
        const yLabel = args.yAxisLabel ?? "Y Axis";
        const xLow = args.xLow ?? "Low";
        const xHigh = args.xHigh ?? "High";
        const yLow = args.yLow ?? "Low";
        const yHigh = args.yHigh ?? "High";

        makeElement("text", {
          x: originX + 4, y: centerY - 28,
          width: 150, height: 24,
          text: `← ${xLow} ${xLabel}`,
          fontSize: 13, fontFamily: DEFAULT_FONT_FAMILY, fill: "#737373",
        });
        makeElement("text", {
          x: originX + totalW - 154, y: centerY - 28,
          width: 150, height: 24,
          text: `${xHigh} ${xLabel} →`,
          fontSize: 13, fontFamily: DEFAULT_FONT_FAMILY, fill: "#737373",
        });
        makeElement("text", {
          x: centerX + 6, y: originY + 4,
          width: 150, height: 24,
          text: `↑ ${yHigh} ${yLabel}`,
          fontSize: 13, fontFamily: DEFAULT_FONT_FAMILY, fill: "#737373",
        });
        makeElement("text", {
          x: centerX + 6, y: originY + totalH - 28,
          width: 150, height: 24,
          text: `↓ ${yLow} ${yLabel}`,
          fontSize: 13, fontFamily: DEFAULT_FONT_FAMILY, fill: "#737373",
        });

        const ql = args.quadrantLabels;
        const sectionTitleOffset = args.quadrantLabels ? 34 : 0;
        const sectionLabelPositions = [
          { label: ql?.topLeft, x: originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD, y: originY + QUADRANT_AXIS_MARGIN + 4 },
          { label: ql?.topRight, x: centerX + QUADRANT_INNER_PAD, y: originY + QUADRANT_AXIS_MARGIN + 4 },
          { label: ql?.bottomLeft, x: originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD, y: centerY + 4 },
          { label: ql?.bottomRight, x: centerX + QUADRANT_INNER_PAD, y: centerY + 4 },
        ];
        for (const sl of sectionLabelPositions) {
          if (sl.label) {
            makeElement("text", {
              x: sl.x, y: sl.y,
              width: zoneW - QUADRANT_INNER_PAD * 2, height: 28,
              text: sl.label,
              fontSize: 15, fontFamily: DEFAULT_FONT_FAMILY, fill: "#525252",
            });
          }
        }

        const items = args.items;
        const cellW = STICKY_CELL;
        const cellH = STICKY_CELL;
        const quadrantSpecs: Array<{ key: keyof typeof QUADRANT_COLORS; items: string[]; qx: number; qy: number }> = [
          { key: "topLeft", items: items?.topLeft ?? [], qx: originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD, qy: originY + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD },
          { key: "topRight", items: items?.topRight ?? [], qx: centerX + QUADRANT_INNER_PAD, qy: originY + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD },
          { key: "bottomLeft", items: items?.bottomLeft ?? [], qx: originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD, qy: centerY + QUADRANT_INNER_PAD },
          { key: "bottomRight", items: items?.bottomRight ?? [], qx: centerX + QUADRANT_INNER_PAD, qy: centerY + QUADRANT_INNER_PAD },
        ];
        for (const spec of quadrantSpecs) {
          const gridStartX = spec.qx;
          const gridStartY = spec.qy + sectionTitleOffset;
          const color = QUADRANT_COLORS[spec.key];
          for (let i = 0; i < spec.items.length; i++) {
            const col = i % gridCols;
            const row = Math.floor(i / gridCols);
            const x = gridStartX + col * cellW;
            const y = gridStartY + row * cellH;
            makeElement("sticky-note", {
              x, y,
              width: DEFAULT_STICKY_NOTE_SIZE.width,
              height: DEFAULT_STICKY_NOTE_SIZE.height,
              text: spec.items[i],
              color,
              fontSize: DEFAULT_STICKY_NOTE_FONT_SIZE,
              fontFamily: DEFAULT_FONT_FAMILY,
            });
          }
        }

        for (const { id, type } of created) {
          if (type === "frame") continue;
          const childMap = elementsMap.get(id) as Y.Map<unknown>;
          if (childMap) childMap.set("frameId", frameId);
        }

        autoFitFrame(frameId, elementsMap);
      });

      const sectionTitleOffsetForInfo = args.quadrantLabels ? 34 : 0;
      const cellW = STICKY_CELL;
      const cellH = STICKY_CELL;

      function quadrantInfo(
        key: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
        qx: number, qy: number,
      ) {
        return {
          label: key,
          x: qx, y: qy,
          width: zoneW - QUADRANT_INNER_PAD,
          height: zoneH - QUADRANT_INNER_PAD - sectionTitleOffsetForInfo,
          gridStartX: qx,
          gridStartY: qy + sectionTitleOffsetForInfo,
          gridCols,
          cellW,
          cellH,
          suggestedColor: QUADRANT_COLORS[key],
        };
      }

      return JSON.stringify({
        created: created.length,
        frameId: created[0]?.id,
        placement: `For each quadrant, place sticky notes using: x = gridStartX + (i % gridCols) * cellW, y = gridStartY + floor(i / gridCols) * cellH. Use the suggestedColor for all stickies in that quadrant.`,
        quadrants: {
          topLeft: quadrantInfo("topLeft",
            originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD,
            originY + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD,
          ),
          topRight: quadrantInfo("topRight",
            centerX + QUADRANT_INNER_PAD,
            originY + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD,
          ),
          bottomLeft: quadrantInfo("bottomLeft",
            originX + QUADRANT_AXIS_MARGIN + QUADRANT_INNER_PAD,
            centerY + QUADRANT_INNER_PAD,
          ),
          bottomRight: quadrantInfo("bottomRight",
            centerX + QUADRANT_INNER_PAD,
            centerY + QUADRANT_INNER_PAD,
          ),
        },
      });
    },
    {
      name: "createQuadrant",
      description:
        "Create a 2x2 quadrant diagram with labeled axes and sticky notes. ALWAYS pass items with placeholder labels per quadrant (e.g. SWOT: items: {topLeft:['Strength 1','Strength 2'],topRight:['Weakness 1','Weakness 2'],bottomLeft:['Opportunity 1','Opportunity 2'],bottomRight:['Threat 1','Threat 2']}). Also pass quadrantLabels for section titles. Stickies are created server-side in one call. Use for SWOT, Eisenhower matrix, or any 2-axis categorization.",
      schema: z.object({
        title: z.string().optional().describe("Diagram title shown on the frame"),
        xAxisLabel: z.string().describe("Label for the horizontal axis (e.g. 'Time', 'Effort')"),
        yAxisLabel: z.string().describe("Label for the vertical axis (e.g. 'Impact', 'Value')"),
        xLow: z.string().optional().describe("Low-end label for X axis. Default 'Low'."),
        xHigh: z.string().optional().describe("High-end label for X axis. Default 'High'."),
        yLow: z.string().optional().describe("Low-end label for Y axis. Default 'Low'."),
        yHigh: z.string().optional().describe("High-end label for Y axis. Default 'High'."),
        quadrantLabels: z.object({
          topLeft: z.string().optional(),
          topRight: z.string().optional(),
          bottomLeft: z.string().optional(),
          bottomRight: z.string().optional(),
        }).optional().describe("Section titles for each quadrant (e.g. 'Strengths', 'Weaknesses', 'Opportunities', 'Threats' for SWOT)"),
        items: z.object({
          topLeft: z.array(z.string()).optional(),
          topRight: z.array(z.string()).optional(),
          bottomLeft: z.array(z.string()).optional(),
          bottomRight: z.array(z.string()).optional(),
        }).optional().describe("Pre-filled sticky note labels per quadrant. When provided, stickies are created server-side — no follow-up batchCreateElements needed."),
        itemsPerQuadrant: z.number().optional().describe("Expected number of items per quadrant. Sizes the diagram to fit this many 200x200 sticky notes per quadrant. Default 4."),
        x: z.number().optional().describe("X origin of the diagram. Default 100."),
        y: z.number().optional().describe("Y origin of the diagram. Default 100."),
      }),
    }
  );

  const COLUMN_LAYOUT_GAP = 20;
  const COLUMN_LAYOUT_HEADING_HEIGHT = 28;
  const COLUMN_LAYOUT_WIDTH = DEFAULT_STICKY_NOTE_SIZE.width + COLUMN_LAYOUT_GAP;

  const createColumnLayout = tool(
    async (args) => {
      const columns = args.columns;
      if (!columns?.length) {
        return JSON.stringify({ error: "At least one column is required" });
      }

      const maxItems = Math.max(...columns.map((c) => c.items?.length ?? 0));
      const totalW =
        FRAME_PAD * 2 +
        columns.length * COLUMN_LAYOUT_WIDTH +
        (columns.length - 1) * COLUMN_LAYOUT_GAP;
      const totalH =
        FRAME_TITLE_BAR +
        FRAME_PAD * 2 +
        COLUMN_LAYOUT_HEADING_HEIGHT +
        COLUMN_LAYOUT_GAP +
        maxItems * (DEFAULT_STICKY_NOTE_SIZE.height + COLUMN_LAYOUT_GAP);

      const obstacles = getTopLevelObstacles(elementsMap);
      const adj = findOpenPosition(args.x ?? 100, args.y ?? 100, totalW, totalH, obstacles);
      const originX = adj.x;
      const originY = adj.y;

      const created: { id: string; type: string }[] = [];
      const elementIds: string[] = [];

      doc.transact(() => {
        const frameId = generateId();
        const frameMap = new Y.Map<unknown>();
        setElementProps(frameMap, {
          id: frameId,
          type: "frame",
          x: originX,
          y: originY,
          width: totalW,
          height: totalH,
          title: args.title ?? "Columns",
          fill: "#f5f5f5",
          stroke: "#d4d4d4",
          strokeStyle: "solid",
          hidden: false,
          rotation: 0,
        });
        elementsMap.set(frameId, frameMap);
        created.push({ id: frameId, type: "frame" });
        aiCreatedIds.add(frameId);

        let colX = originX + FRAME_PAD;
        for (let colIdx = 0; colIdx < columns.length; colIdx++) {
          const col = columns[colIdx];
          const heading = col.heading ?? `Column ${colIdx + 1}`;
          const items = col.items ?? [];
          const color =
            col.color ??
            STICKY_NOTE_COLORS[colIdx % STICKY_NOTE_COLORS.length];

          const headingId = generateId();
          const headingMap = new Y.Map<unknown>();
          setElementProps(headingMap, {
            id: headingId,
            type: "text",
            x: colX,
            y: originY + FRAME_TITLE_BAR + FRAME_PAD,
            width: COLUMN_LAYOUT_WIDTH - 10,
            height: COLUMN_LAYOUT_HEADING_HEIGHT,
            text: heading,
            fontSize: 14,
            fontFamily: DEFAULT_FONT_FAMILY,
            fill: "#525252",
            rotation: 0,
            frameId,
          });
          elementsMap.set(headingId, headingMap);
          created.push({ id: headingId, type: "text" });
          aiCreatedIds.add(headingId);
          elementIds.push(headingId);

          let stickyY = originY + FRAME_TITLE_BAR + FRAME_PAD + COLUMN_LAYOUT_HEADING_HEIGHT + COLUMN_LAYOUT_GAP;
          for (let i = 0; i < items.length; i++) {
            const id = generateId();
            const elementMap = new Y.Map<unknown>();
            setElementProps(elementMap, {
              id,
              type: "sticky-note",
              x: colX + 10,
              y: stickyY,
              width: DEFAULT_STICKY_NOTE_SIZE.width,
              height: DEFAULT_STICKY_NOTE_SIZE.height,
              text: items[i],
              color,
              fontSize: DEFAULT_STICKY_NOTE_FONT_SIZE,
              fontFamily: DEFAULT_FONT_FAMILY,
              rotation: 0,
              frameId,
            });
            elementsMap.set(id, elementMap);
            created.push({ id, type: "sticky-note" });
            aiCreatedIds.add(id);
            elementIds.push(id);
            stickyY += DEFAULT_STICKY_NOTE_SIZE.height + COLUMN_LAYOUT_GAP;
          }

          colX += COLUMN_LAYOUT_WIDTH + COLUMN_LAYOUT_GAP;
        }

        autoFitFrame(frameId, elementsMap);
      });

      return JSON.stringify({
        created: created.length,
        frameId: created[0]?.id,
        elementIds,
      });
    },
    {
      name: "createColumnLayout",
      description:
        "Create a column-based layout (user journey map, retrospective board, kanban) in one atomic call. Server handles all positioning. Use for: user journey maps (5 columns = 5 stages, each with stage heading + stickies), retrospectives (What Went Well, What Didn't, Action Items), kanban (To Do, In Progress, Done).",
      schema: z.object({
        title: z.string().optional().describe("Frame title"),
        columns: z
          .array(
            z.object({
              heading: z.string().describe("Column heading (e.g. stage name, 'What Went Well')"),
              color: z.string().optional().describe("Hex color for stickies in this column"),
              items: z.array(z.string()).optional().describe("Sticky note labels for this column"),
            })
          )
          .min(1)
          .describe("Column definitions with heading and optional items"),
        x: z.number().optional().describe("X origin. Default 100."),
        y: z.number().optional().describe("Y origin. Default 100."),
      }),
    }
  );

  const createDiagram = tool(
    async (args) => {
      const direction = args.direction ?? "TB";
      const dReqX = args.x ?? 100;
      const dReqY = args.y ?? 100;
      const nodeSpecs = args.nodes;
      const edgeSpecs = args.edges;

      for (const e of edgeSpecs) {
        if (e.from < 0 || e.from >= nodeSpecs.length || e.to < 0 || e.to >= nodeSpecs.length) {
          return JSON.stringify({
            error: `Edge index out of bounds: from=${e.from} to=${e.to}, but only ${nodeSpecs.length} nodes exist`,
          });
        }
      }

      const nodeSize = DIAGRAM_NODE_SIZES["sticky-note"];
      const nodeSizes = nodeSpecs.map(() => ({ ...nodeSize }));

      const positions = computeLayeredLayout(
        nodeSizes,
        edgeSpecs.map((e) => ({ from: e.from, to: e.to })),
        direction,
        dReqX,
        dReqY,
      );

      // Measure bounding box of the layout and collision-shift
      let dMinX = Infinity, dMinY = Infinity, dMaxX = -Infinity, dMaxY = -Infinity;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (p.x < dMinX) dMinX = p.x;
        if (p.y < dMinY) dMinY = p.y;
        if (p.x + nodeSizes[i].width > dMaxX) dMaxX = p.x + nodeSizes[i].width;
        if (p.y + nodeSizes[i].height > dMaxY) dMaxY = p.y + nodeSizes[i].height;
      }
      const dW = dMaxX - dMinX;
      const dH = dMaxY - dMinY;
      const dObstacles = getTopLevelObstacles(elementsMap);
      const dAdj = findOpenPosition(dMinX, dMinY, dW, dH, dObstacles);
      const dDx = dAdj.x - dMinX;
      const dDy = dAdj.y - dMinY;
      if (dDx !== 0 || dDy !== 0) {
        for (const p of positions) { p.x += dDx; p.y += dDy; }
      }
      const originX = dReqX + dDx;
      const originY = dReqY + dDy;

      const created: { id: string; type: string }[] = [];
      const nodeIds: string[] = [];

      doc.transact(() => {
        let frameId: string | undefined;
        if (args.title) {
          frameId = generateId();
          const frameMap = new Y.Map<unknown>();
          setElementProps(frameMap, {
            id: frameId,
            type: "frame",
            x: originX - FRAME_PAD,
            y: originY - FRAME_TITLE_BAR - FRAME_PAD,
            width: DEFAULT_FRAME_SIZE.width,
            height: DEFAULT_FRAME_SIZE.height,
            title: args.title,
            fill: "#f5f5f5",
            stroke: "#d4d4d4",
            strokeStyle: "solid",
            hidden: false,
            rotation: 0,
          });
          elementsMap.set(frameId, frameMap);
          created.push({ id: frameId, type: "frame" });
          aiCreatedIds.add(frameId);
        }

        for (let i = 0; i < nodeSpecs.length; i++) {
          const spec = nodeSpecs[i];
          const pos = positions[i];
          const size = nodeSizes[i];
          const id = generateId();
          const elementMap = new Y.Map<unknown>();
          const color =
            spec.color ||
            STICKY_NOTE_COLORS[Math.floor(Math.random() * STICKY_NOTE_COLORS.length)];
          setElementProps(elementMap, {
            id, type: "sticky-note",
            x: pos.x, y: pos.y,
            width: size.width, height: size.height,
            text: spec.label, color,
            fontSize: DEFAULT_STICKY_NOTE_FONT_SIZE,
            fontFamily: DEFAULT_FONT_FAMILY,
            rotation: 0, ...(frameId && { frameId }),
          });
          elementsMap.set(id, elementMap);
          created.push({ id, type: "sticky-note" });
          aiCreatedIds.add(id);
          nodeIds.push(id);
        }

        for (const edge of edgeSpecs) {
          const fromNodeId = nodeIds[edge.from];
          const toNodeId = nodeIds[edge.to];
          if (!fromNodeId || !toNodeId) continue;

          const fp = positions[edge.from];
          const tp = positions[edge.to];
          const fs = nodeSizes[edge.from];
          const ts = nodeSizes[edge.to];

          const fCx = fp.x + fs.width / 2;
          const fCy = fp.y + fs.height / 2;
          const tCx = tp.x + ts.width / 2;
          const tCy = tp.y + ts.height / 2;
          const dx = tCx - fCx;
          const dy = tCy - fCy;

          let fAnch: number, tAnch: number;
          if (Math.abs(dx) > Math.abs(dy)) {
            fAnch = dx > 0 ? 1 : 3;
            tAnch = dx > 0 ? 3 : 1;
          } else {
            fAnch = dy > 0 ? 2 : 0;
            tAnch = dy > 0 ? 0 : 2;
          }

          const fA = getAnchorXY(fp.x, fp.y, fs.width, fs.height, fAnch);
          const tA = getAnchorXY(tp.x, tp.y, ts.width, ts.height, tAnch);

          const connId = generateId();
          const connMap = new Y.Map<unknown>();
          setElementProps(connMap, {
            id: connId, type: "connector",
            x: Math.min(fA.x, tA.x),
            y: Math.min(fA.y, tA.y),
            width: Math.abs(tA.x - fA.x) || 1,
            height: Math.abs(tA.y - fA.y) || 1,
            fromId: fromNodeId, toId: toNodeId,
            fromAnchor: fAnch, toAnchor: tAnch,
            fromX: fA.x, fromY: fA.y,
            toX: tA.x, toY: tA.y,
            routingStyle: "curved",
            startArrow: edge.startArrow ?? "none",
            endArrow: edge.endArrow ?? "arrow",
            stroke: "#737373",
            strokeWidth: DEFAULT_CONNECTOR_STROKE_WIDTH,
            dashStyle: edge.style ?? "solid",
            labelText: edge.label ?? "",
            labelFontSize: 14,
            labelFontFamily: DEFAULT_FONT_FAMILY,
            labelFill: "#ffffff",
            labelBold: false,
            labelStrikethrough: false,
            rotation: 0, ...(frameId && { frameId }),
          });
          elementsMap.set(connId, connMap);
          created.push({ id: connId, type: "connector" });
          aiCreatedIds.add(connId);
        }

        if (frameId) {
          autoFitFrame(frameId, elementsMap);
        }
      });

      const result: Record<string, unknown> = {
        created: created.length,
        nodes: nodeSpecs.length,
        connectors: edgeSpecs.length,
        nodeIds,
      };
      const frameEntry = created.find((c) => c.type === "frame");
      if (frameEntry) result.frameId = frameEntry.id;
      return JSON.stringify(result);
    },
    {
      name: "createDiagram",
      description:
        "Create a connected diagram (flowchart, org chart, tree, mind map, ER diagram, process flow, state machine) in one atomic call. Define nodes with labels and edges by 0-based node index. The server auto-layouts nodes in layers and creates all connectors with proper anchors. Pass title to wrap in a frame. Use instead of manually creating shapes + calling createConnector.",
      schema: z.object({
        title: z.string().optional().describe("If provided, wraps the diagram in a titled frame."),
        direction: z.enum(["TB", "LR"]).optional().describe("Layout direction: TB = top-to-bottom, LR = left-to-right. Default TB."),
        nodes: z.array(z.object({
          label: z.string().describe("Text label on the node"),
          color: z.string().optional().describe("Hex color for the node"),
        })).min(2).describe("Diagram nodes (created as sticky notes)"),
        edges: z.array(z.object({
          from: z.number().describe("0-based index of the source node"),
          to: z.number().describe("0-based index of the target node"),
          label: z.string().optional().describe("Label on the connector"),
          style: z.enum(["solid", "dashed", "dotted"]).optional().describe("Line style. Default solid."),
          startArrow: z.enum(["none", "arrow", "diamond"]).optional().describe("Start arrow. Default none."),
          endArrow: z.enum(["none", "arrow", "diamond"]).optional().describe("End arrow. Default arrow."),
        })).min(1).describe("Edges connecting nodes by index"),
        x: z.number().optional().describe("X origin. Default 100."),
        y: z.number().optional().describe("Y origin. Default 100."),
      }),
    }
  );

  const tools = [
    getBoardState,
    batchCreateElements,
    bulkCreateElements,
    batchModifyElements,
    resizeFrameToFitContent,
    layoutElements,
    createConnector,
    createQuadrant,
    createColumnLayout,
    createDiagram,
    deleteObject,
  ];

  return { tools, aiCreatedIds };
}
