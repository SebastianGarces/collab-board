"use client";

import { useState } from "react";
import { Eye, EyeClosed, Type } from "lucide-react";
import type { BoardElement, ConnectorElement, ElementType, FrameElement } from "@collab/shared/collab";
import { STICKY_NOTE_COLORS, SHAPE_COLORS, FRAME_COLORS, FRAME_BORDER_COLORS } from "@collab/shared/collab";
import { Separator } from "@/components/ui/separator";
import { ColorPicker } from "./color-picker";
import { FontFamilyPicker } from "./font-family-picker";
import { FontSizePicker } from "./font-size-picker";
import { BorderStylePicker } from "./border-style-picker";
import { RoutingStylePicker } from "./routing-style-picker";
import { ArrowPicker } from "./arrow-picker";
import { DashStylePicker } from "./dash-style-picker";

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
  "frame":       {},
  "connector":   {},
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
  editingConnectorLabel?: boolean;
  onStartEditingConnectorLabel?: () => void;
};

type ActiveMenu = "color" | "fontFamily" | "fontSize" | "borderStyle" | "routing" | "arrows" | "dashStyle" | null;

export function SelectionToolbar({ element, onPropertyChange, camera, editingConnectorLabel, onStartEditingConnectorLabel }: SelectionToolbarProps) {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const caps = ELEMENT_CAPABILITIES[element.type];

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

  // Connector toolbar (3 states: default, has-label, editing-label)
  if (element.type === "connector") {
    const connector = element as ConnectorElement;

    if (editingConnectorLabel) {
      // Label editing state: text formatting controls
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
            <ColorPicker
              value={connector.labelFill}
              onChange={(color) => onPropertyChange("labelFill", color)}
              colors={SHAPE_COLORS}
              open={activeMenu === "color"}
              onOpenChange={(open) => setActiveMenu(open ? "color" : null)}
            />

            <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

            <FontFamilyPicker
              value={connector.labelFontFamily}
              onChange={(fontFamily) => onPropertyChange("labelFontFamily", fontFamily)}
              open={activeMenu === "fontFamily"}
              onOpenChange={(open) => setActiveMenu(open ? "fontFamily" : null)}
            />

            <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

            <FontSizePicker
              value={connector.labelFontSize}
              onChange={(fontSize) => onPropertyChange("labelFontSize", fontSize)}
              open={activeMenu === "fontSize"}
              onOpenChange={(open) => setActiveMenu(open ? "fontSize" : null)}
            />

            <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

            <button
              type="button"
              onClick={() => onPropertyChange("labelBold", !connector.labelBold)}
              className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                connector.labelBold
                  ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]"
                  : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
              }`}
              title="Bold"
            >
              <span className="text-sm font-bold">B</span>
            </button>

            <button
              type="button"
              onClick={() => onPropertyChange("labelStrikethrough", !connector.labelStrikethrough)}
              className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                connector.labelStrikethrough
                  ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]"
                  : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
              }`}
              title="Strikethrough"
            >
              <span className="text-sm line-through">S</span>
            </button>
          </div>
        </div>
      );
    }

    // Default connector state: connector controls + optional "T" button
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
          <RoutingStylePicker
            value={connector.routingStyle}
            onChange={(style) => {
              onPropertyChange("routingStyle", style);
              onPropertyChange("elbowMidpoint", null);
            }}
            open={activeMenu === "routing"}
            onOpenChange={(open) => setActiveMenu(open ? "routing" : null)}
          />

          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

          <ArrowPicker
            startArrow={connector.startArrow}
            endArrow={connector.endArrow}
            onStartArrowChange={(style) => onPropertyChange("startArrow", style)}
            onEndArrowChange={(style) => onPropertyChange("endArrow", style)}
            open={activeMenu === "arrows"}
            onOpenChange={(open) => setActiveMenu(open ? "arrows" : null)}
          />

          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

          <DashStylePicker
            value={connector.dashStyle}
            onChange={(style) => onPropertyChange("dashStyle", style)}
            open={activeMenu === "dashStyle"}
            onOpenChange={(open) => setActiveMenu(open ? "dashStyle" : null)}
          />

          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

          <ColorPicker
            value={connector.stroke}
            onChange={(color) => onPropertyChange("stroke", color)}
            colors={SHAPE_COLORS}
            open={activeMenu === "color"}
            onOpenChange={(open) => setActiveMenu(open ? "color" : null)}
          />

          {/* "T" button to add label — only when no label exists */}
          {connector.labelText === "" && onStartEditingConnectorLabel && (
            <>
              <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />
              <button
                type="button"
                onClick={onStartEditingConnectorLabel}
                className="flex items-center justify-center h-7 w-7 rounded-md text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] transition-colors"
                title="Add text label"
              >
                <Type className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!caps) return null;

  // Frame-specific toolbar
  if (element.type === "frame") {
    const frame = element as FrameElement;
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
          {/* Background color */}
          <ColorPicker
            value={frame.fill}
            onChange={(color) => onPropertyChange("fill", color)}
            colors={FRAME_COLORS}
            open={activeMenu === "color"}
            onOpenChange={(open) => setActiveMenu(open ? "color" : null)}
          />

          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

          {/* Border style + color */}
          <BorderStylePicker
            strokeStyle={frame.strokeStyle}
            strokeColor={frame.stroke}
            onStyleChange={(style) => onPropertyChange("strokeStyle", style)}
            onColorChange={(color) => onPropertyChange("stroke", color)}
            colors={FRAME_BORDER_COLORS}
            open={activeMenu === "borderStyle"}
            onOpenChange={(open) => setActiveMenu(open ? "borderStyle" : null)}
          />

          <Separator orientation="vertical" className="h-6 bg-[#2a2a2a] mx-0.5" />

          {/* Hide/show toggle */}
          <button
            type="button"
            onClick={() => onPropertyChange("hidden", !frame.hidden)}
            className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
              frame.hidden
                ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]"
                : "text-[#999] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
            }`}
            title={frame.hidden ? "Show section" : "Hide section"}
          >
            {frame.hidden ? (
              <EyeClosed className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  // Generic toolbar for non-frame elements
  const hasColor = !!caps.colorKey;
  const hasFont = !!caps.font;
  const hasFontSize = !!caps.fontSize;
  const hasAnything = hasColor || hasFont || hasFontSize;
  if (!hasAnything) return null;

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
