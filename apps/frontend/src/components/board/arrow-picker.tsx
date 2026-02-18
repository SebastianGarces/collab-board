"use client";

import type { ConnectorArrowStyle } from "@collab/shared/collab";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ArrowPickerProps = {
  startArrow: ConnectorArrowStyle;
  endArrow: ConnectorArrowStyle;
  onStartArrowChange: (style: ConnectorArrowStyle) => void;
  onEndArrowChange: (style: ConnectorArrowStyle) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const ARROW_OPTIONS: { value: ConnectorArrowStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "diamond", label: "Diamond" },
];

function ArrowIcon({ startArrow, endArrow }: { startArrow: ConnectorArrowStyle; endArrow: ConnectorArrowStyle }) {
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" className="text-[#e0e0e0]">
      {/* Start marker */}
      {startArrow === "arrow" && (
        <polygon points="6,1 1,6 6,11" fill="currentColor" />
      )}
      {startArrow === "diamond" && (
        <polygon points="1,6 4,3 7,6 4,9" fill="currentColor" />
      )}
      {startArrow === "none" && (
        <circle cx="2" cy="6" r="1.5" fill="currentColor" />
      )}
      {/* Line */}
      <line
        x1={startArrow === "none" ? 2 : 6}
        y1="6"
        x2={endArrow === "none" ? 18 : 14}
        y2="6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* End marker */}
      {endArrow === "arrow" && (
        <polygon points="14,1 19,6 14,11" fill="currentColor" />
      )}
      {endArrow === "diamond" && (
        <polygon points="13,6 16,3 19,6 16,9" fill="currentColor" />
      )}
      {endArrow === "none" && (
        <circle cx="18" cy="6" r="1.5" fill="currentColor" />
      )}
    </svg>
  );
}

export function ArrowPicker({
  startArrow,
  endArrow,
  onStartArrowChange,
  onEndArrowChange,
  open,
  onOpenChange,
}: ArrowPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-7 px-1.5 rounded-md hover:bg-[#2a2a2a] transition-colors"
          title="Arrow endpoints"
        >
          <ArrowIcon startArrow={startArrow} endArrow={endArrow} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="w-auto bg-[#1a1a1a] border-[#2a2a2a] p-3 rounded-xl"
      >
        <div className="flex flex-col gap-3">
          {/* Start endpoint */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#999] font-medium">Start</span>
            <div className="flex items-center gap-1">
              {ARROW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onStartArrowChange(option.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    startArrow === option.value
                      ? "bg-[#60a5fa] text-white"
                      : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {/* End endpoint */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#999] font-medium">End</span>
            <div className="flex items-center gap-1">
              {ARROW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onEndArrowChange(option.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    endArrow === option.value
                      ? "bg-[#60a5fa] text-white"
                      : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
