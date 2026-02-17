"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { FONT_SIZE_PRESETS } from "@collab/shared/collab";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FontSizePickerProps = {
  value: number;
  onChange: (fontSize: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function getLabelForSize(value: number): string {
  return FONT_SIZE_PRESETS.find((p) => p.value === value)?.label ?? String(value);
}

export function FontSizePicker({ value, onChange, open, onOpenChange }: FontSizePickerProps) {
  const [customValue, setCustomValue] = useState("");

  const handleCustomSubmit = () => {
    const parsed = parseInt(customValue, 10);
    if (Number.isFinite(parsed) && parsed >= 8 && parsed <= 120) {
      onChange(parsed);
    }
    setCustomValue("");
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2 h-8 rounded-md text-sm text-[#e0e0e0] hover:bg-[#2a2a2a] transition-colors whitespace-nowrap"
          title="Font size"
        >
          <span className="text-xs">{getLabelForSize(value)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        sideOffset={8}
        className="bg-[#1a1a1a] border-[#2a2a2a] min-w-[140px]"
      >
        {FONT_SIZE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onClick={() => onChange(preset.value)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="w-4 shrink-0">
              {preset.value === value && <Check className="h-3.5 w-3.5" />}
            </span>
            <span style={{ fontSize: Math.min(preset.value, 20) }}>
              {preset.label}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-[#2a2a2a]" />
        <div className="px-2 py-1.5">
          <input
            type="number"
            min={8}
            max={120}
            placeholder={String(value)}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomSubmit();
              }
              e.stopPropagation();
            }}
            className="w-full h-7 px-2 rounded border border-[#3a3a3a] bg-[#242424] text-sm text-[#e0e0e0] outline-none focus:border-[#60a5fa]"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
