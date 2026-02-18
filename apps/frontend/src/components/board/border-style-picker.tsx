"use client";

import { memo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Minus, Slash } from "lucide-react";

import type { FrameStrokeStyle } from "@collab/shared/collab";

type BorderStylePickerProps = {
  strokeStyle: FrameStrokeStyle;
  strokeColor: string;
  onStyleChange: (style: FrameStrokeStyle) => void;
  onColorChange: (color: string) => void;
  colors: readonly string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const STYLE_OPTIONS: { value: FrameStrokeStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "none", label: "None" },
];

function BorderStylePickerComponent({
  strokeStyle,
  strokeColor,
  onStyleChange,
  onColorChange,
  colors,
  open,
  onOpenChange,
}: BorderStylePickerProps) {
  const shouldRenderContent = open === undefined || open;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-7 w-7 rounded-md border-2 border-[#3a3a3a] hover:border-[#60a5fa] transition-colors shrink-0"
          title="Border style"
        >
          {strokeStyle === "none" ? (
            <Slash className="h-3.5 w-3.5 text-[#999]" />
          ) : (
            <Minus
              className="h-4 w-4"
              style={{ color: strokeColor }}
              strokeDasharray={strokeStyle === "dashed" ? "4 3" : undefined}
            />
          )}
        </button>
      </PopoverTrigger>
      {shouldRenderContent ? (
        <PopoverContent
          side="top"
          sideOffset={8}
          className="w-auto bg-[#1a1a1a] border-[#2a2a2a] p-2 rounded-xl"
        >
          <div className="flex flex-col gap-2">
            {/* Style tabs */}
            <div className="flex items-center gap-0.5 bg-[#242424] rounded-lg p-0.5">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onStyleChange(option.value)}
                  className={`flex-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    strokeStyle === option.value
                      ? "bg-[#60a5fa] text-white"
                      : "text-[#999] hover:text-[#e0e0e0]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {/* Color grid */}
            {strokeStyle !== "none" && (
              <div className="flex flex-wrap gap-1.5 max-w-[230px]">
                {colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onColorChange(color)}
                    className="h-7 w-7 rounded-full border-2 transition-colors shrink-0"
                    style={{
                      backgroundColor: color,
                      borderColor: color === strokeColor ? "#60a5fa" : "#3a3a3a",
                      boxShadow: color === strokeColor ? "0 0 0 2px rgba(96,165,250,0.3)" : undefined,
                    }}
                    title={color}
                  />
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export const BorderStylePicker = memo(BorderStylePickerComponent);
