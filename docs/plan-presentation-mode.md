# Presentation Mode — Implementation Plan

## Overview

Add a presentation mode that turns frames on the canvas into an ordered slide deck. Users open a setup panel, drag frames into their preferred order, then enter presentation mode where the camera smoothly animates from frame to frame. The slide order is stored in Yjs so all collaborators share the same deck.

When one user is presenting, other users in presentation mode follow along by default, with the ability to detach and browse independently, then reattach.

---

## Data Model

### Slide order in Yjs

Store the ordered slide deck in `doc.getArray("slideOrder")` — a `Y.Array<string>` of frame IDs.

```
doc.getMap("elements")    ← existing: all board elements
doc.getArray("slideOrder") ← new: ordered list of frame IDs for presentation
```

- When a user adds a frame to the deck, its ID is pushed to the array.
- Reordering moves the ID within the array (delete + insert).
- Removing a slide deletes the ID from the array.
- This is a Yjs shared type, so changes sync to all clients in real-time.
- Frames not in the array are excluded from the presentation.

### Cleanup on frame deletion

When a frame is deleted (in `deleteElement` or `deleteSelectedElements`), its ID must be removed from `slideOrder` if present. Add a cleanup step in both delete functions.

### No schema change needed

No new element types or properties are needed. The slide order is a separate top-level Yjs structure, independent of the elements map.

---

## Camera Animation System

### Easing function

Use cubic ease-in-out for smooth acceleration/deceleration:

```typescript
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

### Frame-to-camera calculation

Given a frame's bounding box and the viewport dimensions, compute the camera position that centers the frame with padding:

```typescript
function frameToCamera(
  frame: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding = 64
): Camera {
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const scale = clamp(
    Math.min(availableWidth / frame.width, availableHeight / frame.height),
    MIN_SCALE,
    MAX_SCALE
  );
  return {
    x: viewport.width / 2 - (frame.x + frame.width / 2) * scale,
    y: viewport.height / 2 - (frame.y + frame.height / 2) * scale,
    scale,
  };
}
```

This follows the same pattern as the existing `zoomToSelection` function (page.tsx ~L1527).

### Animation loop

```typescript
function animateCamera(
  from: Camera,
  to: Camera,
  applyCameraDirect: (cam: Camera) => void,
  setCameraState: (cam: Camera) => void,
  duration = 600,
  onComplete?: () => void
): () => void {
  const start = performance.now();
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    const cam: Camera = {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
    };
    applyCameraDirect(cam);

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      setCameraState(to);
      onComplete?.();
    }
  };

  requestAnimationFrame(tick);

  return () => { cancelled = true; };
}
```

Returns a cancel function so we can abort if the user navigates before the animation completes. The animation applies camera changes via `applyCameraDirect` (page.tsx ~L165) for smooth 60fps updates, and syncs React state with `setCameraState` only at the end.

---

## Presentation Panel (Setup UI)

### Component: `apps/frontend/src/components/board/presentation-panel.tsx`

A slide-out panel on the right side of the canvas, similar to the AI chat panel pattern. Toggled by a button in the toolbar.

### Layout

```
┌──────────────────────────────────────────┐
│ Presentation                        [X]  │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  1  Frame Title A            [x] │    │  ← draggable card
│  └──────────────────────────────────┘    │
│  ┌──────────────────────────────────┐    │
│  │  2  Frame Title B            [x] │    │
│  └──────────────────────────────────┘    │
│  ┌──────────────────────────────────┐    │
│  │  3  Frame Title C            [x] │    │
│  └──────────────────────────────────┘    │
│                                          │
│  + Add all frames                        │
│                                          │
├──────────────────────────────────────────┤
│          [ ▶ Present ]                   │
└──────────────────────────────────────────┘
```

### Functionality

- **Frame list**: Shows frames currently in `slideOrder`, in order, as draggable cards.
- **Each card**: Shows slide number (1-indexed), frame title, and a remove button (X icon).
- **Drag to reorder**: HTML drag-and-drop on the cards. On drop, update the Y.Array (delete from old index, insert at new index inside a `doc.transact()`).
- **Remove slide**: Click the X → remove frame ID from Y.Array.
- **"Add all frames" button**: Collects all frame element IDs from the elements list (that aren't already in slideOrder), appends them to the Y.Array. Order: by Y position (top-to-bottom), then X position (left-to-right) — a natural reading order.
- **"Present" button**: Enters presentation mode (sets `presentationMode: true` in component state, navigates to slide 0).
- **Empty state**: When no frames exist on the board, show a message: "Add frames to the canvas to create slides."
- **Real-time sync**: The frame list reactively updates when `slideOrder` changes (other users adding/removing/reordering). Use `Y.Array.observe()` to watch for changes and re-read the array.

### Props

```typescript
type PresentationPanelProps = {
  open: boolean;
  onClose: () => void;
  elements: BoardElement[];
  doc: Y.Doc | null;
  onStartPresentation: (slideOrder: string[]) => void;
};
```

### Observing slideOrder

Inside the panel component, set up a `Y.Array.observe()` listener to track changes:

```typescript
const [slides, setSlides] = useState<string[]>([]);

useEffect(() => {
  if (!doc) return;
  const slideOrder = doc.getArray<string>("slideOrder");

  const updateSlides = () => {
    setSlides(slideOrder.toArray());
  };
  updateSlides();
  slideOrder.observe(updateSlides);

  return () => slideOrder.unobserve(updateSlides);
}, [doc]);
```

---

## Presentation Overlay (During Presentation)

### Component: `apps/frontend/src/components/board/presentation-overlay.tsx`

A fullscreen overlay rendered when `presentationMode === true`. It sits on top of all other UI (z-50) but keeps the canvas visible underneath.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                                                          │
│                    (canvas visible)                       │
│                                                          │
│                                                          │
│  ┌──────┐                                    ┌──────┐   │
│  │  ←   │                                    │  →   │   │
│  └──────┘                                    └──────┘   │
│                                                          │
│              3 / 7                          [Exit]       │
└──────────────────────────────────────────────────────────┘
```

### Controls

- **Left/Right arrow buttons**: Navigate to previous/next slide. Positioned at left and right edges, vertically centered.
- **Slide counter**: "3 / 7" centered at the bottom.
- **Exit button**: Top-right corner, exits presentation mode.
- **Keyboard navigation**:
  - `ArrowRight` or `Space` → next slide
  - `ArrowLeft` → previous slide
  - `Escape` → exit presentation mode
- **Click anywhere on canvas**: advance to next slide (optional, common in presentation tools)

### Visual treatment

- Semi-transparent dark vignette at edges to draw focus to the frame content.
- Controls are subtle (low opacity, brighten on hover) so they don't distract.
- All other UI (toolbar, header, selection toolbar, AI panel) is hidden during presentation mode.

### Props

```typescript
type PresentationOverlayProps = {
  slides: string[];
  currentSlide: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  isFollowing: boolean;
  presenterName?: string;
  onReattach?: () => void;
};
```

### Following indicator

When the user is following a presenter:
- A small banner at the top: "Following [Presenter Name]" with a "Stop following" button.
- When detached (user clicked prev/next manually): banner changes to "Not following — [Reattach]" button.

---

## Collaborative Behavior

### Broadcasting presenter state

When a user enters presentation mode and is the first to present (or explicitly "starts" presenting), they broadcast their state via the existing presence protocol.

Extend the presence payload in `collab.ts`:

```typescript
// Current payload:
{
  clientId: number;
  user: PresenceUser;
  cursor: { x: number; y: number } | null;
}

// Extended payload:
{
  clientId: number;
  user: PresenceUser;
  cursor: { x: number; y: number } | null;
  presenting?: {
    slideIndex: number;
    slideOrder: string[];  // frame IDs so followers know the deck
  };
}
```

The `presenting` field is only set when the user is in presentation mode. When they exit, they send a presence update without the field (or with `presenting: undefined`).

### Follower behavior

When another user enters presentation mode and detects a presenter (via presence):

1. **Auto-follow**: Camera animates to the presenter's current slide.
2. **On presenter advance**: Camera animates to the new slide.
3. **Detach**: If the follower clicks a navigation control (prev/next), they stop following. A "Follow [Name]" button appears.
4. **Reattach**: Clicking the "Follow [Name]" button re-syncs to the presenter's current slide and resumes auto-following.
5. **Presenter exits**: All followers see a "Presentation ended" message and can choose to exit or continue browsing.

### State machine for a user in presentation mode

```
                    ┌─────────────┐
   enter present    │  PRESENTING │ ← broadcasts slideIndex
   (first or solo)  │  (is host)  │
                    └──────┬──────┘
                           │ exit
                           ▼
                       (normal mode)

                    ┌─────────────┐
   enter present    │  FOLLOWING  │ ← auto-syncs to presenter's slide
   (presenter exists)│            │
                    └──────┬──────┘
                           │ click prev/next
                           ▼
                    ┌─────────────┐
                    │  DETACHED   │ ← browsing independently
                    │             │
                    └──────┬──────┘
                           │ click "Follow"
                           ▼
                    ┌─────────────┐
                    │  FOLLOWING  │
                    └─────────────┘
```

### Implementation approach

The presence protocol already exists and is lightweight. Adding the `presenting` field to presence payloads is minimal — it's just extra JSON fields in the same message.

On the receiving side (page.tsx), when rendering remote presence data, check for the `presenting` field to determine if a presenter exists. Store this in local React state:

```typescript
const [activePresenter, setActivePresenter] = useState<{
  clientId: number;
  userName: string;
  slideIndex: number;
  slideOrder: string[];
} | null>(null);
```

Update this whenever a presence message arrives with `presenting` data.

---

## Slide Number Badges on Frames

### Visibility rule

Badges are shown **only** to the user who has the presentation panel open. This is purely local UI state — no Yjs or presence needed.

### Rendering

In the page component's overlay section (where selection toolbar, text editing overlay, etc. are rendered), add a badge overlay:

```typescript
{presentationPanelOpen && slides.map((frameId, index) => {
  const frame = elements.find(el => el.id === frameId && el.type === "frame");
  if (!frame) return null;

  const screenX = frame.x * camera.scale + camera.x;
  const screenY = frame.y * camera.scale + camera.y;

  return (
    <div
      key={frameId}
      className="absolute z-25 pointer-events-none"
      style={{
        left: screenX - 12,
        top: screenY - 12,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shadow-md">
        {index + 1}
      </div>
    </div>
  );
})}
```

The badge is a small blue circle with the slide number, positioned at the top-left corner of each frame.

---

## State Management

### Local state in page.tsx

```typescript
const [presentationPanelOpen, setPresentationPanelOpen] = useState(false);
const [presentationMode, setPresentationMode] = useState(false);
const [currentSlide, setCurrentSlide] = useState(0);
const [presentationSlides, setPresentationSlides] = useState<string[]>([]);
const [isFollowing, setIsFollowing] = useState(false);
const cancelAnimationRef = useRef<(() => void) | null>(null);
```

### Starting presentation

When the user clicks "Present" in the panel:

1. Read `slideOrder` from Yjs into `presentationSlides`.
2. Set `presentationMode = true`, `currentSlide = 0`.
3. Close the presentation panel.
4. Hide all non-presentation UI (toolbar, header, selection toolbar, AI panel).
5. Animate camera to the first frame.
6. Broadcast presenting state via presence.

### Navigating slides

```typescript
const goToSlide = useCallback((index: number) => {
  if (index < 0 || index >= presentationSlides.length) return;

  // Cancel any in-flight animation
  cancelAnimationRef.current?.();

  const frameId = presentationSlides[index];
  const frame = elements.find(el => el.id === frameId && el.type === "frame");
  if (!frame) return;

  const surface = surfaceRef.current;
  if (!surface) return;
  const viewport = surface.getBoundingClientRect();

  const targetCam = frameToCamera(frame, viewport);
  const fromCam = cameraRef.current;

  cancelAnimationRef.current = animateCamera(
    fromCam,
    targetCam,
    applyCameraDirect,
    setCameraState,
    600
  );

  setCurrentSlide(index);

  // Broadcast to followers if presenting
  // (via presence update with slideIndex)
}, [presentationSlides, elements, applyCameraDirect, setCameraState]);
```

### Exiting presentation

1. Set `presentationMode = false`.
2. Cancel any in-flight animation.
3. Broadcast presence update without `presenting` field.
4. Show all UI again.
5. Don't change camera position (user stays where they are).

---

## File-by-File Change List

### New files

#### `apps/frontend/src/components/board/presentation-panel.tsx`
New component. Slide-out panel for managing the slide deck.
- Renders the ordered list of frames from `slideOrder`.
- Drag-to-reorder cards.
- Add all frames / remove individual slides.
- "Present" button to start.
- Observes `doc.getArray("slideOrder")` for real-time sync.

#### `apps/frontend/src/components/board/presentation-overlay.tsx`
New component. Fullscreen overlay during presentation mode.
- Prev/next navigation buttons.
- Slide counter.
- Exit button.
- Following/detached banner.
- Keyboard event handlers (arrow keys, Escape).

#### `apps/frontend/src/lib/camera-animation.ts`
New utility file. Exports:
- `easeInOutCubic(t: number): number`
- `frameToCamera(frame, viewport, padding?): Camera`
- `animateCamera(from, to, apply, set, duration?, onComplete?): cancelFn`

### Modified files

#### `packages/shared/src/collab.ts`
- Add `presenting` field to the presence payload type (optional).
- No new message types needed — uses existing presence protocol.

#### `apps/frontend/src/lib/collab.ts`
- Extend `publishPresence` to accept optional `presenting` data.
- Extend the presence payload parsing in `onmessage` to include the `presenting` field.
- Extend the `PresenceState` type or the presence callback to include presentation state.

#### `apps/frontend/src/app/canvas/[roomId]/page.tsx`
- Add state: `presentationPanelOpen`, `presentationMode`, `currentSlide`, `presentationSlides`, `isFollowing`, `cancelAnimationRef`, `activePresenter`.
- Add `goToSlide`, `startPresentation`, `exitPresentation` callbacks.
- Conditionally hide header, toolbar, selection toolbar, AI panel when `presentationMode` is true.
- Render `PresentationPanel` in the overlay area (next to AI chat panel).
- Render `PresentationOverlay` when `presentationMode` is true.
- Render slide number badges when `presentationPanelOpen` is true.
- Handle `activePresenter` from presence data — auto-follow logic.
- Clean up frame deletion to also remove from `slideOrder`.

#### `apps/frontend/src/components/board/toolbar.tsx`
- Add a presentation toggle button (icon: `Presentation` or `Play` from lucide-react).
- New props: `presentationOpen: boolean`, `onPresentationToggle: () => void`.
- Place after the AI chat button, separated by a divider.

#### `apps/frontend/src/hooks/use-yjs-elements.ts`
No changes needed. The hook only observes `doc.getMap("elements")`. The `slideOrder` array is observed separately in the presentation panel.

---

## Edge Cases

### Frame deleted while in slide order
When `deleteElement` or `deleteSelectedElements` removes a frame, also remove its ID from `doc.getArray("slideOrder")`. Iterate the array, find the index, and call `slideOrder.delete(index, 1)` inside the same transaction.

### Frame deleted during presentation
If the current slide's frame is deleted by another user while presenting:
- Detect that the frame no longer exists when trying to navigate.
- Skip to the next valid slide, or exit if no slides remain.

### Slide order modified during presentation
If another user reorders slides while someone is presenting:
- The follower's view updates because `presentationSlides` is re-read from presence (the presenter broadcasts the order).
- The presenter's local `presentationSlides` was set at start time and doesn't change mid-presentation. This is intentional — reordering while someone is presenting shouldn't disrupt them. They can exit and re-enter to pick up the new order.

### No frames on the board
The presentation panel shows an empty state message. The "Present" button is disabled.

### Single frame
Presentation works with one slide. Prev/next buttons are disabled (or loop, if desired). The camera animates to that single frame.

### Very large or very small frames
The `frameToCamera` function clamps the scale between `MIN_SCALE` (0.2) and `MAX_SCALE` (3), same as normal zoom limits. Very large frames will zoom out to fit; very small frames will zoom in but not past 3x.

### Hidden frames
Hidden frames (the existing `hidden` toggle on frames) should be excluded from the "Add all frames" action. They can still be manually added to the deck if the user wants.

### Multiple presenters
If two users both start presenting, each broadcasts their own `presenting` state. Other users see the most recently received presenter. For simplicity, only one presenter is tracked at a time (last-write-wins on presence). If needed, this could be extended to show a list of active presenters.

### Performance
Camera animation runs at 60fps via `requestAnimationFrame` using `applyCameraDirect` (which bypasses React state updates during the animation). Only the final position triggers a React state update. This follows the same pattern as the existing perf test camera animation (~L422 in page.tsx).

---

## Testing

### Manual smoke test
1. Create 3 frames on the canvas with content in each.
2. Open the presentation panel — verify all 3 frames are listable.
3. Click "Add all frames" — verify they appear in reading order (top-to-bottom, left-to-right).
4. Drag to reorder — verify order updates.
5. Click "Present" — verify camera animates to first frame.
6. Press right arrow — camera animates to second frame. Slide counter shows "2 / 3".
7. Press Escape — exits presentation mode, all UI returns.
8. Two users: User A presents, User B enters presentation mode — B follows A's slides.
9. User B clicks next — B detaches, sees "Follow [A]" button.
10. B clicks "Follow" — B reattaches and jumps to A's current slide.
11. Delete a frame while it's in the slide order — verify it's removed from the deck.
12. Verify slide badges appear on frames when the panel is open.
