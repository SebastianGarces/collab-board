"use client";

import { Check } from "lucide-react";

import { FONT_FAMILIES } from "@collab/shared/collab";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FontFamilyPickerProps = {
  value: string;
  onChange: (fontFamily: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function getLabelForFamily(value: string): string {
  return FONT_FAMILIES.find((f) => f.value === value)?.label ?? "Simple";
}

export function FontFamilyPicker({ value, onChange, open, onOpenChange }: FontFamilyPickerProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2 h-8 rounded-md text-sm text-[#e0e0e0] hover:bg-[#2a2a2a] transition-colors whitespace-nowrap"
          title="Font family"
        >
          <span className="text-xs font-medium">Aa</span>
          <span className="text-xs text-[#999] hidden sm:inline">
            {getLabelForFamily(value)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        sideOffset={8}
        className="bg-[#1a1a1a] border-[#2a2a2a] min-w-[140px]"
      >
        {FONT_FAMILIES.map((font) => (
          <DropdownMenuItem
            key={font.value}
            onClick={() => onChange(font.value)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="w-4 shrink-0">
              {font.value === value && <Check className="h-3.5 w-3.5" />}
            </span>
            <span style={{ fontFamily: font.value }}>{font.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
