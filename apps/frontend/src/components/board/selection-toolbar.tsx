"use client";

import { useState } from "react";
import type { BoardElement, ElementType } from "@collab/shared/collab";
import { STICKY_NOTE_COLORS, SHAPE_COLORS } from "@collab/shared/collab";
import { Separator } from "@/components/ui/separator";
import { ColorPicker } from "./color-picker";
import { FontFamilyPicker } from "./font-family-picker";
import { FontSizePicker } from "./font-size-picker";

type ElementCapabilities = {
  colorKey?: string;
  colors?: readonly string[];
  deriveStroke?: boolean;
  font?: boolean;
  fontSize?: boolean;
};

function darkenHex(hex: string, amount = 0.25): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  const darken = (c: number) => Math.round(c * (1 - amount));
  return `#${darken(r).toString(16).padStart(2, "0")}${darken(g).toString(16).padStart(2, "0")}${darken(b).toString(16).padStart(2, "0")}`;
}

const ELEMENT_CAPABILITIES: Record<ElementType, ElementCapabilities> = {
  "sticky-note": { colorKey: "color", colors: STICKY_NOTE_COLORS, font: true, fontSize: true },
  "text":        { colorKey: "fill",  colors: SHAPE_COLORS,        font: true, fontSize: true },
  "rectangle":   { colorKey: "fill",  colors: SHAPE_COLORS, deriveStroke: true },
  "circle":      { colorKey: "fill",  colors: SHAPE_COLORS, deriveStroke: true },
  "line":        { colorKey: "stroke", colors: SHAPE_COLORS },
};

function getElementColor(element: BoardElement, colorKey: string): string {
  return (element as unknown as Record<string, unknown>)[colorKey] as string ?? "#ffffff";
}

function getElementFontFamily(element: BoardElement): string {
  if (element.type === "sticky-note" || element.type === "text") {
    return element.fontFamily;
  }
  return "system-ui, sans-serif";
}

function getElementFontSize(element: BoardElement): number {
  if (element.type === "sticky-note") return element.fontSize;
  if (element.type === "text") return element.fontSize;
  return 14;
}

type SelectionToolbarProps = {
  element: BoardElement;
  onPropertyChange: (key: string, value: unknown) => void;
  camera: { x: number; y: number; scale: number };
};

type ActiveMenu = "color" | "fontFamily" | "fontSize" | null;

export function SelectionToolbar({ element, onPropertyChange, camera }: SelectionToolbarProps) {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const caps = ELEMENT_CAPABILITIES[element.type];
  if (!caps) return null;

  const hasColor = !!caps.colorKey;
  const hasFont = !!caps.font;
  const hasFontSize = !!caps.fontSize;
  const hasAnything = hasColor || hasFont || hasFontSize;
  if (!hasAnything) return null;

  // Compute the visual bounding box accounting for rotation
  const rotation = (element.rotation ?? 0) * (Math.PI / 180);
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const hw = element.width / 2;
  const hh = element.height / 2;
  const cosR = Math.abs(Math.cos(rotation));
  const sinR = Math.abs(Math.sin(rotation));
  const rotatedHalfHeight = hw * sinR + hh * cosR;

  const toolbarLeft = cx * camera.scale + camera.x;
  const toolbarTop = (cy - rotatedHalfHeight) * camera.scale + camera.y - 12;

  return (
    <div
      className="absolute z-40 pointer-events-auto"
      style={{
        left: toolbarLeft,
        top: toolbarTop,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-2 py-1.5 shadow-lg">
        {hasColor && caps.colorKey && caps.colors && (
          <ColorPicker
            value={getElementColor(element, caps.colorKey)}
            onChange={(color) => {
              onPropertyChange(caps.colorKey!, color);
              if (caps.deriveStroke) {
                onPropertyChange("stroke", darkenHex(color));
              }
            }}
            colors={caps.colors}
            open={activeMenu === "color"}
            onOpenChange={(open) => setActiveMenu(open ? "color" : null)}
          />
        )}

        {hasColor && (hasFont || hasFontSize) && (
          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />
        )}

        {hasFont && (
          <FontFamilyPicker
            value={getElementFontFamily(element)}
            onChange={(fontFamily) => onPropertyChange("fontFamily", fontFamily)}
            open={activeMenu === "fontFamily"}
            onOpenChange={(open) => setActiveMenu(open ? "fontFamily" : null)}
          />
        )}

        {hasFont && hasFontSize && (
          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />
        )}

        {hasFontSize && (
          <FontSizePicker
            value={getElementFontSize(element)}
            onChange={(fontSize) => onPropertyChange("fontSize", fontSize)}
            open={activeMenu === "fontSize"}
            onOpenChange={(open) => setActiveMenu(open ? "fontSize" : null)}
          />
        )}
      </div>
    </div>
  );
}
