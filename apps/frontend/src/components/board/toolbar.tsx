"use client";

import { memo } from "react";
import { ArrowRight, Circle, Copy, Hand, LayoutGrid, Minus, MousePointer2, Sparkles, Square, StickyNote, Trash2, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCanvasStore } from "@/stores/canvas-store";

export type ActiveTool = "pointer" | "hand" | "sticky-note" | "rectangle" | "circle" | "line" | "text" | "frame" | "connector";

type ToolbarProps = {
  onDelete: () => void;
  onDuplicate: () => void;
  hasSelection: boolean;
  aiChatOpen: boolean;
  onAiChatToggle: () => void;
};

const tools: { id: ActiveTool; icon: typeof MousePointer2; label: string }[] = [
  { id: "pointer", icon: MousePointer2, label: "Select" },
  { id: "hand", icon: Hand, label: "Pan" },
  { id: "sticky-note", icon: StickyNote, label: "Sticky Note" },
  { id: "rectangle", icon: Square, label: "Rectangle" },
  { id: "circle", icon: Circle, label: "Circle" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "text", icon: Type, label: "Text" },
  { id: "frame", icon: LayoutGrid, label: "Frame" },
  { id: "connector", icon: ArrowRight, label: "Connector" },
];

function ToolbarComponent({ onDelete, onDuplicate, hasSelection, aiChatOpen, onAiChatToggle }: ToolbarProps) {
  const activeTool = useCanvasStore((s) => s.activeTool);
  const setActiveTool = useCanvasStore((s) => s.setActiveTool);

  return (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-2 py-1.5 shadow-lg">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setActiveTool(tool.id)}
                  className="h-9 w-9"
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {tool.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <div className="w-px h-6 bg-[#2a2a2a] mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDuplicate}
              disabled={!hasSelection}
              className="h-9 w-9 disabled:text-[#555]"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Duplicate
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={!hasSelection}
              className="h-9 w-9 text-red-400 hover:text-red-300 disabled:text-[#555]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Delete
          </TooltipContent>
        </Tooltip>
        <div className="w-px h-6 bg-[#2a2a2a] mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onAiChatToggle}
              className="h-9 w-9"
            >
              <Sparkles className={`h-4 w-4 ${aiChatOpen ? "text-[#3b82f6]" : "text-[#7b8ca8]"}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            AI Assistant
          </TooltipContent>
        </Tooltip>
      </div>
  );
}

export const Toolbar = memo(ToolbarComponent);
