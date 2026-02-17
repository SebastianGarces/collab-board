"use client";

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import * as Y from "yjs";

import type { PresenceState } from "@collab/shared/collab";
import {
  DEFAULT_STICKY_NOTE_SIZE,
  STICKY_NOTE_COLORS,
} from "@collab/shared/collab";
import { authClient } from "@/lib/auth-client";
import { type Camera, createCollabConnection } from "@/lib/collab";
import { createPerfProbeCollector } from "@/lib/perf-probe";
import { useYjsElements } from "@/hooks/use-yjs-elements";
import { Toolbar, type ActiveTool } from "@/components/board/toolbar";
import {
  createBoxFromDrag,
  MIN_ELEMENT_SIZE,
  type ElementBox,
} from "@/components/canvas/shape-transform";

const BoardCanvas = dynamic(
  () => import("@/components/canvas/board-canvas").then((m) => m.BoardCanvas),
  { ssr: false }
);

type RemoteCursor = {
  clientId: number;
  user: PresenceState["user"];
  cursor: { x: number; y: number };
};

type DrawingRectangleState = {
  id: string;
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

export default function CanvasPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacebarPressed, setIsSpacebarPressed] = useState(false);
  const [syntheticObjectCount, setSyntheticObjectCount] = useState(0);
  const [activeTool, setActiveTool] = useState<ActiveTool>("pointer");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSpacebarPressedRef = useRef(false);
  const connectionRef = useRef<ReturnType<typeof createCollabConnection> | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [yjsDoc, setYjsDoc] = useState<Y.Doc | null>(null);
  const perfCollectorRef = useRef(createPerfProbeCollector());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingRectangleRef = useRef<DrawingRectangleState | null>(null);

  const perfEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PERF_PROBES === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development";

  const currentUser = useMemo(() => {
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name ?? session.user.email ?? "Anonymous",
      color: colorFromId(session.user.id)
    };
  }, [session?.user]);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!currentUser) return;

    const connection = createCollabConnection({
      roomId,
      user: currentUser,
      onStatesChange(states, localClientId) {
        const cursors: RemoteCursor[] = [];
        states.forEach((state, clientId) => {
          if (clientId === localClientId) return;
          if (!state?.user || !state.cursor) return;
          cursors.push({ clientId, cursor: state.cursor, user: state.user });
        });
        setRemoteCursors(cursors);
        setPeerCount(states.size);
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
      setSyntheticObjectCount: (count: number) => void;
      runPanZoomScript: (durationMs?: number) => Promise<void>;
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
      setSyntheticObjectCount: (count: number) => {
        setSyntheticObjectCount(Math.max(0, Math.floor(count)));
      },
      runPanZoomScript: async (durationMs = 5000) => {
        const started = performance.now();
        while (performance.now() - started < durationMs) {
          const elapsed = performance.now() - started;
          const scale = clamp(1 + Math.sin(elapsed / 300) * 0.3, MIN_SCALE, MAX_SCALE);
          setCamera({
            x: Math.sin(elapsed / 500) * 80,
            y: Math.cos(elapsed / 400) * 60,
            scale
          });
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 16);
          });
        }
      }
    };

    (window as unknown as { __collabPerf?: PerfTestApi }).__collabPerf = api;
    return () => {
      delete (window as unknown as { __collabPerf?: PerfTestApi }).__collabPerf;
    };
  }, [perfEnabled]);

  // --- Element operations ---

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

      elementsMap.set(id, elementMap);
      setSelectedElementId(id);
      setActiveTool("pointer");
    },
    []
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
      elementMap.set("stroke", "#1e40af");

      elementsMap.set(id, elementMap);
      setSelectedElementId(id);
      return id;
    },
    []
  );

  const moveElement = useCallback((id: string, x: number, y: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set("x", x);
      elementMap.set("y", y);
    });
  }, []);

  const resizeElement = useCallback((id: string, box: ElementBox) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const elementMap = elementsMap.get(id) as Y.Map<unknown> | undefined;
    if (!elementMap) return;
    doc.transact(() => {
      elementMap.set("x", box.x);
      elementMap.set("y", box.y);
      elementMap.set("width", box.width);
      elementMap.set("height", box.height);
    });
  }, []);

  const deleteElement = useCallback((id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    elementsMap.delete(id);
    setSelectedElementId(null);
  }, []);

  const startEditing = useCallback(
    (id: string) => {
      const el = elements.find((e) => e.id === id);
      if (!el || el.type !== "sticky-note") return;
      setEditingElementId(id);
      setEditText(el.text);
    },
    [elements]
  );

  const commitEdit = useCallback(() => {
    if (!editingElementId) return;
    const doc = docRef.current;
    if (!doc) return;
    const elementsMap = doc.getMap("elements");
    const elementMap = elementsMap.get(editingElementId) as Y.Map<unknown> | undefined;
    if (elementMap) {
      elementMap.set("text", editText);
    }
    setEditingElementId(null);
    setEditText("");
  }, [editingElementId, editText]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (editingElementId && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editingElementId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle spacebar for panning
      if (e.key === " ") {
        if (!editingElementId) {
          e.preventDefault();
          isSpacebarPressedRef.current = true;
          setIsSpacebarPressed(true);
        }
        return;
      }
      
      if (editingElementId) {
        if (e.key === "Escape") {
          commitEdit();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementId) {
          e.preventDefault();
          deleteElement(selectedElementId);
        }
      }
      if (e.key === "Escape") {
        setSelectedElementId(null);
        setActiveTool("pointer");
      }
      if (e.key === "v" || e.key === "V") {
        setActiveTool("pointer");
      }
      if (e.key === "s" || e.key === "S") {
        setActiveTool("sticky-note");
      }
      if (e.key === "r" || e.key === "R") {
        setActiveTool("rectangle");
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
  }, [selectedElementId, editingElementId, deleteElement, commitEdit]);

  if (isPending || !session?.user || !currentUser) {
    return <main className="min-h-screen grid place-content-center">Loading session...</main>;
  }

  const isPointerMode = activeTool === "pointer";

  const toWorld = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = surfaceRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - camera.x) / camera.scale,
      y: (event.clientY - rect.top - camera.y) / camera.scale
    };
  };

  // --- Overlay pointer handlers (used for creation tools and non-pointer modes) ---
  const onOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    if (event.button === 1 || isSpacebarPressedRef.current) {
      setIsPanning(true);
      panStartRef.current = { x: event.clientX - camera.x, y: event.clientY - camera.y };
      return;
    }

    if (activeTool === "sticky-note") {
      const world = toWorld(event);
      createStickyNote(world.x, world.y);
      return;
    }

    if (activeTool === "rectangle") {
      const world = toWorld(event);
      const id = createRectangleDraft(world.x, world.y);
      if (id) {
        drawingRectangleRef.current = { id, start: world };
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
      setCamera((prev) => ({
        ...prev,
        x: event.clientX - panStartRef.current!.x,
        y: event.clientY - panStartRef.current!.y
      }));
      return;
    }
    if (drawingRectangleRef.current) {
      const world = toWorld(event);
      const { id, start } = drawingRectangleRef.current;
      const box = createBoxFromDrag(start, world);
      resizeElement(id, box);
      return;
    }
    connectionRef.current?.setCursor(toWorld(event));
  };

  const onOverlayPointerUp = () => {
    if (drawingRectangleRef.current) {
      drawingRectangleRef.current = null;
      setActiveTool("pointer");
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const onOverlayPointerLeave = () => {
    if (drawingRectangleRef.current) {
      drawingRectangleRef.current = null;
      setActiveTool("pointer");
    }
    connectionRef.current?.setCursor(null);
  };

  // --- Section-level handlers (always active, for wheel zoom and space-pan in pointer mode) ---
  const onSectionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isPointerMode && (event.button === 1 || isSpacebarPressedRef.current)) {
      setIsPanning(true);
      panStartRef.current = { x: event.clientX - camera.x, y: event.clientY - camera.y };
    }
  };

  const onSectionPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (perfEnabled) {
      perfCollectorRef.current.markInput();
    }
    if (isPanning && panStartRef.current) {
      setCamera((prev) => ({
        ...prev,
        x: event.clientX - panStartRef.current!.x,
        y: event.clientY - panStartRef.current!.y
      }));
    }
  };

  const onSectionPointerUp = () => {
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

    const nextScale = clamp(
      camera.scale * (event.deltaY > 0 ? 0.9 : 1.1),
      MIN_SCALE,
      MAX_SCALE
    );

    // Keep the world point under the cursor fixed
    const worldX = (mouseX - camera.x) / camera.scale;
    const worldY = (mouseY - camera.y) / camera.scale;
    const newX = mouseX - worldX * nextScale;
    const newY = mouseY - worldY * nextScale;

    setCamera({ x: newX, y: newY, scale: nextScale });
  };

  const signOut = async () => {
    await authClient.signOut();
  };

  // Compute editing element position for text overlay
  const editingElement = editingElementId
    ? elements.find((e) => e.id === editingElementId)
    : null;
  const editOverlayStyle = editingElement
    ? {
        left: editingElement.x * camera.scale + camera.x,
        top: editingElement.y * camera.scale + camera.y,
        width: editingElement.width,
        height: editingElement.height,
        transform: `scale(${camera.scale})`,
        transformOrigin: "top left" as const,
      }
    : null;

  return (
    <main className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <header className="px-4 py-3 border-b border-[#2a2a2a] bg-[#1a1a1a] flex justify-between items-center gap-4">
        <div>
          <strong>{roomId}</strong>
          <span className="mx-2 text-[#888]">·</span>
          {currentUser.name}
          {peerCount > 1 ? (
            <>
              <span className="mx-2 text-[#888]">·</span>
              <span className="text-[#7ee8a2]">{peerCount} online</span>
            </>
          ) : null}
          {connectionState === "disconnected" ? (
            <>
              <span className="mx-2 text-[#888]">·</span>
              <span className="text-[#ff9da0]">disconnected</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="border border-[#3a3a3a] rounded-lg px-2.5 py-1.5 bg-[#242424] text-inherit cursor-pointer"
        >
          Sign out
        </button>
      </header>

      <section
        ref={surfaceRef}
        className="relative overflow-hidden bg-[#121212] touch-none"
        style={{ cursor: isPanning ? "grabbing" : isSpacebarPressed ? "grab" : undefined }}
        onPointerDown={onSectionPointerDown}
        onPointerMove={onSectionPointerMove}
        onPointerUp={onSectionPointerUp}
        onWheel={onWheel}
      >
        {/* Dot grid background */}
        <div
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
          selectedElementId={selectedElementId}
          activeTool={activeTool}
          onSelectElement={(id) => {
            setSelectedElementId(id);
          }}
          onDragElement={moveElement}
          onResizeElement={resizeElement}
          onDblClickElement={startEditing}
          onStagePointerDown={() => {
            setSelectedElementId(null);
          }}
          onStagePointerMove={(worldX, worldY) => {
            connectionRef.current?.setCursor({ x: worldX, y: worldY });
          }}
        />

        {/* Remote cursor overlay */}
        <div className="absolute inset-0 pointer-events-none z-10">
          {remoteCursors.map((remote) => (
            <div
              key={remote.clientId}
              className="absolute -translate-x-0.5 -translate-y-0.5"
              style={{
                left: remote.cursor.x * camera.scale + camera.x,
                top: remote.cursor.y * camera.scale + camera.y
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

        {/* Text editing overlay */}
        {editingElement && editOverlayStyle && (
          <div
            className="absolute z-30"
            style={editOverlayStyle}
          >
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  commitEdit();
                }
                e.stopPropagation();
              }}
              className="w-full h-full resize-none border-none ring-2 ring-[#60a5fa] rounded bg-transparent text-[#1a1a1a] outline-none"
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: 14,
                lineHeight: 1,
                padding: 12,
                background: editingElement.type === "sticky-note" ? editingElement.color : "transparent",
              }}
            />
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
          onToolChange={setActiveTool}
          onDelete={() => {
            if (selectedElementId) deleteElement(selectedElementId);
          }}
          hasSelection={selectedElementId !== null}
        />
      </section>

      <footer className="px-4 py-2.5 border-t border-[#2a2a2a] bg-[#1a1a1a] text-[#999]">
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">V</kbd> Select
        <span className="mx-2 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">S</kbd> Sticky Note
        <span className="mx-2 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">R</kbd> Rectangle
        <span className="mx-2 text-[#555]">·</span>
        <kbd className="bg-[#242424] border border-[#3a3a3a] border-b-2 rounded px-1.5 py-0.5">Space + drag</kbd> Pan
        <span className="mx-2 text-[#555]">·</span>
        Scroll to zoom
      </footer>
    </main>
  );
}
