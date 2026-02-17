"use client";

import { Circle, Minus, MousePointer2, Square, StickyNote, Trash2, Type } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ActiveTool = "pointer" | "sticky-note" | "rectangle" | "circle" | "line" | "text";

type ToolbarProps = {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  onDelete: () => void;
  hasSelection: boolean;
};

const tools: { id: ActiveTool; icon: typeof MousePointer2; label: string }[] = [
  { id: "pointer", icon: MousePointer2, label: "Select" },
  { id: "sticky-note", icon: StickyNote, label: "Sticky Note" },
  { id: "rectangle", icon: Square, label: "Rectangle" },
  { id: "circle", icon: Circle, label: "Circle" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "text", icon: Type, label: "Text" },
];

export function Toolbar({ activeTool, onToolChange, onDelete, hasSelection }: ToolbarProps) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-2 py-1.5 shadow-lg">
      {tools.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        return (
          <Button
            key={tool.id}
            variant={isActive ? "secondary" : "ghost"}
            size="icon"
            onClick={() => onToolChange(tool.id)}
            title={tool.label}
            className="h-9 w-9"
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}
      <div className="w-px h-6 bg-[#2a2a2a] mx-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={!hasSelection}
        title="Delete"
        className="h-9 w-9 text-red-400 hover:text-red-300 disabled:text-[#555]"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
