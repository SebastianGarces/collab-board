"use client";

import { memo, useMemo } from "react";
import { Check } from "lucide-react";

import type { ConnectorRoutingStyle } from "@collab/shared/collab";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RoutingStylePickerProps = {
  value: ConnectorRoutingStyle;
  onChange: (style: ConnectorRoutingStyle) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const ROUTING_OPTIONS: { value: ConnectorRoutingStyle; label: string; icon: string }[] = [
  { value: "straight", label: "Straight", icon: "╱" },
  { value: "curved", label: "Curved", icon: "∿" },
  { value: "orthogonal", label: "Elbow", icon: "⌐" },
];

function getLabelForStyle(value: ConnectorRoutingStyle): string {
  return ROUTING_OPTIONS.find((o) => o.value === value)?.label ?? "Straight";
}

function RoutingStylePickerComponent({ value, onChange, open, onOpenChange }: RoutingStylePickerProps) {
  const selectedLabel = useMemo(() => getLabelForStyle(value), [value]);
  const selectedIcon = useMemo(
    () => ROUTING_OPTIONS.find((option) => option.value === value)?.icon ?? "╱",
    [value]
  );
  const shouldRenderContent = open === undefined || open;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2 h-8 rounded-md text-sm text-[#e0e0e0] hover:bg-[#2a2a2a] transition-colors whitespace-nowrap"
          title="Line routing"
        >
          <span className="text-sm font-mono">
            {selectedIcon}
          </span>
          <span className="text-xs text-[#999] hidden sm:inline">
            {selectedLabel}
          </span>
        </button>
      </DropdownMenuTrigger>
      {shouldRenderContent ? (
        <DropdownMenuContent
          side="top"
          sideOffset={8}
          className="bg-[#1a1a1a] border-[#2a2a2a] min-w-[140px]"
        >
          {ROUTING_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onChange(option.value)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="w-4 shrink-0">
                {option.value === value && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="font-mono mr-1">{option.icon}</span>
              <span>{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

export const RoutingStylePicker = memo(RoutingStylePickerComponent);
