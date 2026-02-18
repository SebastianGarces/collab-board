"use client";

import { memo, useCallback, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  colors: readonly string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function ColorPickerComponent({ value, onChange, colors, open, onOpenChange }: ColorPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  const handleColorSelect = useCallback(
    (color: string) => {
      onChange(color);
      setOpen(false);
    },
    [onChange, setOpen]
  );

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-7 w-7 rounded-full border-2 border-[#3a3a3a] hover:border-[#60a5fa] transition-colors shrink-0"
          style={{ backgroundColor: value }}
          title="Change color"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="w-auto bg-[#1a1a1a] border-[#2a2a2a] p-2 rounded-xl"
      >
        <div className="flex items-center gap-1.5">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => handleColorSelect(color)}
              className="h-7 w-7 rounded-full border-2 transition-colors shrink-0"
              style={{
                backgroundColor: color,
                borderColor: color === value ? "#60a5fa" : "#3a3a3a",
                boxShadow: color === value ? "0 0 0 2px rgba(96,165,250,0.3)" : undefined,
              }}
              title={color}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const ColorPicker = memo(ColorPickerComponent);
