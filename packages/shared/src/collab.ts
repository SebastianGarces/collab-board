/** Wire format: first varuint in every WS frame identifies the channel. */
export const WS_MESSAGE_SYNC = 0;
export const WS_MESSAGE_PERF_PROBE = 1;

export type Cursor = {
  x: number;
  y: number;
};

export type PresenceUser = {
  id: string;
  name: string;
  color: string;
};

export type PresenceState = {
  user: PresenceUser;
  cursor: Cursor | null;
};

export type PerfProbeKind = "cursor" | "object";

export type PerfProbeMessage = {
  id: string;
  kind: PerfProbeKind;
  roomId: string;
  senderClientId: number;
  sentAtMs: number;
};

/** Board element types stored in the Yjs "elements" map. */

export type ElementType = "sticky-note" | "rectangle" | "circle" | "line" | "text";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // degrees, pivots around center
}

export interface StickyNoteElement extends BaseElement {
  type: "sticky-note";
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
  fill: string;
  stroke: string;
}

export interface CircleElement extends BaseElement {
  type: "circle";
  fill: string;
  stroke: string;
}

export interface LineElement extends BaseElement {
  type: "line";
  stroke: string;
  strokeWidth: number;
  points: number[];
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
}

export type BoardElement =
  | StickyNoteElement
  | RectangleElement
  | CircleElement
  | LineElement
  | TextElement;

export const STICKY_NOTE_COLORS = [
  "#facc15", // yellow
  "#f472b6", // pink
  "#60a5fa", // blue
  "#4ade80", // green
  "#c084fc", // purple
  "#fb923c", // orange
] as const;

export const FONT_FAMILIES = [
  { value: "system-ui, sans-serif", label: "Simple" },
  { value: "Georgia, serif", label: "Bookish" },
  { value: "ui-monospace, monospace", label: "Technical" },
  { value: "cursive", label: "Scribbled" },
] as const;

export const FONT_SIZE_PRESETS = [
  { value: 12, label: "Small" },
  { value: 16, label: "Medium" },
  { value: 20, label: "Large" },
  { value: 28, label: "Extra large" },
  { value: 36, label: "Huge" },
] as const;

export const SHAPE_COLORS = [
  "#ffffff", // white
  "#d4d4d4", // light gray
  "#facc15", // yellow
  "#f472b6", // pink
  "#60a5fa", // blue
  "#4ade80", // green
  "#c084fc", // purple
  "#fb923c", // orange
  "#f87171", // red
  "#2dd4bf", // teal
] as const;

export const DEFAULT_FONT_FAMILY = "system-ui, sans-serif";
export const DEFAULT_STICKY_NOTE_FONT_SIZE = 14;

export const DEFAULT_STICKY_NOTE_SIZE = { width: 200, height: 200 };
export const DEFAULT_RECTANGLE_SIZE = { width: 200, height: 150 };
export const DEFAULT_CIRCLE_SIZE = { width: 150, height: 150 };
export const DEFAULT_LINE_SIZE = { width: 200, height: 0 };
export const DEFAULT_TEXT_SIZE = { width: 200, height: 40 };
