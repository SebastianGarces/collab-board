"use client";

import { memo } from "react";
import type { ConnectorDashStyle } from "@collab/shared/collab";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DashStylePickerProps = {
  value: ConnectorDashStyle;
  onChange: (style: ConnectorDashStyle) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const DASH_OPTIONS: { value: ConnectorDashStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

function DashIcon({ style }: { style: ConnectorDashStyle }) {
  return (
    <svg width="18" height="4" viewBox="0 0 18 4" className="text-[#e0e0e0]">
      {style === "solid" && (
        <line x1="0" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="2" />
      )}
      {style === "dashed" && (
        <line x1="0" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
      )}
      {style === "dotted" && (
        <line x1="0" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="1.5 3" strokeLinecap="round" />
      )}
    </svg>
  );
}

function DashStylePickerComponent({ value, onChange, open, onOpenChange }: DashStylePickerProps) {
  const shouldRenderContent = open === undefined || open;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-[#2a2a2a] transition-colors"
          title="Line style"
        >
          <DashIcon style={value} />
        </button>
      </PopoverTrigger>
      {shouldRenderContent ? (
        <PopoverContent
          side="top"
          sideOffset={8}
          className="w-auto bg-[#1a1a1a] border-[#2a2a2a] p-1.5 rounded-xl"
        >
          <div className="flex items-center gap-0.5">
            {DASH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  value === option.value
                    ? "bg-[#60a5fa] text-white"
                    : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
                }`}
              >
                <DashIcon style={option.value} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export const DashStylePicker = memo(DashStylePickerComponent);
