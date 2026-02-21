"use client";

import type Konva from "konva";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as KonvaCircle, Layer, Rect, Stage } from "react-konva";

import type { BoardElement, ConnectorElement, FrameElement, LineElement } from "@collab/shared/collab";

import { findFrameAtPoint, getElementAABB, getFrameChildIds } from "@/lib/element-utils";
import type { SpatialIndex } from "@/lib/spatial-index";
import { useCanvasStore } from "@/stores/canvas-store";
import { CircleContent } from "./circle-element";
import { ConnectorContent } from "./connector-element";
import { ConnectorEndpointHandles } from "./connector-endpoint-handles";
import { isPointOnConnectorPath } from "./connector-utils";
import { FrameContent } from "./frame-element";
import { InteractiveShape } from "./interactive-shape";
import { isPointOnLinePath, LineContent } from "./line-element";
import { LineEndpointHandles } from "./line-endpoint-handles";
import { RectangleContent } from "./rectangle-element";
import type { ElementBox } from "./shape-transform";
import { StickyNote } from "./sticky-note";
import { TextContent } from "./text-element";

import type { RotationCursorState } from "./interactive-shape";

const VIEWPORT_CULL_MARGIN = 300;

// ---------------------------------------------------------------------------
// Memoized element wrapper components
// These create a memo boundary so that selection changes only re-render the
// 2 affected elements (old + new selection), not the entire board.
// ---------------------------------------------------------------------------

type StaticElementNodeProps = {
  element: BoardElement;
  onSelect: (id: string, shiftKey: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  dropTargetFrameId: string | null;
  elementsById: Map<string, BoardElement>;
  dragPositionOverrides?: Map<string, { x: number; y: number }>;
};

function StaticElementNodeComponent({
  element: el,
  onSelect,
  onDragEnd,
  dropTargetFrameId,
  elementsById,
  dragPositionOverrides,
}: StaticElementNodeProps) {
  const isLine = el.type === "line";
  const isConnector = el.type === "connector";
  const isFrame = el.type === "frame";
  return (
    <InteractiveShape
      element={el}
      isSelected={false}
      multiSelected={false}
      draggable={false}
      onSelect={onSelect}
      onDragEnd={onDragEnd}
      hideSelectionOutline={isLine || isConnector}
    >
      {el.type === "sticky-note" && <StickyNote element={el} />}
      {el.type === "rectangle" && <RectangleContent element={el} />}
      {el.type === "circle" && <CircleContent element={el} />}
      {el.type === "line" && <LineContent element={el} />}
      {el.type === "text" && <TextContent element={el} />}
      {isFrame && (
        <FrameContent
          element={el as FrameElement}
          isDropTarget={dropTargetFrameId === el.id}
        />
      )}
      {isConnector && el.type === "connector" && (
        <ConnectorContent
          element={el}
          elementsById={elementsById}
          dragPositionOverrides={dragPositionOverrides}
        />
      )}
    </InteractiveShape>
  );
}

const StaticElementNode = memo(StaticElementNodeComponent, (prev, next) => {
  if (prev.element !== next.element) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.onDragEnd !== next.onDragEnd) return false;
  if (prev.element.type === "frame" && prev.dropTargetFrameId !== next.dropTargetFrameId) return false;
  if (prev.element.type === "connector") {
    if (prev.elementsById !== next.elementsById) return false;
    if (prev.dragPositionOverrides !== next.dragPositionOverrides) return false;
  }
  return true;
});

type ActiveElementNodeProps = {
  element: BoardElement;
  isSelected: boolean;
  multiSelected: boolean;
  draggable: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onDragStart?: (id: string) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onGroupDragStart: () => void;
  onGroupDragMove: (dx: number, dy: number) => void;
  onResize: (id: string, box: ElementBox) => void;
  onRotate: (id: string, rotation: number) => void;
  onRotateCursorChange?: (state: RotationCursorState) => void;
  onDblClick: (id: string) => void;
  getDragChildIds: (frameId: string) => string[];
  onDragPositionUpdate: (id: string, x: number, y: number, width: number, height: number) => void;
  editingElementId: string | null;
  editingConnectorLabel: boolean;
  dropTargetFrameId: string | null;
  elementsById: Map<string, BoardElement>;
  dragPositionOverrides?: Map<string, { x: number; y: number }>;
  onLineEndpointDrag: (idx: number, wx: number, wy: number, elementId: string) => void;
  onLineEndpointDragEnd: (idx: number, wx: number, wy: number, elementId: string) => void;
  onConnectorEndpointDrag: (endpoint: "from" | "to", wx: number, wy: number, elementId: string) => void;
  onConnectorEndpointDragEnd: (endpoint: "from" | "to", wx: number, wy: number, elementId: string) => void;
  onConnectorLabelClick: (elementId: string) => void;
  isSpacebarPressedRef?: React.RefObject<boolean>;
  isSpacebarPressed?: boolean;
};

function ActiveElementNodeComponent({
  element: el,
  isSelected,
  multiSelected,
  draggable,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onGroupDragStart,
  onGroupDragMove,
  onResize,
  onRotate,
  onRotateCursorChange,
  onDblClick,
  getDragChildIds,
  onDragPositionUpdate,
  editingElementId,
  editingConnectorLabel,
  dropTargetFrameId,
  elementsById,
  dragPositionOverrides,
  onLineEndpointDrag,
  onLineEndpointDragEnd,
  onConnectorEndpointDrag,
  onConnectorEndpointDragEnd,
  onConnectorLabelClick,
  isSpacebarPressedRef,
  isSpacebarPressed = false,
}: ActiveElementNodeProps) {
  const isLine = el.type === "line";
  const isConnector = el.type === "connector";
  const isFrame = el.type === "frame";
  const resizable = !isLine && !isConnector;
  const editable = el.type === "sticky-note" || el.type === "text" || isFrame || isConnector;
  return (
    <InteractiveShape
      element={el}
      isSelected={isSelected}
      multiSelected={multiSelected}
      draggable={draggable && !isConnector}
      onSelect={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onGroupDragStart={onGroupDragStart}
      onGroupDragMove={onGroupDragMove}
      resizable={resizable}
      onResize={resizable ? onResize : undefined}
      onRotate={resizable ? onRotate : undefined}
      onRotateCursorChange={resizable ? onRotateCursorChange : undefined}
      onDblClick={editable ? onDblClick : undefined}
      hideSelectionOutline={isLine || isConnector}
      getDragChildIds={isFrame ? getDragChildIds : undefined}
      onDragPositionUpdate={!isFrame ? onDragPositionUpdate : undefined}
      isSpacebarPressedRef={isSpacebarPressedRef}
      isSpacebarPressed={isSpacebarPressed}
    >
      {el.type === "sticky-note" && (
        <StickyNote element={el} isEditing={el.id === editingElementId} />
      )}
      {el.type === "rectangle" && <RectangleContent element={el} />}
      {el.type === "circle" && <CircleContent element={el} />}
      {el.type === "line" && <LineContent element={el} />}
      {el.type === "text" && (
        <TextContent element={el} isEditing={el.id === editingElementId} />
      )}
      {el.type === "frame" && (
        <FrameContent
          element={el as FrameElement}
          isEditing={el.id === editingElementId}
          isDropTarget={dropTargetFrameId === el.id}
        />
      )}
      {isConnector && el.type === "connector" && (
        <ConnectorContent
          element={el}
          elementsById={elementsById}
          dragPositionOverrides={dragPositionOverrides}
          isLabelEditing={editingConnectorLabel && el.id === editingElementId}
          onLabelClick={
            isSelected && el.labelText.trim() !== ""
              ? () => onConnectorLabelClick(el.id)
              : undefined
          }
        />
      )}
      {isLine && isSelected && el.type === "line" && (
        <LineEndpointHandles
          points={el.points}
          onEndpointDrag={(idx, wx, wy) => onLineEndpointDrag(idx, wx, wy, el.id)}
          onEndpointDragEnd={(idx, wx, wy) => onLineEndpointDragEnd(idx, wx, wy, el.id)}
        />
      )}
      {isConnector && isSelected && el.type === "connector" && (
        <ConnectorEndpointHandles
          element={el}
          elementsById={elementsById}
          onEndpointDrag={(endpoint, wx, wy) => onConnectorEndpointDrag(endpoint, wx, wy, el.id)}
          onEndpointDragEnd={(endpoint, wx, wy) => onConnectorEndpointDragEnd(endpoint, wx, wy, el.id)}
        />
      )}
    </InteractiveShape>
  );
}

const ActiveElementNode = memo(ActiveElementNodeComponent, (prev, next) => {
  if (prev.element !== next.element) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.multiSelected !== next.multiSelected) return false;
  if (prev.draggable !== next.draggable) return false;
  if (prev.isSpacebarPressed !== next.isSpacebarPressed) return false;
  // Editing-related props only matter for the element being edited
  const prevIsEditing = prev.editingElementId === prev.element.id;
  const nextIsEditing = next.editingElementId === next.element.id;
  if (prevIsEditing !== nextIsEditing) return false;
  if (prev.element.type === "frame" && prev.dropTargetFrameId !== next.dropTargetFrameId) return false;
  if (prev.element.type === "connector") {
    if (prev.elementsById !== next.elementsById) return false;
    if (prev.dragPositionOverrides !== next.dragPositionOverrides) return false;
    if (prev.editingConnectorLabel !== next.editingConnectorLabel && prevIsEditing) return false;
  }
  return true;
});

type BoardCanvasProps = {
  camera: { x: number; y: number; scale: number };
  syntheticObjectCount?: number;
  elements?: BoardElement[];
  onSelectElement?: (id: string, shiftKey: boolean) => void;
  onDragElementStart?: (id: string) => void;
  onDragElementMove?: (id: string, x: number, y: number) => void;
  onDragElement?: (id: string, x: number, y: number) => void;
  onDragSelectedElements?: (deltaX: number, deltaY: number) => void;
  onGroupDragStart?: () => void;
  onGroupDragMove?: (dx: number, dy: number) => void;
  onResizeElement?: (id: string, box: ElementBox) => void;
  onRotateElement?: (id: string, rotation: number) => void;
  onRotateCursorChange?: (state: RotationCursorState) => void;
  onDblClickElement?: (id: string) => void;
  onLineEndpointDrag?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onLineEndpointDragEnd?: (id: string, endpointIndex: number, worldX: number, worldY: number) => void;
  onConnectorEndpointDrag?: (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => void;
  onConnectorEndpointDragEnd?: (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => void;
  onConnectorLabelClick?: (id: string) => void;
  onStagePointerDown?: (worldX: number, worldY: number) => void;
  onStagePointerMove?: (worldX: number, worldY: number) => void;
  onStagePointerUp?: () => void;
  onMarqueeSelect?: (ids: string[]) => void;
  marqueeRect?: { x: number; y: number; width: number; height: number } | null;
  editingElementId?: string | null;
  editingConnectorLabel?: boolean;
  connectorSnapAnchors?: { x: number; y: number }[];
  connectorSnapTarget?: { x: number; y: number } | null;
  getFrameChildIdsFn?: (frameId: string) => string[];
  onStageRef?: (stage: Konva.Stage | null) => void;
  spatialIndex?: SpatialIndex;
  isSpacebarPressedRef?: React.RefObject<boolean>;
  isSpacebarPressed?: boolean;
};

export const BoardCanvas = memo(function BoardCanvas({
  camera,
  syntheticObjectCount = 0,
  elements = [],
  onSelectElement,
  onDragElementStart,
  onDragElementMove,
  onDragElement,
  onDragSelectedElements,
  onGroupDragStart,
  onGroupDragMove,
  onResizeElement,
  onRotateElement,
  onRotateCursorChange,
  onDblClickElement,
  onLineEndpointDrag,
  onLineEndpointDragEnd,
  onConnectorEndpointDrag,
  onConnectorEndpointDragEnd,
  onConnectorLabelClick,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  marqueeRect = null,
  editingElementId = null,
  editingConnectorLabel = false,
  connectorSnapAnchors = [],
  connectorSnapTarget = null,
  getFrameChildIdsFn,
  onStageRef,
  spatialIndex,
  isSpacebarPressedRef,
  isSpacebarPressed = false,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const localStageRef = useRef<Konva.Stage | null>(null);
  const stageCallbackRef = useCallback(
    (node: Konva.Stage | null) => {
      localStageRef.current = node;
      onStageRef?.(node);
    },
    [onStageRef],
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pendingDragRef = useRef<{
    id: string;
    screenX: number;
    screenY: number;
    ready: boolean;
  } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const groupDrag = useCanvasStore((s) => s.groupDrag);
  const dropTargetFrameId = useCanvasStore((s) => s.dropTargetFrameId);
  const setDropTargetFrameId = useCanvasStore((s) => s.setDropTargetFrameId);
  const storeZoomScale = useCanvasStore((s) => s.zoomScale);
  const activeTool = useCanvasStore((s) => s.activeTool);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const isMultiSelect = selectedElementIds.size > 1;

  const frameElements = useMemo(
    () => elements.filter((e) => e.type === "frame") as FrameElement[],
    [elements]
  );
  const elementsById = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);
  const frameChildIdsByFrame = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const frame of frameElements) {
      map.set(
        frame.id,
        getFrameChildIdsFn ? getFrameChildIdsFn(frame.id) : getFrameChildIds(frame.id, elements)
      );
    }
    return map;
  }, [elements, frameElements, getFrameChildIdsFn]);

  const groupBounds = useMemo(() => {
    if (!isMultiSelect) return null;
    const selectedEls = elements.filter((e) => selectedElementIds.has(e.id));
    if (selectedEls.length <= 1) return null;

    const offsetX = groupDrag?.dx ?? 0;
    const offsetY = groupDrag?.dy ?? 0;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const e of selectedEls) {
      const aabb = getElementAABB(e);
      minX = Math.min(minX, aabb.minX + offsetX);
      minY = Math.min(minY, aabb.minY + offsetY);
      maxX = Math.max(maxX, aabb.maxX + offsetX);
      maxY = Math.max(maxY, aabb.maxY + offsetY);
    }

    return { x: minX - 4, y: minY - 4, width: maxX - minX + 8, height: maxY - minY + 8 };
  }, [isMultiSelect, elements, selectedElementIds, groupDrag]);

  // Sort elements: frames first (behind), then regular shapes, then connectors on top.
  // Connectors render above shapes so they remain visible over the objects they connect.
  // Also filter out children of hidden frames.
  const sortedElements = useMemo(() => {
    const frames: BoardElement[] = [];
    const connectors: BoardElement[] = [];
    const nonFrames: BoardElement[] = [];
    for (const el of elements) {
      if (el.type === "frame") {
        frames.push(el);
      } else if (el.type === "connector") {
        connectors.push(el);
      } else {
        nonFrames.push(el);
      }
    }

    // Compute hidden child IDs using explicit frameId membership
    const hiddenIds = new Set<string>();
    for (const f of frames) {
      if ((f as FrameElement).hidden) {
        const children = frameChildIdsByFrame.get(f.id) ?? [];
        for (const id of children) hiddenIds.add(id);
      }
    }

    const visibleNonFrames = nonFrames.filter((el) => !hiddenIds.has(el.id));
    const visibleConnectors = connectors.filter((el) => !hiddenIds.has(el.id));
    return [...frames, ...visibleNonFrames, ...visibleConnectors];
  }, [elements, frameChildIdsByFrame]);

  const viewportBounds = useMemo(() => {
    if (camera.scale <= 0) {
      return { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    }
    return {
      minX: (-camera.x) / camera.scale - VIEWPORT_CULL_MARGIN,
      minY: (-camera.y) / camera.scale - VIEWPORT_CULL_MARGIN,
      maxX: (size.width - camera.x) / camera.scale + VIEWPORT_CULL_MARGIN,
      maxY: (size.height - camera.y) / camera.scale + VIEWPORT_CULL_MARGIN,
    };
  }, [camera.scale, camera.x, camera.y, size.width, size.height]);

  // Viewport-culled elements (independent of selection so it doesn't recompute
  // on every selection change). Selected off-screen elements are added in the
  // staticElements/activeElements split below.
  const viewportCulled = useMemo(() => {
    return sortedElements.filter((el) => {
      const minX = el.x;
      const minY = el.y;
      const maxX = el.x + el.width;
      const maxY = el.y + el.height;
      return (
        maxX >= viewportBounds.minX &&
        minX <= viewportBounds.maxX &&
        maxY >= viewportBounds.minY &&
        minY <= viewportBounds.maxY
      );
    });
  }, [sortedElements, viewportBounds]);

  const isPointerMode = activeTool === "pointer";
  const draggable = isPointerMode;

  const { staticElements, activeElements } = useMemo(() => {
    const staticEls: BoardElement[] = [];
    const activeEls: BoardElement[] = [];

    // Build the effective visible set: viewport-culled + selected (always visible)
    const culledIds = new Set(viewportCulled.map((e) => e.id));
    const visibleIds = new Set(culledIds);
    for (const sid of selectedElementIds) visibleIds.add(sid);

    // Child IDs of selected frames — these must render in the active layer on top of the frame.
    // Skip children of hidden frames so content stays hidden when the frame is selected.
    const childIdsOfSelectedFrames = new Set<string>();
    for (const fid of selectedElementIds) {
      const frame = elementsById.get(fid) as FrameElement | undefined;
      if (frame?.type === "frame" && frame.hidden) continue;
      for (const cid of frameChildIdsByFrame.get(fid) ?? []) {
        childIdsOfSelectedFrames.add(cid);
        visibleIds.add(cid);
      }
    }

    if (editingElementId) visibleIds.add(editingElementId);

    // Walk sorted elements in z-order, only including those that are visible
    const activeIdSet = new Set<string>();
    for (const sid of selectedElementIds) activeIdSet.add(sid);
    if (editingElementId) activeIdSet.add(editingElementId);
    for (const cid of childIdsOfSelectedFrames) activeIdSet.add(cid);

    // Static: visible elements that are NOT active
    for (const el of sortedElements) {
      if (!visibleIds.has(el.id)) continue;
      if (!activeIdSet.has(el.id)) staticEls.push(el);
    }

    // Active: selected frames first (each followed by its children), then other active elements
    const added = new Set<string>();
    for (const el of sortedElements) {
      if (!visibleIds.has(el.id)) continue;
      if (el.type === "frame" && selectedElementIds.has(el.id)) {
        activeEls.push(el);
        added.add(el.id);
        if (!(el as FrameElement).hidden) {
          for (const cid of frameChildIdsByFrame.get(el.id) ?? []) {
            if (visibleIds.has(cid) && !added.has(cid)) {
              const child = elementsById.get(cid);
              if (child) {
                activeEls.push(child);
                added.add(cid);
              }
            }
          }
        }
      }
    }
    for (const el of sortedElements) {
      if (!visibleIds.has(el.id)) continue;
      if (activeIdSet.has(el.id) && !added.has(el.id)) {
        activeEls.push(el);
      }
    }
    return { staticElements: staticEls, activeElements: activeEls };
  }, [sortedElements, viewportCulled, selectedElementIds, editingElementId, frameChildIdsByFrame, elementsById]);

  useEffect(() => {
    const pending = pendingDragRef.current;
    if (!pending || pending.ready) return;
    const isInActive = activeElements.some((el) => el.id === pending.id);
    if (!isInActive) return;
    pending.ready = true;
  }, [activeElements]);

  // Store callback props in refs so useCallback wrappers remain stable
  const onSelectElementRef = useRef(onSelectElement);
  onSelectElementRef.current = onSelectElement;
  const onDragElementRef = useRef(onDragElement);
  onDragElementRef.current = onDragElement;
  const onDragSelectedElementsRef = useRef(onDragSelectedElements);
  onDragSelectedElementsRef.current = onDragSelectedElements;
  const onGroupDragStartRef = useRef(onGroupDragStart);
  onGroupDragStartRef.current = onGroupDragStart;
  const onGroupDragMoveRef = useRef(onGroupDragMove);
  onGroupDragMoveRef.current = onGroupDragMove;
  const onResizeElementRef = useRef(onResizeElement);
  onResizeElementRef.current = onResizeElement;
  const onRotateElementRef = useRef(onRotateElement);
  onRotateElementRef.current = onRotateElement;
  const onDblClickElementRef = useRef(onDblClickElement);
  onDblClickElementRef.current = onDblClickElement;
  const elementsByIdRef = useRef(elementsById);
  elementsByIdRef.current = elementsById;
  const frameElementsRef = useRef(frameElements);
  frameElementsRef.current = frameElements;
  const frameChildIdsByFrameRef = useRef(frameChildIdsByFrame);
  frameChildIdsByFrameRef.current = frameChildIdsByFrame;

  const handleSelect = useCallback((id: string, shiftKey: boolean) => {
    onSelectElementRef.current?.(id, shiftKey);
  }, []);

  const handleMultiDragEnd = useCallback((draggedId: string, newX: number, newY: number) => {
    setDropTargetFrameId(null);
    const el = elementsByIdRef.current.get(draggedId);
    if (!el) return;
    const deltaX = newX - el.x;
    const deltaY = newY - el.y;
    const store = useCanvasStore.getState();
    if (store.selectedElementIds.size > 1 && store.selectedElementIds.has(draggedId)) {
      onDragSelectedElementsRef.current?.(deltaX, deltaY);
    } else {
      onDragElementRef.current?.(draggedId, newX, newY);
    }
  }, [setDropTargetFrameId]);

  const handleGroupDragStart = useCallback(() => {
    onGroupDragStartRef.current?.();
  }, []);

  const handleGroupDragMove = useCallback((dx: number, dy: number) => {
    onGroupDragMoveRef.current?.(dx, dy);
  }, []);

  const handleResize = useCallback((id: string, box: ElementBox) => {
    onResizeElementRef.current?.(id, box);
  }, []);

  const handleRotate = useCallback((id: string, rotation: number) => {
    onRotateElementRef.current?.(id, rotation);
  }, []);

  const handleDblClick = useCallback((id: string) => {
    onDblClickElementRef.current?.(id);
  }, []);

  const handleGetDragChildIds = useCallback((frameId: string) => {
    return frameChildIdsByFrameRef.current.get(frameId) ?? [];
  }, []);

  const [singleDragOverride, setSingleDragOverride] = useState<{ id: string; x: number; y: number } | null>(null);

  const dragPositionOverrides = useMemo(() => {
    const hasSingle = !!singleDragOverride;
    const hasGroup = !!groupDrag && (groupDrag.dx !== 0 || groupDrag.dy !== 0);
    if (!hasSingle && !hasGroup) return undefined;

    const overrides = new Map<string, { x: number; y: number }>();

    if (singleDragOverride) {
      overrides.set(singleDragOverride.id, { x: singleDragOverride.x, y: singleDragOverride.y });
    }

    if (hasGroup && groupDrag) {
      for (const el of elements) {
        if (overrides.has(el.id)) continue;
        if (selectedElementIds.has(el.id) || groupDrag.childIds.has(el.id)) {
          overrides.set(el.id, { x: el.x + groupDrag.dx, y: el.y + groupDrag.dy });
        }
      }
    }

    return overrides;
  }, [singleDragOverride, groupDrag, elements, selectedElementIds]);

  const handleDragPositionUpdate = useCallback((id: string, x: number, y: number, width: number, height: number) => {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const target = findFrameAtPoint(cx, cy, frameElementsRef.current);
    setDropTargetFrameId(target);
    setSingleDragOverride({ id, x, y });
  }, [setDropTargetFrameId]);

  const handleDragEnd = useCallback((draggedId: string, newX: number, newY: number) => {
    setSingleDragOverride({ id: draggedId, x: newX, y: newY });
    handleMultiDragEnd(draggedId, newX, newY);
  }, [handleMultiDragEnd]);

  useEffect(() => {
    if (!singleDragOverride) return;
    const el = elementsById.get(singleDragOverride.id);
    if (!el) return;
    const dx = Math.abs(el.x - singleDragOverride.x);
    const dy = Math.abs(el.y - singleDragOverride.y);
    if (dx < 1 && dy < 1) {
      setSingleDragOverride(null);
    }
  }, [singleDragOverride, elementsById]);

  const onLineEndpointDragRef = useRef(onLineEndpointDrag);
  onLineEndpointDragRef.current = onLineEndpointDrag;
  const onLineEndpointDragEndRef = useRef(onLineEndpointDragEnd);
  onLineEndpointDragEndRef.current = onLineEndpointDragEnd;
  const onConnectorEndpointDragRef = useRef(onConnectorEndpointDrag);
  onConnectorEndpointDragRef.current = onConnectorEndpointDrag;
  const onConnectorEndpointDragEndRef = useRef(onConnectorEndpointDragEnd);
  onConnectorEndpointDragEndRef.current = onConnectorEndpointDragEnd;
  const onConnectorLabelClickRef = useRef(onConnectorLabelClick);
  onConnectorLabelClickRef.current = onConnectorLabelClick;

  const handleLineEndpointDrag = useCallback((idx: number, wx: number, wy: number, elementId: string) => {
    onLineEndpointDragRef.current?.(elementId, idx, wx, wy);
  }, []);
  const handleLineEndpointDragEnd = useCallback((idx: number, wx: number, wy: number, elementId: string) => {
    onLineEndpointDragEndRef.current?.(elementId, idx, wx, wy);
  }, []);
  const handleConnectorEndpointDrag = useCallback((endpoint: "from" | "to", wx: number, wy: number, elementId: string) => {
    onConnectorEndpointDragRef.current?.(elementId, endpoint, wx, wy);
  }, []);
  const handleConnectorEndpointDragEnd = useCallback((endpoint: "from" | "to", wx: number, wy: number, elementId: string) => {
    onConnectorEndpointDragEndRef.current?.(elementId, endpoint, wx, wy);
  }, []);
  const handleConnectorLabelClick = useCallback((elementId: string) => {
    onConnectorLabelClickRef.current?.(elementId);
  }, []);

  const onStagePointerDownRef = useRef(onStagePointerDown);
  onStagePointerDownRef.current = onStagePointerDown;
  const onStagePointerMoveRef = useRef(onStagePointerMove);
  onStagePointerMoveRef.current = onStagePointerMove;
  const onStagePointerUpRef = useRef(onStagePointerUp);
  onStagePointerUpRef.current = onStagePointerUp;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const isPointerModeRef = useRef(isPointerMode);
  isPointerModeRef.current = isPointerMode;

  const spatialIndexRef = useRef(spatialIndex);
  spatialIndexRef.current = spatialIndex;
  const sortedElementsRef = useRef(sortedElements);
  sortedElementsRef.current = sortedElements;

  const handleStagePointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!isPointerModeRef.current) return;
    if (isSpacebarPressedRef?.current) return;
    const stage = e.target.getStage();
    if (!stage) return;

    const clickedStageOrStaticLayer = e.target === stage || e.target.getLayer()?.listening() === false;
    if (clickedStageOrStaticLayer) {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const cam = cameraRef.current;
      const worldX = (pos.x - cam.x) / cam.scale;
      const worldY = (pos.y - cam.y) / cam.scale;

      const idx = spatialIndexRef.current;
      if (idx) {
        const rawHits = idx.queryPointHit(worldX, worldY);
        const hits = rawHits.filter((hit) => {
          if (hit.type === "connector")
            return isPointOnConnectorPath({ x: worldX, y: worldY }, hit as ConnectorElement, elementsByIdRef.current);
          if (hit.type === "line")
            return isPointOnLinePath({ x: worldX, y: worldY }, hit as LineElement);
          return true;
        });
        if (hits.length > 0) {
          const sorted = sortedElementsRef.current;
          let topHit = hits[0];
          let topZIndex = -1;
          for (const hit of hits) {
            const zIdx = sorted.findIndex((el) => el.id === hit.id);
            if (zIdx > topZIndex) {
              topZIndex = zIdx;
              topHit = hit;
            }
          }
          const shiftKey = e.evt?.shiftKey ?? false;
          onSelectElementRef.current?.(topHit.id, shiftKey);
          if (!shiftKey) {
            pendingDragRef.current = {
              id: topHit.id,
              screenX: pos.x,
              screenY: pos.y,
              ready: false,
            };
            useCanvasStore.getState().setIsDraggingElement(true);
          }
          return;
        }
      }

      onStagePointerDownRef.current?.(worldX, worldY);
    }
  }, []);

  const handleStagePointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!isPointerModeRef.current) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const pending = pendingDragRef.current;
    if (pending && pending.ready) {
      const dx = pos.x - pending.screenX;
      const dy = pos.y - pending.screenY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        pendingDragRef.current = null;
        const node = stage.findOne(`#element-${pending.id}`);
        if (node) {
          node.startDrag();
          return;
        }
      }
    }

    const cam = cameraRef.current;
    const worldX = (pos.x - cam.x) / cam.scale;
    const worldY = (pos.y - cam.y) / cam.scale;
    onStagePointerMoveRef.current?.(worldX, worldY);
  }, []);

  const handleStagePointerUp = useCallback(() => {
    if (pendingDragRef.current) {
      pendingDragRef.current = null;
      useCanvasStore.getState().setIsDraggingElement(false);
    }
    if (!isPointerModeRef.current) return;
    onStagePointerUpRef.current?.();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageCallbackRef}
          width={size.width}
          height={size.height}
          x={camera.x}
          y={camera.y}
          scaleX={camera.scale}
          scaleY={camera.scale}
          listening={isPointerMode}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
        >
          {syntheticObjectCount > 0 && (
            <Layer listening={false}>
              {Array.from({ length: syntheticObjectCount }).map((_, index) => {
                const row = Math.floor(index / 25);
                const col = index % 25;
                return (
                  <Rect
                    key={`synthetic-${index}`}
                    x={col * 56}
                    y={row * 36}
                    width={48}
                    height={28}
                    cornerRadius={4}
                    fill={index % 2 === 0 ? "#2f7aeb" : "#55c2a0"}
                    opacity={0.8}
                    listening={false}
                  />
                );
              })}
            </Layer>
          )}
          {/* Static layer: non-selected elements, listening disabled for perf.
             Click-to-select is handled via spatial index in handleStagePointerDown. */}
          <Layer listening={false}>
            {staticElements.map((el) => (
              <StaticElementNode
                key={el.id}
                element={el}
                onSelect={handleSelect}
                onDragEnd={handleMultiDragEnd}
                dropTargetFrameId={dropTargetFrameId}
                elementsById={elementsById}
                dragPositionOverrides={dragPositionOverrides}
              />
            ))}
          </Layer>

          {/* Active layer: selected/editing elements with full interactivity */}
          <Layer>
            {activeElements.map((el) => {
              const isSelected = selectedElementIds.has(el.id);
              return (
                <ActiveElementNode
                  key={el.id}
                  element={el}
                  isSelected={isSelected}
                  multiSelected={isSelected && isMultiSelect}
                  draggable={draggable}
                  onSelect={handleSelect}
                  onDragStart={onDragElementStart}
                  onDragMove={onDragElementMove}
                  onDragEnd={handleDragEnd}
                  onGroupDragStart={handleGroupDragStart}
                  onGroupDragMove={handleGroupDragMove}
                  onResize={handleResize}
                  onRotate={handleRotate}
                  onRotateCursorChange={onRotateCursorChange}
                  onDblClick={handleDblClick}
                  getDragChildIds={handleGetDragChildIds}
                  onDragPositionUpdate={handleDragPositionUpdate}
                  editingElementId={editingElementId}
                  editingConnectorLabel={editingConnectorLabel}
                  dropTargetFrameId={dropTargetFrameId}
                  elementsById={elementsById}
                  dragPositionOverrides={dragPositionOverrides}
                  onLineEndpointDrag={handleLineEndpointDrag}
                  onLineEndpointDragEnd={handleLineEndpointDragEnd}
                  onConnectorEndpointDrag={handleConnectorEndpointDrag}
                  onConnectorEndpointDragEnd={handleConnectorEndpointDragEnd}
                  onConnectorLabelClick={handleConnectorLabelClick}
                  isSpacebarPressedRef={isSpacebarPressedRef}
                  isSpacebarPressed={isSpacebarPressed}
                />
              );
            })}

            {/* Group selection bounding box */}
            {groupBounds && (
              <Rect
                x={groupBounds.x}
                y={groupBounds.y}
                width={groupBounds.width}
                height={groupBounds.height}
                stroke="#60a5fa"
                strokeWidth={2 / storeZoomScale}
                cornerRadius={6 / storeZoomScale}
                dash={[6 / storeZoomScale, 3 / storeZoomScale]}
                listening={false}
              />
            )}

            {/* Connector snap anchor points */}
            {connectorSnapAnchors.map((anchor, i) => (
              <KonvaCircle
                key={`snap-anchor-${i}`}
                x={anchor.x}
                y={anchor.y}
                radius={7 / storeZoomScale}
                fill="white"
                stroke="#60a5fa"
                strokeWidth={2 / storeZoomScale}
                opacity={1}
                listening={false}
              />
            ))}

            {/* Active snap target highlight */}
            {connectorSnapTarget && (
              <KonvaCircle
                x={connectorSnapTarget.x}
                y={connectorSnapTarget.y}
                radius={10 / storeZoomScale}
                fill="rgba(96, 165, 250, 0.4)"
                stroke="#2563eb"
                strokeWidth={2.5 / storeZoomScale}
                listening={false}
              />
            )}

            {/* Marquee selection rectangle */}
            {marqueeRect && (
              <Rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.width}
                height={marqueeRect.height}
                fill="rgba(96, 165, 250, 0.1)"
                stroke="#60a5fa"
                strokeWidth={1 / storeZoomScale}
                dash={[6 / storeZoomScale, 3 / storeZoomScale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
});
