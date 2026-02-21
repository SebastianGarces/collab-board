# Collaborative Undo/Redo — Implementation Plan

## Overview

Add per-user undo/redo powered by Yjs `UndoManager`. Cmd+Z undoes only **your** changes (manual edits and AI commands you triggered), never other users' changes. Toolbar buttons provide visual affordance alongside keyboard shortcuts.

The core challenge is defining what constitutes a single "action" so that high-frequency RAF-batched operations (drag, resize, rotate, live text) merge into one undo step, while discrete operations (create, delete, color change) are each their own step.

---

## Architecture

### Yjs UndoManager

Yjs provides `Y.UndoManager` which tracks changes to specified shared types and can reverse them. It uses **transaction origins** to decide which transactions to track.

```
UndoManager config:
  scope:          doc.getMap("elements")
  trackedOrigins: new Set(["local", "ai-mutation"])
  captureTimeout: 500  (ms — merges transactions within this window)
```

- `"local"` — origin set on all user-initiated transactions in page.tsx
- `"ai-mutation"` — origin set when applying AI-generated Yjs updates on the client
- Anything else (WebSocket sync from other users, system operations) is **not tracked**

### captureTimeout Merging

`captureTimeout: 500` means: if two transactions with the same tracked origin happen within 500ms of each other, they merge into one undo step. This is the mechanism that collapses RAF-batched drag/resize/rotate into a single undo step — each RAF flush is ~16ms apart, well within 500ms.

---

## Action Taxonomy

This table is the authoritative definition of what one "undo" reverses.

### Discrete actions (one undo step each)

| User Action | Current Code Location | Transaction? | Change Needed |
|---|---|---|---|
| Create sticky note (click) | `createStickyNote` (page.tsx ~L508) | NO wrapper — direct set() calls | Wrap in `doc.transact(() => {...}, "local")` |
| Create text element (click) | `createTextElement` (page.tsx ~L609) | NO wrapper | Wrap in `doc.transact(() => {...}, "local")` |
| Delete element | `deleteElement` (page.tsx ~L1228) | `doc.transact()` | Add origin `"local"` |
| Delete selected elements | `deleteSelectedElements` (page.tsx ~L1288) | `doc.transact()` | Add origin `"local"` |
| Duplicate | `duplicateSelectedElements` (page.tsx ~L1357) | `doc.transact()` | Add origin `"local"` |
| Paste | `pasteElements` (page.tsx ~L1480) | `doc.transact()` | Add origin `"local"` |
| Color/property change | `updateElementProperty` (page.tsx ~L1621) | `doc.transact()` | Add origin `"local"` |
| Dissolve frame | `dissolveFrame` (page.tsx ~L1249) | `doc.transact()` | Add origin `"local"` |
| AI mutation (e.g. "create a SWOT") | Server-side, arrives via WS | Received as sync message | New message type applies with origin `"ai-mutation"` |

### Continuous gestures (merged into one undo step via captureTimeout)

| User Action | RAF Flush Function | Final/Commit Function | Change Needed |
|---|---|---|---|
| Drag (single element) | `flushPendingDragMove` (~L977, origin `"element-drag-move"`) | `moveElement` (~L814) | Change RAF origin to `"local"`, add `"local"` to moveElement |
| Drag (group/multi-select) | `flushPendingGroupDragMove` (~L1008, origin `"group-drag-move"`) | `moveSelectedElements` (~L898) | Change RAF origin to `"local"`, add `"local"` to moveSelectedElements |
| Resize | `flushPendingResize` (~L1081) | None (RAF is the only write) | Add origin `"local"` |
| Rotate | `flushPendingRotate` (~L1110) | None (RAF is the only write) | Add origin `"local"` |
| Text editing (live typing) | `applyEditingTextToYjs` via RAF (~L1681) | `commitEdit` (~L1698, calls applyEditingTextToYjs) | Add origin `"local"` to applyEditingTextToYjs |
| Draw shape (drag-to-draw) | Initial create (no transact) + RAF resize updates | Shape finalized on pointer up | Wrap initial create in transact with `"local"`, add `"local"` to resize RAF |
| Connector endpoint drag | `moveConnectorEndpoint` (~L723) | `finalizeConnectorEndpoint` (~L772) | Add origin `"local"` to both |
| Line endpoint move | `moveLineEndpoint` (~L1200) | None | Add origin `"local"` |

**How merging works for a drag gesture:**
1. User starts dragging → `flushPendingDragMove` fires every ~16ms with origin `"local"`
2. Each RAF flush is a transaction within 500ms of the previous one → they merge
3. User releases → `moveElement` fires with origin `"local"`, also within 500ms → merges
4. Result: the entire drag from start position to end position is **one undo step**

### Excluded from undo (not tracked)

| Event | Why Excluded |
|---|---|
| Remote user edits | Origin is the WebSocket object, not in `trackedOrigins` |
| Camera pan/zoom | Not a Yjs mutation — local React state only |
| Selection changes | Not a Yjs mutation — Zustand store only |
| Presence/cursor updates | Separate WS channel, not in elements map |
| Perf test writes | Should use a non-tracked origin like `"perf-test"` |

---

## Transaction Origin Strategy

### Current state

Most transactions in page.tsx use `doc.transact(() => {...})` with **no origin** (defaults to `null`). Two exceptions:
- `flushPendingDragMove`: origin `"element-drag-move"`
- `flushPendingGroupDragMove`: origin `"group-drag-move"`

Element creation functions don't use `doc.transact()` at all.

### Target state

Every user-initiated mutation uses origin `"local"`:

```typescript
doc.transact(() => {
  // mutation
}, "local");
```

Element creation functions are wrapped in `doc.transact()`:

```typescript
const createStickyNote = useCallback((worldX: number, worldY: number) => {
  const doc = docRef.current;
  if (!doc) return;
  const elementsMap = doc.getMap("elements");
  const id = generateId();
  const elementMap = new Y.Map<unknown>();

  doc.transact(() => {
    elementMap.set("type", "sticky-note");
    elementMap.set("id", id);
    // ... all properties ...
    assignFrameIdToElement(elementMap, worldX, worldY);
    elementsMap.set(id, elementMap);
  }, "local");

  setSelectedElementIds(new Set([id]));
  setActiveTool("pointer");
}, [assignFrameIdToElement]);
```

---

## AI Mutation Undo Support

### Problem

AI mutations happen server-side. The server's `resumeBroadcast()` merges all AI updates and sends them as a regular `WS_MESSAGE_SYNC` (value 0). On the client, `y-protocols/sync` applies these with origin = the WebSocket object, which UndoManager doesn't track.

### Solution

Introduce a new WebSocket message type `WS_MESSAGE_AI_SYNC = 4` that carries the same Yjs binary update but tells the client to apply it with a special origin.

**Wire format:** `[4: varuint][update: varUint8Array]`

#### Changes

**`packages/shared/src/collab.ts`** — Add constant:
```typescript
export const WS_MESSAGE_AI_SYNC = 4;
```

**`apps/backend/src/collab/room-manager.ts`** — New method `resumeBroadcastAsAi()`:
```typescript
resumeBroadcastAsAi(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room) return;
  room.broadcastPaused = false;

  if (room.pendingUpdates.length === 0) return;

  const merged = Y.mergeUpdates(room.pendingUpdates);
  room.pendingUpdates.length = 0;

  // Send as WS_MESSAGE_AI_SYNC so client applies with "ai-mutation" origin
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_AI_SYNC);
  encoding.writeVarUint8Array(encoder, merged);
  const payload = encoding.toUint8Array(encoder);

  for (const client of room.clients) {
    this.observeOutbound(payload.byteLength);
    client.send(payload);
  }
}
```

Keep the existing `resumeBroadcast()` unchanged for non-AI use cases.

**`apps/backend/src/ai/handler.ts`** — Change the resume call:
```typescript
// Before:
roomManager?.resumeBroadcast(roomId);

// After:
roomManager?.resumeBroadcastAsAi(roomId);
```

**`apps/frontend/src/lib/collab.ts`** — Handle new message type:
```typescript
import { WS_MESSAGE_AI_SYNC } from "@collab/shared/collab";

// In socket.onmessage handler, add after the WS_MESSAGE_AI block:
} else if (messageType === WS_MESSAGE_AI_SYNC) {
  const update = decoding.readVarUint8Array(decoder);
  Y.applyUpdate(doc, update, "ai-mutation");
}
```

This bypasses `y-protocols/sync` (which would set origin to the WebSocket) and directly applies the update with the `"ai-mutation"` origin that UndoManager tracks.

---

## UndoManager Setup

### Initialization

In `page.tsx`, create the UndoManager after the Y.Doc is available. Store in a ref so it persists across re-renders but is cleaned up on unmount.

```typescript
const undoManagerRef = useRef<Y.UndoManager | null>(null);

// In the connection setup effect (where docRef.current is set):
useEffect(() => {
  // ... existing connection setup ...
  const doc = connection.doc;
  const elementsMap = doc.getMap("elements");

  const undoManager = new Y.UndoManager(elementsMap, {
    trackedOrigins: new Set(["local", "ai-mutation"]),
    captureTimeout: 500,
  });
  undoManagerRef.current = undoManager;

  return () => {
    undoManager.destroy();
    undoManagerRef.current = null;
    // ... existing cleanup ...
  };
}, [/* existing deps */]);
```

### Undo/Redo functions

```typescript
const undo = useCallback(() => {
  undoManagerRef.current?.undo();
}, []);

const redo = useCallback(() => {
  undoManagerRef.current?.redo();
}, []);
```

### Stack state tracking (for button disabled state)

Track whether the undo/redo stacks have items:

```typescript
const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);

// In the UndoManager setup:
const updateStackState = () => {
  setCanUndo((undoManagerRef.current?.undoStack.length ?? 0) > 0);
  setCanRedo((undoManagerRef.current?.redoStack.length ?? 0) > 0);
};

undoManager.on("stack-item-added", updateStackState);
undoManager.on("stack-item-popped", updateStackState);
undoManager.on("stack-cleared", updateStackState);
```

---

## UI Changes

### Toolbar buttons

Add undo/redo buttons to `apps/frontend/src/components/board/toolbar.tsx`, to the left of the tool buttons:

```
[Undo] [Redo] | [Select] [Hand] [Sticky] [Rect] [Circle] [Line] [Text] [Frame] [Connector] | [Duplicate] [Delete] | [AI]
```

- Undo icon: `Undo2` from lucide-react
- Redo icon: `Redo2` from lucide-react
- Disabled styling when stack is empty (same `disabled:text-[#555]` pattern as delete/duplicate)
- Tooltip shows keyboard shortcut: "Undo (Cmd+Z)" / "Redo (Cmd+Shift+Z)"

Props to add to Toolbar:
```typescript
type ToolbarProps = {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // ... existing props
};
```

### Keyboard shortcuts

In page.tsx, add hotkeys using the existing `useHotkey` pattern:

```typescript
useHotkey("mod+z", () => undo(), { enabled: !editingElementId });
useHotkey("mod+shift+z", () => redo(), { enabled: !editingElementId });
```

**Important:** These must be disabled when editing text (`editingElementId` is set) to avoid interfering with the textarea's native undo.

---

## File-by-File Change List

### `packages/shared/src/collab.ts`
- Add `export const WS_MESSAGE_AI_SYNC = 4;` after the existing WS message constants (line 5)

### `apps/backend/src/collab/room-manager.ts`
- Add `resumeBroadcastAsAi(roomId: string)` method — same as `resumeBroadcast` but uses `WS_MESSAGE_AI_SYNC` and `encoding.writeVarUint8Array` instead of `syncProtocol.writeUpdate`
- Import `WS_MESSAGE_AI_SYNC` from shared

### `apps/backend/src/ai/handler.ts`
- Change `roomManager?.resumeBroadcast(roomId)` to `roomManager?.resumeBroadcastAsAi(roomId)` (two places: success path ~L69 and error recovery path ~L89)

### `apps/frontend/src/lib/collab.ts`
- Import `WS_MESSAGE_AI_SYNC` from shared
- Add handler in `socket.onmessage` for `WS_MESSAGE_AI_SYNC`: read the update via `decoding.readVarUint8Array(decoder)` and apply with `Y.applyUpdate(doc, update, "ai-mutation")`

### `apps/frontend/src/app/canvas/[roomId]/page.tsx`

This is the largest change. Every Yjs mutation site needs the `"local"` origin.

**Add UndoManager setup:**
- `undoManagerRef` — ref to `Y.UndoManager`
- Create in the connection effect, destroy on cleanup
- `canUndo` / `canRedo` state with `stack-item-added` / `stack-item-popped` listeners
- `undo()` / `redo()` callbacks

**Wrap element creation in `doc.transact(() => {...}, "local")`:**
- `createStickyNote` (~L508)
- `createRectangleDraft` (~L536)
- `createCircleDraft` (~L560)
- `createLineDraft` (~L584)
- `createTextElement` (~L609)
- `createFrameDraft` (~L638)
- `createConnectorDraft` (~L681)

**Add `"local"` origin to existing transactions:**
- `moveConnectorEndpoint` (~L736)
- `finalizeConnectorEndpoint` (~L772)
- `moveElement` (~L837, ~L883)
- `moveSelectedElements` (~L934)
- `flushPendingDragMove` (~L986) — change origin from `"element-drag-move"` to `"local"`
- `flushPendingGroupDragMove` (~L1052) — change origin from `"group-drag-move"` to `"local"`
- `flushPendingResize` (~L1090)
- `flushPendingRotate` (~L1119)
- `moveLineEndpoint` (~L1200)
- `deleteElement` (~L1228)
- `dissolveFrame` (~L1249)
- `deleteSelectedElements` (~L1288)
- `duplicateSelectedElements` (~L1357)
- `pasteElements` (~L1480)
- `updateElementProperty` (~L1621)
- `applyEditingTextToYjs` (~L1674)

**Add `"perf-test"` origin** to the synthetic perf test transaction (~L475) so it isn't tracked by UndoManager.

**Add hotkeys:**
- `mod+z` → `undo()` (disabled during text editing)
- `mod+shift+z` → `redo()` (disabled during text editing)

**Pass props to Toolbar:** `onUndo`, `onRedo`, `canUndo`, `canRedo`

### `apps/frontend/src/components/board/toolbar.tsx`
- Import `Undo2`, `Redo2` from lucide-react
- Add `onUndo`, `onRedo`, `canUndo`, `canRedo` to `ToolbarProps`
- Render undo/redo buttons before the tool buttons, separated by a divider

---

## Edge Cases

### Undo delete when another user moved the element
Yjs UndoManager restores the element to its state at deletion time, not accounting for hypothetical moves that didn't happen. If user A deletes an element and user B had moved it before the delete, the undo restores it at the position where A deleted it (which includes B's move). This is correct behavior.

### Undo frame creation (frame + children assigned later)
If user A creates a frame and user B drags elements into it, undoing A's frame creation removes the frame but the children's `frameId` now points to a non-existent frame. The `useYjsElements` hook already handles this gracefully — elements with invalid frameId just render without a parent. No special handling needed.

### Connector endpoint resolution after undo
When undoing the deletion of a shape that had connectors, the shape reappears and `resolveEndpoints()` in the connector rendering will re-anchor to it automatically since it re-reads `fromId`/`toId` on every render. No special handling needed.

### Undo AI mutation (multi-element atomic)
The entire AI tool call result arrives as one merged Yjs update applied in a single transaction with origin `"ai-mutation"`. UndoManager records this as one stack item. A single Cmd+Z removes all elements the AI created. This is the desired behavior.

### Undo during text editing
Cmd+Z while a textarea is focused should use the browser's native textarea undo, not Yjs undo. The hotkey is disabled when `editingElementId` is set. The Yjs UndoManager still tracks the text changes (via `applyEditingTextToYjs`), so after the user finishes editing and clicks away, Cmd+Z will undo the text change as a whole.

### Redo after a new action
Standard UndoManager behavior: performing a new action clears the redo stack. If you undo 3 times and then make a new edit, you can't redo those 3 undone actions anymore.

### Performance test writes
The synthetic resize in the perf test (~L475) should use origin `"perf-test"` so it's not tracked by UndoManager. Otherwise perf test data would pollute the undo stack.

---

## Testing

### Manual smoke test
1. Create a sticky note → Cmd+Z removes it → Cmd+Shift+Z brings it back
2. Drag an element → Cmd+Z returns it to original position (one step, not per-pixel)
3. Resize → Cmd+Z restores original size
4. Rotate → Cmd+Z restores original rotation
5. Type text, pause, type more → Cmd+Z undoes second typing burst, Cmd+Z again undoes first burst
6. Delete 3 elements → one Cmd+Z restores all 3
7. Ask AI to create SWOT → Cmd+Z removes entire SWOT diagram
8. Two users: User A creates, User B creates → User A's Cmd+Z only undoes User A's work
9. Toolbar buttons: disabled when nothing to undo/redo, enabled after actions

### Automated (optional, stretch)
- Playwright test: create element, undo, verify element count
- Playwright test: two sessions, verify undo isolation
