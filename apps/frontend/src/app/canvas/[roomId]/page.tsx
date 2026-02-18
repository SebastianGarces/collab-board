"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import type Konva from "konva";
import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { SelectionToolbar } from "@/components/board/selection-toolbar";
import { Toolbar, type ActiveTool } from "@/components/board/toolbar";
import { computePath, findNearbyAnchors, findSnapTarget, getPathMidpoint, isOrthogonalHorizontalFirst, resolveEndpoints, type Point } from "@/components/canvas/connector-utils";
import {
  createBoxFromDrag,
  MIN_ELEMENT_SIZE,
  type ElementBox,
} from "@/components/canvas/shape-transform";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useYjsElements } from "@/hooks/use-yjs-elements";
import { authClient } from "@/lib/auth-client";
import { createCollabConnection, type Camera, type ConnectionState } from "@/lib/collab";
import { deserializeElement, findFrameAtPoint, getBoundingBox, serializeElement } from "@/lib/element-utils";
import { createPerfProbeCollector } from "@/lib/perf-probe";
import { useCanvasStore } from "@/stores/canvas-store";
import type { BoardElement, FrameElement, PresenceState, PresenceUser } from "@collab/shared/collab";
import {
  DEFAULT_CONNECTOR_STROKE,
  DEFAULT_CONNECTOR_STROKE_WIDTH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_STICKY_NOTE_FONT_SIZE,
  DEFAULT_STICKY_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  STICKY_NOTE_COLORS
} from "@collab/shared/collab";
import { stripHtmlTags } from "@collab/shared/validation";

const BoardCanvas = dynamic(
  () => import("@/components/canvas/board-canvas").then((m) => m.BoardCanvas),
  { ssr: false }
);

const RotationCursor = dynamic(
  () => import("@/components/canvas/rotation-cursor").then((m) => m.RotationCursor),
  { ssr: false }
);

const DebugMetrics = dynamic(
  () => import("@/components/canvas/debug-metrics").then((m) => m.DebugMetrics),
  { ssr: false }
);

type RemoteCursor = {
  clientId: number;
  user: PresenceState["user"];
  cursor: { x: number; y: number };
};

type DrawingShapeState = {
  id: string;
  tool: "rectangle" | "circle" | "line" | "frame" | "connector";
  start: { x: number; y: number };
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorFromId(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360} 70% 55%)`;
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const RemoteCursorOverlay = memo(function RemoteCursorOverlay({
  remoteCursors,
  camera,
}: {
  remoteCursors: RemoteCursor[];
  camera: Camera;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {remoteCursors.map((remote) => (
        <div
          key={remote.clientId}
          className="absolute left-0 top-0"
          style={{
            willChange: "transform",
            transform: `translate(${remote.cursor.x * camera.scale + camera.x}px, ${remote.cursor.y * camera.scale + camera.y}px)`,
          }}
        >
          <svg className="w-[22px] h-[22px] block" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 3L4 20L9.5 14.8L13 21L16.3 19.2L12.8 13L20 13L4 3Z"
              fill={remote.user.color}
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="mt-1 inline-block px-1.5 py-0.5 rounded-md bg-[#121212]/85 border border-[#3a3a3a] text-xs whitespace-nowrap">
            {remote.user.name}
          </span>
        </div>
      ))}
    </div>
  );
});

export default function CanvasPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const dotGridRef = useRef<HTMLDivElement | null>(null);

  const setCamera = useCallback((next: Camera | ((prev: Camera) => Camera)) => {
    const resolved = typeof next === "function" ? next(cameraRef.current) : next;
    cameraRef.current = resolved;
    setCameraState(resolved);
  }, []);

  const applyCameraDirect = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    const stage = konvaStageRef.current;
    if (stage) {
      stage.position({ x: cam.x, y: cam.y });
      stage.scale({ x: cam.scale, y: cam.scale });
      stage.batchDraw();
    }
    const grid = dotGridRef.current;
    if (grid) {
      grid.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
      grid.style.backgroundSize = `${24 * cam.scale}px ${24 * cam.scale}px`;
    }
  }, []);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [boardName, setBoardName] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacebarPressed, setIsSpacebarPressed] = useState(false);
  const [syntheticObjectCount, setSyntheticObjectCount] = useState(0);
  const [activeTool, setActiveTool] = useState<ActiveTool>("pointer");
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const selectElement = useCanvasStore((s) => s.selectElement);
  const setSelectedElementIds = useCanvasStore((s) => s.setSelectedElementIds);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingConnectorLabel, setEditingConnectorLabel] = useState(false);
  const [isDraggingElement, setIsDraggingElement] = useState(false);
  const [editText, setEditText] = useState("");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSpacebarPressedRef = useRef(false);
  const connectionRef = useRef<ReturnType<typeof createCollabConnection> | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [yjsDoc, setYjsDoc] = useState<Y.Doc | null>(null);
  const perfCollectorRef = useRef(createPerfProbeCollector());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingShapeRef = useRef<DrawingShapeState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [rotationCursor, setRotationCursor] = useState<{ corner: "nw" | "ne" | "se" | "sw"; elementRotation: number } | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [connectorSnapAnchors, setConnectorSnapAnchors] = useState<Point[]>([]);
  const [connectorSnapTarget, setConnectorSnapTarget] = useState<Point | null>(null);
  const pendingDragMoveRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const pendingResizeRef = useRef<{ id: string; box: ElementBox } | null>(null);
  const pendingRotateRef = useRef<{ id: string; rotation: number } | null>(null);
  const pendingLiveEditTextRef = useRef<string | null>(null);
  const pendingRemoteCursorsRef = useRef<RemoteCursor[] | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const rotateRafRef = useRef<number | null>(null);
  const liveEditRafRef = useRef<number | null>(null);
  const remoteCursorRafRef = useRef<number | null>(null);
  const perfElementIdRef = useRef<string | null>(null);
  const konvaStageRef = useRef<Konva.Stage | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const handleStageRef = useCallback((stage: Konva.Stage | null) => {
    konvaStageRef.current = stage;
  }, []);

  const perfEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PERF_PROBES === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development";

  const currentUser = useMemo(() => {
    if (!session?.user) return null;
    const rawName = session.user.name ?? session.user.email ?? "Anonymous";
    // Sanitize user name and truncate to max length
    const sanitizedName = stripHtmlTags(rawName).slice(0, 100);
    return {
      id: session.user.id,
      name: sanitizedName || "Anonymous",
      color: colorFromId(session.user.id)
    };
  }, [session?.user]);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
    fetch(`${apiUrl}/api/boards/${roomId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.name) setBoardName(data.name);
      })
      .catch(() => {});
  }, [roomId]);

  useEffect(() => {
    if (!currentUser) return;

    const connection = createCollabConnection({
      roomId,
      user: currentUser,
      onStatesChange(states, localClientId) {
        const cursors: RemoteCursor[] = [];
        const users: PresenceUser[] = [];
        states.forEach((state, clientId) => {
          if (!state?.user) return;
          users.push(state.user);
          if (clientId === localClientId) return;
          if (!state.cursor) return;
          cursors.push({ clientId, cursor: state.cursor, user: state.user });
        });
        setOnlineUsers(users);
        pendingRemoteCursorsRef.current = cursors;
        if (remoteCursorRafRef.current === null) {
          remoteCursorRafRef.current = requestAnimationFrame(() => {
            remoteCursorRafRef.current = null;
            if (pendingRemoteCursorsRef.current) {
              setRemoteCursors(pendingRemoteCursorsRef.current);
              pendingRemoteCursorsRef.current = null;
            }
          });
        }
      },
      onConnectionStateChange: setConnectionState,
      onPerfProbe(probe) {
        if (!perfEnabled) return;
        perfCollectorRef.current.recordProbe(probe.kind, probe.latencyMs);
      }
    });

    connectionRef.current = connection;
    docRef.current = connection.doc;
    setYjsDoc(connection.doc);
    return () => {
      connection.disconnect();
      connectionRef.current = null;
      docRef.current = null;
      setYjsDoc(null);
    };
  }, [currentUser, roomId, perfEnabled]);

  const elements = useYjsElements(yjsDoc);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  useEffect(() => {
    if (!perfEnabled) return;
    const collector = perfCollectorRef.current;
    collector.startFrameSampling();
    const interval = window.setInterval(() => {
      const summary = collector.getSummary();
      console.info(
        JSON.stringify({
          type: "frontend_perf_metrics",
          roomId,
          at: new Date().toISOString(),
          ...summary
        })
      );
    }, 30_000);

    return () => {
      window.clearInterval(interval);
      collector.stopFrameSampling();
    };
  }, [perfEnabled, roomId]);

  useEffect(() => {
    if (!perfEnabled) return;
    type PerfSummary = ReturnType<ReturnType<typeof createPerfProbeCollector>["getSummary"]>;
    type PerfTestApi = {
      getSummary: () => PerfSummary;
      sendCursorProbe: (count?: number) => Promise<void>;
      sendObjectProbe: (count?: number) => Promise<void>;
      setSyntheticObjectCount: (count: number) => void;
      runPanZoomScript: (durationMs?: number) => Promise<void>;
      runInteractionScript: (steps?: number) => Promise<void>;
    };

    const api: PerfTestApi = {
      getSummary: () => perfCollectorRef.current.getSummary(),
      sendCursorProbe: async (count = 100) => {
        const connection = connectionRef.current;
        if (!connection) return;
        for (let index = 0; index < count; index++) {
          connection.sendPerfProbe("cursor", `front-cursor-${Date.now()}-${index}`);
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
        }
      },
      sendObjectProbe: async (count = 100) => {
        const connection = connectionRef.current;
        if (!connection) return;
        for (let index = 0; index < count; index++) {
          connection.sendPerfProbe("object", `front-object-${Date.now()}-${index}`);
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
        }
      },
      setSyntheticObjectCount: (count: number) => {
        setSyntheticObjectCount(Math.max(0, Math.floor(count)));
      },
      runPanZoomScript: async (durationMs = 5000) => {
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const tick = () => {
            const elapsed = performance.now() - started;
            if (elapsed >= durationMs) {
              setCameraState(cameraRef.current);
              resolve();
              return;
            }
            const scale = clamp(1 + Math.sin(elapsed / 300) * 0.3, MIN_SCALE, MAX_SCALE);
            applyCameraDirect({
              x: Math.sin(elapsed / 500) * 80,
              y: Math.cos(elapsed / 400) * 60,
              scale
            });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      runInteractionScript: async (steps = 180) => {
        const doc = docRef.current;
        if (!doc) return;
        const elementsMap = doc.getMap("elements");

        let elementId = perfElementIdRef.current;
        let elementMap =
          elementId ? (elementsMap.get(elementId) as Y.Map<unknown> | undefined) : undefined;

        if (!elementMap) {
          elementId = generateId();
          const newElementMap = new Y.Map<unknown>();
          newElementMap.set("type", "rectangle");
          newElementMap.set("id", elementId);
          newElementMap.set("x", 140);
          newElementMap.set("y", 120);
          newElementMap.set("width", 180);
          newElementMap.set("height", 120);
          newElementMap.set("fill", "#3b82f6");
          newElementMap.set("stroke", "#2c61b8");
          elementsMap.set(elementId, newElementMap);
          perfElementIdRef.current = elementId;
          elementMap = newElementMap;
        }
        if (!elementId || !elementMap) return;

        const resolvedElementId = elementId;
        for (let index = 0; index < steps; index++) {
          perfCollectorRef.current.markInput();
          setSelectedElementIds(new Set([resolvedElementId]));
          const nextW = 140 + (index % 15) * 8;
          const nextH = 90 + (index % 12) * 7;
          doc.transact(() => {
            elementMap!.set("width", nextW);
            elementMap!.set("height", nextH);
          });
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 16);
          });
        }
      },
    };

    (window as unknown as { __collabPerf?: PerfTestApi }).__collabPerf = api;
    return () => {
      delete (window as unknown as { __collabPerf?: PerfTestApi }).__collabPerf;
    };
  }, [perfEnabled]);

  // --- Element operations ---

  /** Assign frameId to a newly created element based on its center position. */
  const assignFrameIdToElement = useCallback(
    (elementMap: Y.Map<unknown>, centerX: number, centerY: number) => {
      const frames = elementsRef.current.filter(
        (e) => e.type === "frame"
      ) as FrameElement[];
      const targetFrameId = findFrameAtPoint(centerX, centerY, frames);
      if (targetFrameId) {
        elementMap.set("frameId", targetFrameId);
      }
    },
    []
  );

  const createStickyNote = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      const color = STICKY_NOTE_COLORS[Math.floor(Math.random() * STICKY_NOTE_COLORS.length)];
      elementMap.set("type", "sticky-note");
      elementMap.set("id", id);
      elementMap.set("x", worldX - DEFAULT_STICKY_NOTE_SIZE.width / 2);
      elementMap.set("y", worldY - DEFAULT_STICKY_NOTE_SIZE.height / 2);
      elementMap.set("width", DEFAULT_STICKY_NOTE_SIZE.width);
      elementMap.set("height", DEFAULT_STICKY_NOTE_SIZE.height);
      elementMap.set("text", "");
      elementMap.set("color", color);
      elementMap.set("fontSize", DEFAULT_STICKY_NOTE_FONT_SIZE);
      elementMap.set("fontFamily", DEFAULT_FONT_FAMILY);
      assignFrameIdToElement(elementMap, worldX, worldY);

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      setActiveTool("pointer");
    },
    [assignFrameIdToElement]
  );

  const createRectangleDraft = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return null;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      elementMap.set("type", "rectangle");
      elementMap.set("id", id);
      elementMap.set("x", worldX);
      elementMap.set("y", worldY);
      elementMap.set("width", MIN_ELEMENT_SIZE);
      elementMap.set("height", MIN_ELEMENT_SIZE);
      elementMap.set("fill", "#3b82f6");
      elementMap.set("stroke", "#2c61b8");

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      return id;
    },
    []
  );

  const createCircleDraft = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return null;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      elementMap.set("type", "circle");
      elementMap.set("id", id);
      elementMap.set("x", worldX);
      elementMap.set("y", worldY);
      elementMap.set("width", MIN_ELEMENT_SIZE);
      elementMap.set("height", MIN_ELEMENT_SIZE);
      elementMap.set("fill", "#8b5cf6");
      elementMap.set("stroke", "#6845b8");

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      return id;
    },
    []
  );

  const createLineDraft = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return null;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      elementMap.set("type", "line");
      elementMap.set("id", id);
      elementMap.set("x", worldX);
      elementMap.set("y", worldY);
      elementMap.set("width", 0);
      elementMap.set("height", 0);
      elementMap.set("stroke", "#f8fafc");
      elementMap.set("strokeWidth", 3);
      elementMap.set("points", [0, 0, 0, 0]);

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      return id;
    },
    []
  );

  const createTextElement = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      elementMap.set("type", "text");
      elementMap.set("id", id);
      elementMap.set("x", worldX - DEFAULT_TEXT_SIZE.width / 2);
      elementMap.set("y", worldY - DEFAULT_TEXT_SIZE.height / 2);
      elementMap.set("width", DEFAULT_TEXT_SIZE.width);
      elementMap.set("height", DEFAULT_TEXT_SIZE.height);
      elementMap.set("text", "");
      elementMap.set("fontSize", 18);
      elementMap.set("fontFamily", DEFAULT_FONT_FAMILY);
      elementMap.set("fill", "#f8fafc");
      assignFrameIdToElement(elementMap, worldX, worldY);

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      setActiveTool("pointer");
      setEditingElementId(id);
      setEditText("");
    },
    [assignFrameIdToElement]
  );

  const createFrameDraft = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return null;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      // Count existing frames with default "Frame N" names to determine next number
      const framePattern = /^Frame (\d+)$/;
      let maxFrameNum = 0;
      elementsMap.forEach((val) => {
        const m = val as Y.Map<unknown> | undefined;
        if (m && typeof m.get === "function" && m.get("type") === "frame") {
          const title = m.get("title") as string | undefined;
          if (title) {
            const match = title.match(framePattern);
            if (match) {
              maxFrameNum = Math.max(maxFrameNum, parseInt(match[1], 10));
            }
          }
        }
      });

      elementMap.set("type", "frame");
      elementMap.set("id", id);
      elementMap.set("x", worldX);
      elementMap.set("y", worldY);
      elementMap.set("width", MIN_ELEMENT_SIZE);
      elementMap.set("height", MIN_ELEMENT_SIZE);
      elementMap.set("title", `Frame ${maxFrameNum + 1}`);
      elementMap.set("fill", "#f5f5f5");
      elementMap.set("stroke", "#d4d4d4");
      elementMap.set("strokeStyle", "solid");
      elementMap.set("hidden", false);

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      return id;
    },
    []
  );

  const createConnectorDraft = useCallback(
    (worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return null;
      const elementsMap = doc.getMap("elements");
      const id = generateId();
      const elementMap = new Y.Map<unknown>();

      elementMap.set("type", "connector");
      elementMap.set("id", id);
      elementMap.set("x", worldX);
      elementMap.set("y", worldY);
      elementMap.set("width", 0);
      elementMap.set("height", 0);
      elementMap.set("fromId", "");
      elementMap.set("toId", "");
      elementMap.set("fromAnchor", null);
      elementMap.set("toAnchor", null);
      elementMap.set("fromX", worldX);
      elementMap.set("fromY", worldY);
      elementMap.set("toX", worldX);
      elementMap.set("toY", worldY);
      elementMap.set("routingStyle", "orthogonal");
      elementMap.set("startArrow", "none");
      elementMap.set("endArrow", "none");
      elementMap.set("stroke", DEFAULT_CONNECTOR_STROKE);
      elementMap.set("strokeWidth", DEFAULT_CONNECTOR_STROKE_WIDTH);
      elementMap.set("dashStyle", "solid");
      elementMap.set("labelText", "");
      elementMap.set("labelFontSize", 14);
      elementMap.set("labelFontFamily", DEFAULT_FONT_FAMILY);
      elementMap.set("labelFill", "#f8fafc");
      elementMap.set("labelBold", false);
      elementMap.set("labelStrikethrough", false);

      elementsMap.set(id, elementMap);
      setSelectedElementIds(new Set([id]));
      return id;
    },
    []
  );

  const moveConnectorEndpoint = useCallback(
    (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (!elementMap) return;

      const xKey = endpoint === "from" ? "fromX" : "toX";
      const yKey = endpoint === "from" ? "fromY" : "toY";
      const idKey = endpoint === "from" ? "fromId" : "toId";
      const anchorKey = endpoint === "from" ? "fromAnchor" : "toAnchor";

      doc.transact(() => {
        elementMap.set(xKey, worldX);
        elementMap.set(yKey, worldY);
        elementMap.set(idKey, "");
        elementMap.set(anchorKey, null);

        // Update bounding box
        const fx = endpoint === "from" ? worldX : (elementMap.get("fromX") as number) ?? 0;
        const fy = endpoint === "from" ? worldY : (elementMap.get("fromY") as number) ?? 0;
        const tx = endpoint === "to" ? worldX : (elementMap.get("toX") as number) ?? 0;
        const ty = endpoint === "to" ? worldY : (elementMap.get("toY") as number) ?? 0;
        elementMap.set("x", Math.min(fx, tx));
        elementMap.set("y", Math.min(fy, ty));
        elementMap.set("width", Math.max(Math.abs(tx - fx), 1));
        elementMap.set("height", Math.max(Math.abs(ty - fy), 1));
      });
    },
    []
  );

  const finalizeConnectorEndpoint = useCallback(
    (id: string, endpoint: "from" | "to", worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (!elementMap) return;

      const excludeIds = new Set([id]);
      const snap = findSnapTarget({ x: worldX, y: worldY }, elements, excludeIds);

      const xKey = endpoint === "from" ? "fromX" : "toX";
      const yKey = endpoint === "from" ? "fromY" : "toY";
      const idKey = endpoint === "from" ? "fromId" : "toId";
      const anchorKey = endpoint === "from" ? "fromAnchor" : "toAnchor";

      doc.transact(() => {
        if (snap) {
          elementMap.set(xKey, snap.anchor.x);
          elementMap.set(yKey, snap.anchor.y);
          elementMap.set(idKey, snap.element.id);
          elementMap.set(anchorKey, snap.anchorIndex);
        } else {
          elementMap.set(xKey, worldX);
          elementMap.set(yKey, worldY);
          elementMap.set(idKey, "");
          elementMap.set(anchorKey, null);
        }

        // Update bounding box
        const fx = endpoint === "from" ? (snap ? snap.anchor.x : worldX) : (elementMap.get("fromX") as number) ?? 0;
        const fy = endpoint === "from" ? (snap ? snap.anchor.y : worldY) : (elementMap.get("fromY") as number) ?? 0;
        const tx = endpoint === "to" ? (snap ? snap.anchor.x : worldX) : (elementMap.get("toX") as number) ?? 0;
        const ty = endpoint === "to" ? (snap ? snap.anchor.y : worldY) : (elementMap.get("toY") as number) ?? 0;
        elementMap.set("x", Math.min(fx, tx));
        elementMap.set("y", Math.min(fy, ty));
        elementMap.set("width", Math.max(Math.abs(tx - fx), 1));
        elementMap.set("height", Math.max(Math.abs(ty - fy), 1));
      });
    },
    [elements]
  );

  const moveConnectorMidpoint = useCallback(
    (id: string, _segmentIndex: number, worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (!elementMap) return;

      const el = elements.find((e) => e.id === id);
      if (!el || el.type !== "connector") return;

      const resolved = resolveEndpoints(el, elements);
      const hFirst = isOrthogonalHorizontalFirst(resolved.from, resolved.to, el.fromAnchor, el.toAnchor);

      doc.transact(() => {
        elementMap.set("elbowMidpoint", hFirst ? worldX : worldY);
      });
    },
    [elements]
  );

  // Read frame children directly from Yjs (avoids stale React state issues)
  const getFrameChildIdsFromYjs = useCallback((frameId: string): string[] => {
    const doc = docRef.current;
    if (!doc) return [];
    const elementsMap = doc.getMap("elements");
    const ids: string[] = [];
    elementsMap.forEach((val, key) => {
      const m = val as Y.Map<unknown>;
      if (m && typeof m.get === "function" && m.get("frameId") === frameId) {
        ids.push(key);
      }
    });
    return ids;
  }, []);

  const moveElement = useCallback((id: string, x: number, y: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;

    const elType = elementMap.get("type") as string | undefined;
    if (elType === "frame") {
      const oldX = (elementMap.get("x") as number) ?? 0;
      const oldY = (elementMap.get("y") as number) ?? 0;
      const deltaX = x - oldX;
      const deltaY = y - oldY;

      // Read children directly from Yjs (avoids stale React state)
      const childIds: string[] = [];
      elementsMap.forEach((val, key) => {
        const m = val as Y.Map<unknown>;
        if (m && typeof m.get === "function" && m.get("frameId") === id) {
          childIds.push(key);
        }
      });

      doc.transact(() => {
        elementMap.set("x", x);
        elementMap.set("y", y);
        for (const childId of childIds) {
          const childMap = elementsMap.get(childId) as Y.Map<unknown> | undefined;
          if (!childMap) continue;
          const cx = (childMap.get("x") as number) ?? 0;
          const cy = (childMap.get("y") as number) ?? 0;
          childMap.set("x", cx + deltaX);
          childMap.set("y", cy + deltaY);
        }
      });
    } else {
      const w = (elementMap.get("width") as number) ?? 0;
      const h = (elementMap.get("height") as number) ?? 0;
      const newCx = x + w / 2;
      const newCy = y + h / 2;

      // Build frame list from Yjs for drop-target check
      const frames: FrameElement[] = [];
      elementsMap.forEach((val, key) => {
        const m = val as Y.Map<unknown>;
        if (m && typeof m.get === "function" && m.get("type") === "frame" && key !== id) {
          frames.push({
            id: key,
            type: "frame",
            x: (m.get("x") as number) ?? 0,
            y: (m.get("y") as number) ?? 0,
            width: (m.get("width") as number) ?? 0,
            height: (m.get("height") as number) ?? 0,
            title: (m.get("title") as string) ?? "",
            fill: (m.get("fill") as string) ?? "",
            stroke: (m.get("stroke") as string) ?? "",
            strokeStyle: "solid",
            hidden: false,
          });
        }
      });
      const targetFrameId = findFrameAtPoint(newCx, newCy, frames);

      doc.transact(() => {
        elementMap.set("x", x);
        elementMap.set("y", y);
        elementMap.set("frameId", targetFrameId);
      });
    }
  }, []);

  const moveSelectedElements = useCallback((deltaX: number, deltaY: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const ids = useCanvasStore.getState().selectedElementIds;
    const elementsMap = doc.getMap("elements");

    // Read frame info directly from Yjs (avoids stale React state)
    const selectedFrameIds = new Set<string>();
    const shiftedFrames: FrameElement[] = [];

    elementsMap.forEach((val, key) => {
      const m = val as Y.Map<unknown>;
      if (!m || typeof m.get !== "function") return;
      if (m.get("type") !== "frame") return;
      if (ids.has(key)) selectedFrameIds.add(key);
      const isMoving = ids.has(key);
      shiftedFrames.push({
        id: key,
        type: "frame",
        x: ((m.get("x") as number) ?? 0) + (isMoving ? deltaX : 0),
        y: ((m.get("y") as number) ?? 0) + (isMoving ? deltaY : 0),
        width: (m.get("width") as number) ?? 0,
        height: (m.get("height") as number) ?? 0,
        title: (m.get("title") as string) ?? "",
        fill: (m.get("fill") as string) ?? "",
        stroke: (m.get("stroke") as string) ?? "",
        strokeStyle: "solid",
        hidden: false,
      });
    });

    doc.transact(() => {
      for (const id of ids) {
        const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
        if (!elementMap) continue;
        const oldX = (elementMap.get("x") as number) ?? 0;
        const oldY = (elementMap.get("y") as number) ?? 0;
        const newX = oldX + deltaX;
        const newY = oldY + deltaY;
        elementMap.set("x", newX);
        elementMap.set("y", newY);

        // Auto-assign frameId for non-frame elements whose parent frame is not also selected
        const elType = elementMap.get("type") as string | undefined;
        if (elType !== "frame") {
          const currentFrameId = (elementMap.get("frameId") as string) ?? null;
          const parentAlsoMoving = currentFrameId && selectedFrameIds.has(currentFrameId);
          if (!parentAlsoMoving) {
            const w = (elementMap.get("width") as number) ?? 0;
            const h = (elementMap.get("height") as number) ?? 0;
            const targetFrameId = findFrameAtPoint(newX + w / 2, newY + h / 2, shiftedFrames);
            elementMap.set("frameId", targetFrameId);
          }
        }
      }
    });
  }, []);

  const flushPendingDragMove = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const pending = pendingDragMoveRef.current;
    if (!pending) return;
    pendingDragMoveRef.current = null;
    const elementMap = elementsMap.get(pending.id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set("x", pending.x);
      elementMap.set("y", pending.y);
    });
  }, []);

  const onDragElementMove = useCallback(
    (id: string, x: number, y: number) => {
      pendingDragMoveRef.current = { id, x, y };
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = window.requestAnimationFrame(() => {
        dragMoveRafRef.current = null;
        flushPendingDragMove();
      });
    },
    [flushPendingDragMove]
  );

  const flushPendingResize = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const pending = pendingResizeRef.current;
    if (!pending) return;
    pendingResizeRef.current = null;
    const elementMap = elementsMap.get(pending.id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set("x", pending.box.x);
      elementMap.set("y", pending.box.y);
      elementMap.set("width", pending.box.width);
      elementMap.set("height", pending.box.height);
    });
  }, []);

  const resizeElement = useCallback(
    (id: string, box: ElementBox) => {
      pendingResizeRef.current = { id, box };
      if (resizeRafRef.current !== null) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        flushPendingResize();
      });
    },
    [flushPendingResize]
  );

  const flushPendingRotate = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const pending = pendingRotateRef.current;
    if (!pending) return;
    pendingRotateRef.current = null;
    const elementMap = elementsMap.get(pending.id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set("rotation", pending.rotation);
    });
  }, []);

  const rotateElement = useCallback(
    (id: string, rotation: number) => {
      pendingRotateRef.current = { id, rotation };
      if (rotateRafRef.current !== null) return;
      rotateRafRef.current = window.requestAnimationFrame(() => {
        rotateRafRef.current = null;
        flushPendingRotate();
      });
    },
    [flushPendingRotate]
  );

  useEffect(() => {
    return () => {
      if (dragMoveRafRef.current !== null) {
        window.cancelAnimationFrame(dragMoveRafRef.current);
      }
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
      }
      if (rotateRafRef.current !== null) {
        window.cancelAnimationFrame(rotateRafRef.current);
      }
      if (remoteCursorRafRef.current !== null) {
        window.cancelAnimationFrame(remoteCursorRafRef.current);
      }
    };
  }, []);

  const moveLineEndpoint = useCallback(
    (id: string, endpointIndex: number, worldX: number, worldY: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const elementsMap = doc.getMap("elements");
      const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (!elementMap) return;

      const oldPoints = (elementMap.get("points") as number[]) ?? [0, 0, 0, 0];
      const elX = (elementMap.get("x") as number) ?? 0;
      const elY = (elementMap.get("y") as number) ?? 0;

      const localX = worldX - elX;
      const localY = worldY - elY;

      const newPoints = [...oldPoints];
      if (endpointIndex === 0) {
        newPoints[0] = localX;
        newPoints[1] = localY;
      } else {
        newPoints[2] = localX;
        newPoints[3] = localY;
      }

      const allX = [newPoints[0], newPoints[2]];
      const allY = [newPoints[1], newPoints[3]];
      const minPx = Math.min(...allX);
      const minPy = Math.min(...allY);
      const maxPx = Math.max(...allX);
      const maxPy = Math.max(...allY);

      const normPoints = newPoints.map((v, i) =>
        i % 2 === 0 ? v - minPx : v - minPy
      );

      doc.transact(() => {
        elementMap.set("x", elX + minPx);
        elementMap.set("y", elY + minPy);
        elementMap.set("width", maxPx - minPx);
        elementMap.set("height", maxPy - minPy);
        elementMap.set("points", normPoints);
      });
    },
    []
  );

  const deleteElement = useCallback((id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");

    // If the element is a frame, also delete its children (read from Yjs)
    const el = elementsMap.get(id) as Y.Map<unknown> | undefined;
    const childIds: string[] = [];
    if (el && el.get("type") === "frame") {
      elementsMap.forEach((val, key) => {
        const m = val as Y.Map<unknown>;
        if (m && typeof m.get === "function" && m.get("frameId") === id) {
          childIds.push(key);
        }
      });
    }

    doc.transact(() => {
      elementsMap.delete(id);
      for (const childId of childIds) {
        elementsMap.delete(childId);
      }
    });

    const prev = useCanvasStore.getState().selectedElementIds;
    const idsToRemove = new Set([id, ...childIds]);
    if ([...idsToRemove].some((rid) => prev.has(rid))) {
      const next = new Set(prev);
      for (const rid of idsToRemove) next.delete(rid);
      setSelectedElementIds(next);
    }
  }, [setSelectedElementIds]);

  const deleteSelectedElements = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const ids = useCanvasStore.getState().selectedElementIds;
    const elementsMap = doc.getMap("elements");

    // Expand selection: include children of any selected frames (read from Yjs)
    const allIds = new Set(ids);
    for (const id of ids) {
      const el = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (el && el.get("type") === "frame") {
        elementsMap.forEach((val, key) => {
          const m = val as Y.Map<unknown>;
          if (m && typeof m.get === "function" && m.get("frameId") === id) {
            allIds.add(key);
          }
        });
      }
    }

    doc.transact(() => {
      for (const id of allIds) {
        elementsMap.delete(id);
      }
    });
    clearSelection();
  }, [clearSelection]);

  const duplicateSelectedElements = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const ids = useCanvasStore.getState().selectedElementIds;
    if (ids.size === 0) return;

    const elementsMap = doc.getMap("elements");

    // Expand selection: include children of any selected frames.
    // Read directly from Yjs (not React state) so rapid Cmd+D always sees latest data.
    const allIds = new Set(ids);
    for (const id of ids) {
      const src = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (src && src.get("type") === "frame") {
        elementsMap.forEach((val, key) => {
          const m = val as Y.Map<unknown>;
          if (m && typeof m.get === "function" && m.get("frameId") === id) {
            allIds.add(key);
          }
        });
      }
    }

    // Step 1: Read all source data into plain JS objects (snapshot before mutation)
    const sourceData = new Map<string, Record<string, unknown>>();
    for (const id of allIds) {
      const src = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (!src) continue;
      const data: Record<string, unknown> = {};
      src.forEach((value, key) => {
        data[key] = key === "points" && Array.isArray(value) ? [...value] : value;
      });
      sourceData.set(id, data);
    }

    // Step 2: Build oldId -> newId map
    const idMap = new Map<string, string>();
    for (const id of sourceData.keys()) {
      idMap.set(id, generateId());
    }

    // Step 3: Find the highest existing "Frame N" number for rename
    const framePattern = /^Frame (\d+)$/;
    let maxFrameNum = 0;
    elementsMap.forEach((val) => {
      const m = val as Y.Map<unknown> | undefined;
      if (m && typeof m.get === "function" && m.get("type") === "frame") {
        const title = m.get("title") as string | undefined;
        if (title) {
          const match = title.match(framePattern);
          if (match) {
            maxFrameNum = Math.max(maxFrameNum, parseInt(match[1], 10));
          }
        }
      }
    });

    // Step 4: Clone from plain data — integrate Y.Map first, then set properties
    const offset = { x: 20, y: 20 };
    const newIds: string[] = [];

    doc.transact(() => {
      for (const [oldId, newId] of idMap) {
        const data = sourceData.get(oldId);
        if (!data) continue;

        const newMap = new Y.Map<unknown>();
        elementsMap.set(newId, newMap); // integrate into doc FIRST

        // Set all properties on the now-integrated map
        newMap.set("id", newId);
        for (const [key, value] of Object.entries(data)) {
          if (key === "id") continue; // already set
          if (key === "x") {
            newMap.set("x", (typeof value === "number" ? value : 0) + offset.x);
          } else if (key === "y") {
            newMap.set("y", (typeof value === "number" ? value : 0) + offset.y);
          } else if (key === "frameId") {
            // Hard-link: remap to cloned frame, or clear if parent wasn't duplicated
            const oldFrameId = value as string | null;
            if (oldFrameId && idMap.has(oldFrameId)) {
              newMap.set("frameId", idMap.get(oldFrameId)!);
            } else {
              newMap.set("frameId", null);
            }
          } else if (key === "points" && Array.isArray(value)) {
            newMap.set("points", [...value]);
          } else {
            newMap.set(key, value);
          }
        }

        // Rename duplicated frames sequentially
        if (data.type === "frame") {
          maxFrameNum++;
          newMap.set("title", `Frame ${maxFrameNum}`);
        }

        newIds.push(newId);
      }
    });

    // Select the newly duplicated elements
    setSelectedElementIds(new Set(newIds));
  }, [setSelectedElementIds]);

  const copySelectedElements = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const ids = useCanvasStore.getState().selectedElementIds;
    if (ids.size === 0) return;

    const elementsMap = doc.getMap("elements");

    // Expand selection: include children of any selected frames (read from Yjs)
    const allIds = new Set(ids);
    for (const id of ids) {
      const el = elementsMap.get(id) as Y.Map<unknown> | undefined;
      if (el && el.get("type") === "frame") {
        elementsMap.forEach((val, key) => {
          const m = val as Y.Map<unknown>;
          if (m && typeof m.get === "function" && m.get("frameId") === id) {
            allIds.add(key);
          }
        });
      }
    }

    const selectedElements = elements.filter((el) => allIds.has(el.id));
    if (selectedElements.length === 0) return;

    // Serialize elements to JSON
    const clipboardData = {
      collabboard: true,
      elements: selectedElements.map(serializeElement),
    };

    // Write to clipboard
    navigator.clipboard.writeText(JSON.stringify(clipboardData)).catch((err) => {
      console.error("Failed to copy to clipboard:", err);
    });
  }, [elements]);

  const pasteElements = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    
    // Read from clipboard
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      
      try {
        const data = JSON.parse(text);
        
        // If it's our format, paste elements
        if (data.collabboard && Array.isArray(data.elements)) {
          const elementsMap = doc.getMap("elements");
          const newIds: string[] = [];
          
          // Calculate bounding box of copied elements
          const bbox = getBoundingBox(data.elements as BoardElement[]);
          if (!bbox) return;
          
          // Calculate offset to center of viewport
          const surface = surfaceRef.current;
          if (!surface) return;
          const rect = surface.getBoundingClientRect();
          const viewportCenterX = (rect.width / 2 - camera.x) / camera.scale;
          const viewportCenterY = (rect.height / 2 - camera.y) / camera.scale;
          const bboxCenterX = bbox.x + bbox.width / 2;
          const bboxCenterY = bbox.y + bbox.height / 2;
          const offset = {
            x: viewportCenterX - bboxCenterX,
            y: viewportCenterY - bboxCenterY,
          };
          
          // Build old->new ID map for frameId remapping
          const pasteIdMap = new Map<string, string>();
          for (const elementData of data.elements) {
            if (elementData.id) {
              pasteIdMap.set(elementData.id as string, generateId());
            }
          }

          doc.transact(() => {
            for (const elementData of data.elements) {
              const oldId = elementData.id as string | undefined;
              const newId = (oldId && pasteIdMap.get(oldId)) || generateId();
              const elementMap = deserializeElement(elementData, newId, offset);
              // Remap frameId so pasted children point to the pasted frame
              const oldFrameId = elementMap.get("frameId") as string | undefined;
              if (oldFrameId && pasteIdMap.has(oldFrameId)) {
                elementMap.set("frameId", pasteIdMap.get(oldFrameId)!);
              } else if (oldFrameId) {
                elementMap.set("frameId", null);
              }
              elementsMap.set(newId, elementMap);
              newIds.push(newId);
            }
          });
          
          // Select the pasted elements
          setSelectedElementIds(new Set(newIds));
        } else {
          // If it's plain text, create a sticky note with that text
          const viewportCenterX = (surfaceRef.current!.clientWidth / 2 - camera.x) / camera.scale;
          const viewportCenterY = (surfaceRef.current!.clientHeight / 2 - camera.y) / camera.scale;
          createStickyNote(viewportCenterX, viewportCenterY);
          
          // Set the text content
          setTimeout(() => {
            const ids = useCanvasStore.getState().selectedElementIds;
            if (ids.size === 1) {
              const [newId] = ids;
              const elementsMap = doc.getMap("elements");
              const elementMap = elementsMap.get(newId) as Y.Map<unknown> | undefined;
              if (elementMap) {
                const sanitizedText = stripHtmlTags(text).slice(0, 5000);
                elementMap.set("text", sanitizedText);
              }
            }
          }, 0);
        }
      } catch {
        // Ignore invalid JSON
      }
    }).catch((err) => {
      console.error("Failed to read from clipboard:", err);
    });
  }, [camera, elements, setSelectedElementIds, createStickyNote]);

  const updateElementProperty = useCallback((id: string, key: string, value: unknown) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set(key, value);
    });
  }, []);

  const startEditing = useCallback(
    (id: string) => {
      const el = elements.find((e) => e.id === id);
      if (!el) return;
      if (el.type === "sticky-note") {
        setEditingElementId(id);
        setEditText(el.text);
      } else if (el.type === "text") {
        setEditingElementId(id);
        setEditText(el.text);
      } else if (el.type === "frame") {
        setEditingElementId(id);
        setEditText(el.title);
      }
    },
    [elements]
  );

  const applyEditingTextToYjs = useCallback(
    (nextText: string) => {
      if (!editingElementId) return;
      const doc = docRef.current;
      if (!doc) return;

      const elementsMap = doc.getMap("elements");
      const elementMap = elementsMap.get(editingElementId) as Y.Map<unknown> | undefined;
      if (!elementMap) return;

      const elType = elementMap.get("type") as string | undefined;
      const sanitizedText = stripHtmlTags(nextText).slice(0, 5000);
      const key =
        elType === "connector" && editingConnectorLabel
          ? "labelText"
          : elType === "frame"
            ? "title"
            : "text";
      const value = key === "title" ? sanitizedText.slice(0, 200) : sanitizedText;
      const prevValue = (elementMap.get(key) as string | undefined) ?? "";
      if (prevValue === value) return;

      doc.transact(() => {
        elementMap.set(key, value);
      });
    },
    [editingElementId, editingConnectorLabel]
  );

  const handleEditTextChange = useCallback(
    (nextText: string) => {
      setEditText(nextText);
      pendingLiveEditTextRef.current = nextText;
      if (liveEditRafRef.current !== null) return;
      liveEditRafRef.current = requestAnimationFrame(() => {
        liveEditRafRef.current = null;
        const pendingText = pendingLiveEditTextRef.current;
        pendingLiveEditTextRef.current = null;
        if (pendingText !== null) {
          applyEditingTextToYjs(pendingText);
        }
      });
    },
    [applyEditingTextToYjs]
  );

  const commitEdit = useCallback(() => {
    if (!editingElementId) return;
    if (liveEditRafRef.current !== null) {
      cancelAnimationFrame(liveEditRafRef.current);
      liveEditRafRef.current = null;
      pendingLiveEditTextRef.current = null;
    }
    applyEditingTextToYjs(editText);
    setEditingElementId(null);
    setEditingConnectorLabel(false);
    setEditText("");
  }, [editingElementId, editText, applyEditingTextToYjs]);

  useEffect(() => {
    if (editingElementId) return;
    if (liveEditRafRef.current !== null) {
      cancelAnimationFrame(liveEditRafRef.current);
      liveEditRafRef.current = null;
    }
    pendingLiveEditTextRef.current = null;
  }, [editingElementId]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (editingElementId && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editingElementId]);

  // Keyboard shortcuts via TanStack Hotkeys
  // Tool shortcuts (single keys) -- won't fire when Mod/Ctrl is held
  useHotkey("V", () => setActiveTool("pointer"), { enabled: !editingElementId });
  useHotkey("S", () => setActiveTool("sticky-note"), { enabled: !editingElementId });
  useHotkey("R", () => setActiveTool("rectangle"), { enabled: !editingElementId });
  useHotkey("C", () => setActiveTool("circle"), { enabled: !editingElementId });
  useHotkey("L", () => setActiveTool("line"), { enabled: !editingElementId });
  useHotkey("T", () => setActiveTool("text"), { enabled: !editingElementId });
  useHotkey("F", () => setActiveTool("frame"), { enabled: !editingElementId });
  useHotkey("X", () => setActiveTool("connector"), { enabled: !editingElementId });

  // Modifier combos
  useHotkey("Mod+C", () => {
    if (useCanvasStore.getState().selectedElementIds.size > 0) {
      copySelectedElements();
    }
  });
  useHotkey("Mod+V", () => {
    pasteElements();
  });
  useHotkey("Mod+D", () => {
    if (useCanvasStore.getState().selectedElementIds.size > 0) {
      duplicateSelectedElements();
    }
  });

  // Escape: commit edit if editing, otherwise clear selection and reset tool
  useHotkey("Escape", () => {
    if (editingElementId) {
      commitEdit();
    } else {
      clearSelection();
      setActiveTool("pointer");
    }
  }, { ignoreInputs: false });

  // Delete/Backspace: delete selected elements
  useHotkey("Delete", () => {
    if (useCanvasStore.getState().selectedElementIds.size > 0) {
      deleteSelectedElements();
    }
  }, { enabled: !editingElementId });
  useHotkey("Backspace", () => {
    if (useCanvasStore.getState().selectedElementIds.size > 0) {
      deleteSelectedElements();
    }
  }, { enabled: !editingElementId });

  // Spacebar pan (needs keydown + keyup tracking, kept as manual useEffect)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !editingElementId) {
        e.preventDefault();
        isSpacebarPressedRef.current = true;
        setIsSpacebarPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        isSpacebarPressedRef.current = false;
        setIsSpacebarPressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [editingElementId]);

  const isSessionReady = !isPending && !!session?.user && !!currentUser;

  const isPointerMode = activeTool === "pointer";

  const toWorld = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = surfaceRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (event.clientX - rect.left - cam.x) / cam.scale,
      y: (event.clientY - rect.top - cam.y) / cam.scale
    };
  };

  // --- Overlay pointer handlers (used for creation tools and non-pointer modes) ---
  const onOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    if (event.button === 1 || isSpacebarPressedRef.current) {
      setIsPanning(true);
      const cam = cameraRef.current;
      panStartRef.current = { x: event.clientX - cam.x, y: event.clientY - cam.y };
      return;
    }

    if (activeTool === "sticky-note") {
      const world = toWorld(event);
      createStickyNote(world.x, world.y);
      return;
    }

    if (activeTool === "text") {
      const world = toWorld(event);
      createTextElement(world.x, world.y);
      return;
    }

    if (activeTool === "rectangle") {
      const world = toWorld(event);
      const id = createRectangleDraft(world.x, world.y);
      if (id) {
        drawingShapeRef.current = { id, tool: "rectangle", start: world };
        setIsDrawing(true);
      }
      return;
    }

    if (activeTool === "circle") {
      const world = toWorld(event);
      const id = createCircleDraft(world.x, world.y);
      if (id) {
        drawingShapeRef.current = { id, tool: "circle", start: world };
        setIsDrawing(true);
      }
      return;
    }

    if (activeTool === "line") {
      const world = toWorld(event);
      const id = createLineDraft(world.x, world.y);
      if (id) {
        drawingShapeRef.current = { id, tool: "line", start: world };
        setIsDrawing(true);
      }
      return;
    }

    if (activeTool === "frame") {
      const world = toWorld(event);
      const id = createFrameDraft(world.x, world.y);
      if (id) {
        drawingShapeRef.current = { id, tool: "frame", start: world };
        setIsDrawing(true);
      }
      return;
    }

    if (activeTool === "connector") {
      const world = toWorld(event);
      // Snap start point to nearest shape anchor
      const excludeIds = new Set<string>();
      const snap = findSnapTarget(world, elements, excludeIds);
      const startPt = snap ? snap.anchor : world;
      const id = createConnectorDraft(startPt.x, startPt.y);
      if (id) {
        // If snapped, set the fromId and fromAnchor
        if (snap) {
          const doc = docRef.current;
          if (doc) {
            const elementsMap = doc.getMap("elements");
            const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
            if (elementMap) {
              doc.transact(() => {
                elementMap.set("fromId", snap.element.id);
                elementMap.set("fromAnchor", snap.anchorIndex);
                elementMap.set("fromX", snap.anchor.x);
                elementMap.set("fromY", snap.anchor.y);
              });
            }
          }
        }
        drawingShapeRef.current = { id, tool: "connector", start: startPt };
        setIsDrawing(true);
      }
      return;
    }

    connectionRef.current?.setCursor(toWorld(event));
  };

  const onOverlayPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    if (isPanning && panStartRef.current) {
      const panStart = panStartRef.current;
      const cam = cameraRef.current;
      applyCameraDirect({
        ...cam,
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y
      });
      return;
    }
    // Show snap anchors when hovering with connector tool (not drawing yet)
    if (activeTool === "connector" && !drawingShapeRef.current) {
      const world = toWorld(event);
      const excludeIds = new Set<string>();
      const nearby = findNearbyAnchors(world, elements, excludeIds);
      setConnectorSnapAnchors(nearby.flatMap((n) => n.anchors));
      const snapTarget = findSnapTarget(world, elements, excludeIds);
      setConnectorSnapTarget(snapTarget ? snapTarget.anchor : null);
    }

    if (drawingShapeRef.current) {
      const world = toWorld(event);
      const { id, tool, start } = drawingShapeRef.current;
      if (tool === "connector") {
        moveConnectorEndpoint(id, "to", world.x, world.y);
        // Show snap preview on target shapes during drag
        const excludeIds = new Set([id]);
        const nearby = findNearbyAnchors(world, elements, excludeIds);
        setConnectorSnapAnchors(nearby.flatMap((n) => n.anchors));
        const snapTarget = findSnapTarget(world, elements, excludeIds);
        setConnectorSnapTarget(snapTarget ? snapTarget.anchor : null);
      } else if (tool === "line") {
        const doc = docRef.current;
        if (doc) {
          const elementsMap = doc.getMap("elements");
          const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
          if (elementMap) {
            const minX = Math.min(start.x, world.x);
            const minY = Math.min(start.y, world.y);
            const maxX = Math.max(start.x, world.x);
            const maxY = Math.max(start.y, world.y);
            doc.transact(() => {
              elementMap.set("x", minX);
              elementMap.set("y", minY);
              elementMap.set("width", maxX - minX);
              elementMap.set("height", maxY - minY);
              elementMap.set("points", [
                start.x - minX, start.y - minY,
                world.x - minX, world.y - minY,
              ]);
            });
          }
        }
      } else {
        const box = createBoxFromDrag(start, world);
        resizeElement(id, box);
      }
      return;
    }
    connectionRef.current?.setCursor(toWorld(event));
  };

  const onOverlayPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawingShapeRef.current) {
      const { id, tool } = drawingShapeRef.current;
      if (tool === "connector") {
        const world = toWorld(event);
        finalizeConnectorEndpoint(id, "to", world.x, world.y);
        // Re-finalize "from" in case it wasn't snapped during creation
        finalizeConnectorEndpoint(id, "from", drawingShapeRef.current.start.x, drawingShapeRef.current.start.y);
      } else if (tool !== "frame") {
        // Assign frameId based on the drawn shape's final center position
        const doc = docRef.current;
        if (doc) {
          const elementsMap = doc.getMap("elements");
          const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
          if (elementMap) {
            const ex = (elementMap.get("x") as number) ?? 0;
            const ey = (elementMap.get("y") as number) ?? 0;
            const ew = (elementMap.get("width") as number) ?? 0;
            const eh = (elementMap.get("height") as number) ?? 0;
            assignFrameIdToElement(elementMap, ex + ew / 2, ey + eh / 2);
          }
        }
      }
      drawingShapeRef.current = null;
      setIsDrawing(false);
      setActiveTool("pointer");
      setConnectorSnapAnchors([]);
      setConnectorSnapTarget(null);
    }
    if (isPanning) {
      setCameraState(cameraRef.current);
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const onOverlayPointerLeave = () => {
    if (drawingShapeRef.current) {
      drawingShapeRef.current = null;
      setIsDrawing(false);
      setActiveTool("pointer");
    }
    setConnectorSnapAnchors([]);
    setConnectorSnapTarget(null);
    connectionRef.current?.setCursor(null);
  };

  // --- Section-level handlers (always active, for wheel zoom and space-pan in pointer mode) ---
  const onSectionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isPointerMode && (event.button === 1 || isSpacebarPressedRef.current)) {
      setIsPanning(true);
      const cam = cameraRef.current;
      panStartRef.current = { x: event.clientX - cam.x, y: event.clientY - cam.y };
      marqueeStartRef.current = null;
      setMarqueeRect(null);
    }
  };

  const onSectionPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    if (isPanning && panStartRef.current) {
      const panStart = panStartRef.current;
      const cam = cameraRef.current;
      applyCameraDirect({
        ...cam,
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y
      });
    }
  };

  const onSectionPointerUp = () => {
    if (isPanning) {
      setCameraState(cameraRef.current);
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    event.preventDefault();

    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const cam = cameraRef.current;
    const nextScale = clamp(
      cam.scale * (event.deltaY > 0 ? 0.9 : 1.1),
      MIN_SCALE,
      MAX_SCALE
    );

    const worldX = (mouseX - cam.x) / cam.scale;
    const worldY = (mouseY - cam.y) / cam.scale;
    const newX = mouseX - worldX * nextScale;
    const newY = mouseY - worldY * nextScale;

    const newCam = { x: newX, y: newY, scale: nextScale };
    applyCameraDirect(newCam);
    setCameraState(newCam);
  };

  // Compute editing element position for text overlay
  const singleSelectedId = useMemo(
    () => (selectedElementIds.size === 1 ? [...selectedElementIds][0] : null),
    [selectedElementIds]
  );

  const selectedElement = useMemo(() => {
    if (!singleSelectedId) return null;
    return elements.find((e) => e.id === singleSelectedId) ?? null;
  }, [singleSelectedId, elements]);

  const editingElement = useMemo(() => {
    if (!editingElementId) return null;
    return elements.find((e) => e.id === editingElementId) ?? null;
  }, [editingElementId, elements]);

  // Compute connector label midpoint for overlay
  const connectorLabelMidpoint = editingElement?.type === "connector" && editingConnectorLabel
    ? (() => {
        const conn = editingElement as import("@collab/shared/collab").ConnectorElement;
        const { from, to } = resolveEndpoints(conn, elements);
        const pathPoints = computePath(from, to, conn.routingStyle, conn.elbowMidpoint, conn.fromAnchor, conn.toAnchor);
        return getPathMidpoint(pathPoints);
      })()
    : null;

  const editOverlayStyle = editingElement
    ? editingElement.type === "connector" && editingConnectorLabel && connectorLabelMidpoint
      ? {
          left: connectorLabelMidpoint.x * camera.scale + camera.x,
          top: connectorLabelMidpoint.y * camera.scale + camera.y,
          transform: `scale(${camera.scale}) translate(-50%, -50%)`,
          transformOrigin: "center center" as const,
        }
      : editingElement.type === "frame"
        ? {
            left: editingElement.x * camera.scale + camera.x,
            top: editingElement.y * camera.scale + camera.y - 23 * camera.scale,
            transform: `scale(${camera.scale})`,
            transformOrigin: "top left" as const,
          }
        : {
            left: editingElement.x * camera.scale + camera.x,
            top: editingElement.y * camera.scale + camera.y,
            width: editingElement.width,
            height: editingElement.height,
            transform: `scale(${camera.scale})`,
            transformOrigin: "top left" as const,
          }
    : null;

  const handleSelectedElementPropertyChange = useCallback(
    (key: string, value: unknown) => {
      if (!selectedElement) return;
      updateElementProperty(selectedElement.id, key, value);
    },
    [selectedElement, updateElementProperty]
  );

  const handleStartEditingConnectorLabel = useCallback(() => {
    if (!selectedElement || selectedElement.type !== "connector") return;
    updateElementProperty(selectedElement.id, "labelText", " ");
    setEditingConnectorLabel(true);
    setEditingElementId(selectedElement.id);
    setEditText("");
  }, [selectedElement, updateElementProperty]);

  const handleToolChange = useCallback((tool: ActiveTool) => {
    setActiveTool(tool);
    if (tool !== "connector") {
      setConnectorSnapAnchors([]);
      setConnectorSnapTarget(null);
    }
  }, []);

  if (!isSessionReady) {
    return <main className="min-h-screen grid place-content-center">Loading session...</main>;
  }

  return (
    <main className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <header className="px-4 py-2.5 border-b border-[#2a2a2a] bg-[#1a1a1a] flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-[#60a5fa] hover:text-[#93bbfc] text-sm transition-colors"
          >
            <ArrowLeft className="size-4" />
            Boards
          </Link>
          <span className="text-[#555]">|</span>
          <strong className="text-sm">{boardName || roomId}</strong>
          {connectionState === "reconnecting" ? (
            <span className="text-[#fbbf24] text-xs">reconnecting...</span>
          ) : connectionState === "disconnected" ? (
            <span className="text-[#ff9da0] text-xs">disconnected</span>
          ) : null}
        </div>
        <div className="flex">
          {onlineUsers.map((user, index) => (
            <Tooltip key={user.id}>
              <TooltipTrigger asChild>
                <Avatar
                  size="sm"
                  className="border-2 border-[#1a1a1a] cursor-default"
                  style={{ zIndex: onlineUsers.length - index }}
                >
                  <AvatarFallback
                    className="text-[10px] font-medium text-white"
                    style={{ backgroundColor: user.color }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {user.name}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </header>

      <section
        ref={surfaceRef}
        className="relative overflow-hidden bg-[#121212] touch-none"
        style={{ cursor: rotationCursor ? "none" : isPanning ? "grabbing" : isSpacebarPressed ? "grab" : undefined }}
        onPointerDown={onSectionPointerDown}
        onPointerMove={onSectionPointerMove}
        onPointerUp={onSectionPointerUp}
        onWheel={onWheel}
      >
        {/* Dot grid background */}
        <div
          ref={dotGridRef}
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.1)_1px,transparent_1px)]"
          style={{
            backgroundPosition: `${camera.x}px ${camera.y}px`,
            backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`,
          }}
        />

        {/* Konva canvas for board elements */}
        <BoardCanvas
          camera={camera}
          syntheticObjectCount={syntheticObjectCount}
          elements={elements}
          activeTool={activeTool}
          getFrameChildIdsFn={getFrameChildIdsFromYjs}
          onStageRef={handleStageRef}
          onSelectElement={selectElement}
          onDragElementStart={() => setIsDraggingElement(true)}
          onDragElementMove={onDragElementMove}
          onDragElement={(...args) => { setIsDraggingElement(false); moveElement(...args); }}
          onDragSelectedElements={(...args) => { setIsDraggingElement(false); moveSelectedElements(...args); }}
          onResizeElement={resizeElement}
          onRotateElement={rotateElement}
          onRotateCursorChange={setRotationCursor}
          onDblClickElement={startEditing}
          editingElementId={editingElementId}
          editingConnectorLabel={editingConnectorLabel}
          onLineEndpointDrag={moveLineEndpoint}
          onLineEndpointDragEnd={moveLineEndpoint}
          onConnectorEndpointDrag={(id, endpoint, wx, wy) => {
            moveConnectorEndpoint(id, endpoint, wx, wy);
            const excludeIds = new Set([id]);
            const nearby = findNearbyAnchors({ x: wx, y: wy }, elements, excludeIds);
            setConnectorSnapAnchors(nearby.flatMap((n) => n.anchors));
            const snap = findSnapTarget({ x: wx, y: wy }, elements, excludeIds);
            setConnectorSnapTarget(snap ? snap.anchor : null);
          }}
          onConnectorEndpointDragEnd={(id, endpoint, wx, wy) => {
            finalizeConnectorEndpoint(id, endpoint, wx, wy);
            setConnectorSnapAnchors([]);
            setConnectorSnapTarget(null);
          }}
          onConnectorMidpointDrag={moveConnectorMidpoint}
          onConnectorMidpointDragEnd={moveConnectorMidpoint}
          onConnectorLabelClick={(id) => {
            const el = elements.find((e) => e.id === id);
            if (el?.type === "connector") {
              setEditingElementId(id);
              setEditingConnectorLabel(true);
              setEditText(el.labelText.trim());
            }
          }}
          onStagePointerDown={(worldX, worldY) => {
            if (isSpacebarPressedRef.current) return;
            clearSelection();
            marqueeStartRef.current = { x: worldX, y: worldY };
          }}
          onStagePointerMove={(worldX, worldY) => {
            connectionRef.current?.setCursor({ x: worldX, y: worldY });
            if (marqueeStartRef.current) {
              const start = marqueeStartRef.current;
              setMarqueeRect({
                x: Math.min(start.x, worldX),
                y: Math.min(start.y, worldY),
                width: Math.abs(worldX - start.x),
                height: Math.abs(worldY - start.y),
              });
            }
          }}
          onStagePointerUp={() => {
            if (marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2) {
              const ids = elements
                .filter((el) => {
                  return (
                    el.x < marqueeRect.x + marqueeRect.width &&
                    el.x + el.width > marqueeRect.x &&
                    el.y < marqueeRect.y + marqueeRect.height &&
                    el.y + el.height > marqueeRect.y
                  );
                })
                .map((el) => el.id);
              if (ids.length > 0) {
                setSelectedElementIds(new Set(ids));
              }
            }
            marqueeStartRef.current = null;
            setMarqueeRect(null);
          }}
          marqueeRect={marqueeRect}
          connectorSnapAnchors={connectorSnapAnchors}
          connectorSnapTarget={connectorSnapTarget}
        />

        {/* Remote cursor overlay */}
        <RemoteCursorOverlay remoteCursors={remoteCursors} camera={camera} />

        {/* Selection toolbar - floating above selected element */}
        {selectedElement && (!editingElementId || editingConnectorLabel) && !isDraggingElement && (
          <SelectionToolbar
            element={selectedElement}
            onPropertyChange={handleSelectedElementPropertyChange}
            camera={camera}
            editingConnectorLabel={editingConnectorLabel}
            onStartEditingConnectorLabel={
              selectedElement.type === "connector" ? handleStartEditingConnectorLabel : undefined
            }
          />
        )}

        {/* Text editing overlay */}
        {editingElement && editOverlayStyle && (
          <div
            className="absolute z-30"
            style={editOverlayStyle}
          >
            {editingElement.type === "connector" && editingConnectorLabel ? (
              <input
                ref={textareaRef as unknown as React.RefObject<HTMLInputElement>}
                type="text"
                value={editText}
                onChange={(e) => handleEditTextChange(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Enter") {
                    commitEdit();
                  }
                  e.stopPropagation();
                }}
                size={Math.max(1, editText.length)}
                className="ring-1 ring-[#60a5fa] rounded bg-[#1a1a1a]/90 outline-none text-center"
                style={{
                  display: "block",
                  fontFamily: editingElement.labelFontFamily,
                  fontSize: editingElement.labelFontSize,
                  fontWeight: editingElement.labelBold ? "bold" : "normal",
                  textDecoration: editingElement.labelStrikethrough ? "line-through" : "none",
                  color: editingElement.labelFill,
                  padding: "2px 8px",
                  minWidth: 60,
                  width: `${Math.max(60, editText.length * editingElement.labelFontSize * 0.6 + 20)}px`,
                }}
              />
            ) : editingElement.type === "frame" ? (
              <input
                ref={textareaRef as unknown as React.RefObject<HTMLInputElement>}
                type="text"
                value={editText}
                onChange={(e) => handleEditTextChange(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Enter") {
                    commitEdit();
                  }
                  e.stopPropagation();
                }}
                size={Math.max(1, editText.length)}
                className="ring-1 ring-[#60a5fa] rounded bg-white outline-none"
                style={{
                  display: "block",
                  fontFamily: "system-ui, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: "19px",
                  height: 19,
                  padding: "0 8px",
                  color: "#525252",
                  minWidth: 40,
                  width: `${Math.max(40, editText.length * 8 + 20)}px`,
                }}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => handleEditTextChange(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    commitEdit();
                  }
                  e.stopPropagation();
                }}
                className="w-full h-full resize-none border-none ring-2 ring-[#60a5fa] rounded bg-transparent outline-none"
                style={{
                  fontFamily: (editingElement.type === "sticky-note" || editingElement.type === "text") ? editingElement.fontFamily : "system-ui, sans-serif",
                  fontSize: (editingElement.type === "sticky-note" || editingElement.type === "text") ? editingElement.fontSize : 14,
                  lineHeight: 1,
                  padding: editingElement.type === "text" ? 0 : 12,
                  background: editingElement.type === "sticky-note" ? editingElement.color : "transparent",
                  color: editingElement.type === "text" ? editingElement.fill : "#1a1a1a",
                }}
              />
            )}
          </div>
        )}

        {/* Interaction overlay - captures pointer events for pan/zoom and creation tools.
            In pointer mode, this overlay is pointer-events-none so Konva can handle
            element drag/click. Pan via shift+drag works through the overlay in non-pointer modes. */}
        <div
          className={`absolute inset-0 z-20 ${
            isPointerMode && !isPanning ? "pointer-events-none" : "cursor-crosshair"
          }`}
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onOverlayPointerMove}
          onPointerUp={onOverlayPointerUp}
          onPointerLeave={onOverlayPointerLeave}
        />

        {/* Toolbar */}
        <Toolbar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onDelete={deleteSelectedElements}
          onDuplicate={duplicateSelectedElements}
          hasSelection={selectedElementIds.size > 0}
        />

        {/* Custom rotation cursor */}
        {rotationCursor && (
          <RotationCursor
            pointerRef={pointerPositionRef}
            corner={rotationCursor.corner}
            elementRotation={rotationCursor.elementRotation}
          />
        )}

        {/* Debug metrics overlay (dev only) */}
        {process.env.NODE_ENV === "development" && (
          <DebugMetrics
            camera={camera}
            elements={elements}
            activeTool={activeTool}
            isPanning={isPanning}
            isDraggingElement={isDraggingElement}
            isDrawing={isDrawing}
            editingElementId={editingElementId}
            pointerPositionRef={pointerPositionRef}
            surfaceRef={surfaceRef}
            stageRef={konvaStageRef}
          />
        )}
      </section>

      <footer className="px-4 py-2.5 border-t border-[#2a2a2a] bg-[#1a1a1a] text-[#999] text-sm">
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">V</kbd> Select
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">S</kbd> Sticky
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">R</kbd> Rect
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">C</kbd> Circle
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">L</kbd> Line
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">T</kbd> Text
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">F</kbd> Frame
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">X</kbd> Connector
        <span className="mx-1.5 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">Space</kbd> Pan
        <span className="mx-1.5 text-[#555]">·</span>
        Scroll to zoom
      </footer>
    </main>
  );
}
