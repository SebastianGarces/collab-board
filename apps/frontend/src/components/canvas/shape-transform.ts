export type ElementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasPointer = {
  x: number;
  y: number;
};

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export type ResizeSession = {
  handle: ResizeHandle;
  startBox: ElementBox;
  startPointer: CanvasPointer;
};

export const MIN_ELEMENT_SIZE = 24;

export function normalizeBox(box: ElementBox, minSize = MIN_ELEMENT_SIZE): ElementBox {
  return {
    x: box.x,
    y: box.y,
    width: Math.max(minSize, box.width),
    height: Math.max(minSize, box.height),
  };
}

export function createBoxFromDrag(
  startPointer: CanvasPointer,
  currentPointer: CanvasPointer,
  minSize = MIN_ELEMENT_SIZE
): ElementBox {
  const dx = currentPointer.x - startPointer.x;
  const dy = currentPointer.y - startPointer.y;

  let x = dx >= 0 ? startPointer.x : startPointer.x + dx;
  let y = dy >= 0 ? startPointer.y : startPointer.y + dy;
  let width = Math.abs(dx);
  let height = Math.abs(dy);

  if (width < minSize) {
    x = dx >= 0 ? startPointer.x : startPointer.x - minSize;
    width = minSize;
  }

  if (height < minSize) {
    y = dy >= 0 ? startPointer.y : startPointer.y - minSize;
    height = minSize;
  }

  return { x, y, width, height };
}

export function resizeBoxFromHandle(
  session: ResizeSession,
  pointer: CanvasPointer,
  minSize = MIN_ELEMENT_SIZE
): ElementBox {
  const { startBox, startPointer, handle } = session;
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;

  let left = startBox.x;
  let right = startBox.x + startBox.width;
  let top = startBox.y;
  let bottom = startBox.y + startBox.height;

  if (handle.includes("w")) {
    left = Math.min(startBox.x + dx, right - minSize);
  }
  if (handle.includes("e")) {
    right = Math.max(startBox.x + startBox.width + dx, left + minSize);
  }
  if (handle.includes("n")) {
    top = Math.min(startBox.y + dy, bottom - minSize);
  }
  if (handle.includes("s")) {
    bottom = Math.max(startBox.y + startBox.height + dy, top + minSize);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

