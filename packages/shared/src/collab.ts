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

export type ElementType = "sticky-note" | "rectangle";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickyNoteElement extends BaseElement {
  type: "sticky-note";
  text: string;
  color: string;
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
  fill: string;
  stroke: string;
}

export type BoardElement = StickyNoteElement | RectangleElement;

export const STICKY_NOTE_COLORS = [
  "#facc15", // yellow
  "#f472b6", // pink
  "#60a5fa", // blue
  "#4ade80", // green
  "#c084fc", // purple
  "#fb923c", // orange
] as const;

export const DEFAULT_STICKY_NOTE_SIZE = { width: 200, height: 200 };
export const DEFAULT_RECTANGLE_SIZE = { width: 200, height: 150 };
