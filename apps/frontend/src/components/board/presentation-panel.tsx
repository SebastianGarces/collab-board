"use client";

import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Presentation, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import type { BoardElement, FrameElement } from "@collab/shared/collab";

type PresentationPanelProps = {
  open: boolean;
  onClose: () => void;
  elements: BoardElement[];
  doc: Y.Doc | null;
  onStartPresentation: (slideOrder: string[]) => void;
  activePresenter?: { userName: string } | null;
};

function SlideCardContent({
  frameId,
  index,
  title,
  onRemove,
}: {
  frameId: string;
  index: number;
  title: string;
  onRemove: () => void;
}) {
  return (
    <>
      <span className="text-xs font-medium text-[#888] w-5 shrink-0">{index + 1}</span>
      <span className="flex-1 truncate text-sm text-[#e0e0e0]">{title}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 cursor-pointer text-[#666] hover:text-red-400"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </>
  );
}

function SortableSlideCard({
  frameId,
  index,
  title,
  onRemove,
}: {
  frameId: string;
  index: number;
  title: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: frameId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
        isDragging
          ? "border-[#3b82f6] bg-[#1e3a5f]/50 opacity-50"
          : "border-[#2a2a2a] bg-[#222] hover:border-[#3a3a3a]"
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className="flex shrink-0 cursor-grab active:cursor-grabbing touch-none py-0.5"
      >
        <GripVertical className="h-4 w-4 text-[#555]" />
      </div>
      <SlideCardContent
        frameId={frameId}
        index={index}
        title={title}
        onRemove={onRemove}
      />
    </div>
  );
}

export function PresentationPanel({
  open,
  onClose,
  elements,
  doc,
  onStartPresentation,
  activePresenter = null,
}: PresentationPanelProps) {
  const [slides, setSlides] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    const slideOrder = doc.getArray<string>("slideOrder");

    const updateSlides = () => {
      setSlides(slideOrder.toArray());
    };
    updateSlides();
    slideOrder.observe(updateSlides);

    return () => slideOrder.unobserve(updateSlides);
  }, [doc]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id || !doc) return;

      const slideOrder = doc.getArray<string>("slideOrder");
      const arr = slideOrder.toArray();
      const oldIndex = arr.indexOf(String(active.id));
      const newIndex = arr.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const frameId = arr[oldIndex];
      doc.transact(() => {
        slideOrder.delete(oldIndex, 1);
        slideOrder.insert(newIndex, [frameId]);
      });
    },
    [doc]
  );

  const handleAddAllFrames = useCallback(() => {
    if (!doc) return;
    const frames = elements
      .filter((el): el is FrameElement => el.type === "frame" && !(el as FrameElement).hidden)
      .sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });
    const slideOrder = doc.getArray<string>("slideOrder");
    const existing = new Set(slideOrder.toArray());
    const toAdd = frames.map((f) => f.id).filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    doc.transact(() => {
      toAdd.forEach((id) => slideOrder.push([id]));
    });
  }, [doc, elements]);

  const handleRemoveSlide = useCallback(
    (frameId: string) => {
      if (!doc) return;
      const slideOrder = doc.getArray<string>("slideOrder");
      const idx = slideOrder.toArray().indexOf(frameId);
      if (idx < 0) return;
      doc.transact(() => {
        slideOrder.delete(idx, 1);
      });
    },
    [doc]
  );

  const frames = elements.filter((el): el is FrameElement => el.type === "frame");
  const hasFrames = frames.length > 0;

  const activeSlide = activeId ? slides.find((id) => id === activeId) : null;
  const activeFrame = activeSlide
    ? elements.find((el) => el.id === activeSlide && el.type === "frame") as FrameElement | undefined
    : undefined;
  const activeIndex = activeSlide ? slides.indexOf(activeSlide) : -1;

  if (!open) return null;

  return (
    <div
      className="absolute left-3 top-16 bottom-16 z-40 w-[320px] flex flex-col bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Presentation className="h-4 w-4 text-[#888]" />
          <span className="text-sm font-medium text-white">Presentation</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!hasFrames ? (
          <div className="text-center text-[#666] text-sm py-8">
            Add frames to the canvas to create slides.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={slides}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {slides.map((frameId, index) => {
                  const frame = elements.find(
                    (el) => el.id === frameId && el.type === "frame"
                  ) as FrameElement | undefined;
                  const title = frame?.title?.trim() || "Untitled";
                  return (
                    <SortableSlideCard
                      key={frameId}
                      frameId={frameId}
                      index={index}
                      title={title}
                      onRemove={() => handleRemoveSlide(frameId)}
                    />
                  );
                })}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
              {activeId && activeFrame ? (
                <div className="flex items-center gap-2 rounded-lg border-2 border-[#3b82f6] bg-[#222] px-3 py-2 shadow-xl cursor-grabbing">
                  <GripVertical className="h-4 w-4 shrink-0 text-[#555]" />
                  <SlideCardContent
                    frameId={activeId}
                    index={activeIndex}
                    title={activeFrame.title?.trim() || "Untitled"}
                    onRemove={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {hasFrames && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full cursor-pointer justify-start gap-2 text-[#888] hover:text-white hover:bg-[#2a2a2a]"
            onClick={handleAddAllFrames}
          >
            <Plus className="h-4 w-4" />
            Add all frames
          </Button>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[#2a2a2a]">
        <Button
          className="w-full cursor-pointer gap-2"
          onClick={() => onStartPresentation(slides)}
          disabled={slides.length === 0 && !activePresenter}
        >
          <Presentation className="h-4 w-4" />
          {activePresenter ? "Join presentation" : "Present"}
        </Button>
      </div>
    </div>
  );
}
