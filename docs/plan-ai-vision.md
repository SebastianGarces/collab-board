# AI Vision: Photo-to-Board Recreation — Implementation Plan

## Overview

Add multi-modal AI vision capability: users upload, paste, or drag-and-drop a photo of a whiteboard, diagram, or sketch into the AI chat panel. The vision model (Gemini Flash or GPT) analyzes the image and recreates the content digitally on the canvas using the existing tool infrastructure. No new tools, no persistent storage, no new HTTP endpoints — the image flows through the existing WebSocket AI command pipeline as a base64 data URL.

---

## Architecture

The image is resized on the client (max 1024px), encoded as base64 PNG, and sent as an optional field on the existing `AiChatRequest` over the same WebSocket binary protocol. The backend extracts it and builds a multimodal `HumanMessage` (text + image) for LangChain. The model sees the image, calls existing tools (`batchCreateElements`, `createDiagram`, `createColumnLayout`, `createQuadrant`, etc.), and the normal Yjs mutation + broadcast flow handles the rest.

```
User drops/selects image in AI chat panel
  → Client resizes to max 1024px, converts to base64 PNG
  → AiChatRequest { prompt, imageDataUrl } sent via WS (lib0 binary)
  → Backend ai/handler.ts extracts image, passes to agent
  → agent.ts builds HumanMessage with [text, image_url] content array
  → Vision model analyzes image + calls tools to recreate elements
  → Normal Yjs mutations + AiChatResponse flow
```

### Key Design Decisions

1. **No HTTP upload endpoint.** The image is base64-encoded and travels through the existing WS binary protocol as part of `AiChatRequest`. This avoids a second transport channel, keeps auth simple (WS is already authenticated), and avoids needing temporary file storage. A 1024px PNG is ~200–500KB base64, well within WS frame limits.

2. **Client-side resize before encoding.** Uses an HTML `<canvas>` element to resize to max 1024px on longest side and export as PNG. This keeps the payload small and matches what vision models need (they downsample internally anyway). No server-side image processing (sharp, etc.) needed.

3. **Single-phase vision + tools.** The image is passed directly to the tool-calling agent — not a separate "analyze then act" pipeline. Both Gemini 2.0 Flash and GPT support vision + function calling in the same turn. The model sees the image, decides what tools to call, and executes them in the same agent loop.

4. **Vision-specific system prompt addendum.** When `imageDataUrl` is present, a concise block is appended to the existing `SYSTEM_PROMPT` instructing the model to analyze the image and map its content to board tools. The base prompt and all existing rules remain unchanged.

5. **No changes to tools.ts.** The existing tools (`batchCreateElements`, `createDiagram`, `createColumnLayout`, `createQuadrant`, etc.) handle all element creation patterns. The vision model uses them identically to how it handles text commands.

---

## Change 1: Shared Types

**File:** `packages/shared/src/collab.ts`

Add an optional `imageDataUrl` field to the existing `AiChatRequest` type.

### Current code (lines 15–21):

```typescript
export type AiChatRequest = {
  type: "ai_request";
  id: string;
  prompt: string;
  conversationHistory?: AiConversationMessage[];
  selectedElementIds?: string[];
};
```

### Target code:

```typescript
export type AiChatRequest = {
  type: "ai_request";
  id: string;
  prompt: string;
  conversationHistory?: AiConversationMessage[];
  selectedElementIds?: string[];
  imageDataUrl?: string;
};
```

This is the only shared type change. The `AiChatResponse` type is unchanged — the response for a vision command looks the same as any other AI command (text summary + tool call badges + created element IDs).

---

## Change 2: Image Resize Utility

**File:** `apps/frontend/src/lib/image-utils.ts` (new file)

Create a utility that takes a `File`, validates it, resizes it, and returns a base64 data URL.

```typescript
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_RAW_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function resizeImageToDataUrl(
  file: File,
  maxSize = 1024
): Promise<string> {
  // 1. Validate MIME type
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type}. Use PNG, JPEG, WebP, or GIF.`);
  }

  // 2. Validate raw file size
  if (file.size > MAX_RAW_FILE_SIZE) {
    throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`);
  }

  // 3. Load into an Image element
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // 4. Compute scaled dimensions (preserve aspect ratio)
  let targetW = width;
  let targetH = height;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    targetW = Math.round(width * ratio);
    targetH = Math.round(height * ratio);
  }

  // 5. Draw onto off-screen canvas
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // 6. Export as data URL
  //    Use JPEG 0.85 for photos (smaller payload), PNG for anything else
  const isPhoto = file.type === "image/jpeg" || file.type === "image/webp";
  return isPhoto
    ? canvas.toDataURL("image/jpeg", 0.85)
    : canvas.toDataURL("image/png");
}
```

### Why this design

- `createImageBitmap` is faster and more memory-efficient than loading via `new Image()` + `onload` callback.
- JPEG 0.85 for photos keeps base64 under ~200KB for a 1024px image. PNG for screenshots/diagrams preserves sharp edges.
- The 10MB raw limit prevents accidentally loading huge files into memory. The vision model doesn't benefit from more than 1024px.

---

## Change 3: AI Chat Panel UI

**File:** `apps/frontend/src/components/board/ai-chat-panel.tsx`

This is the largest frontend change. Three new capabilities: image attachment button, drag-and-drop, and clipboard paste.

### 3a. New imports

Add at the top:

```typescript
import { ImagePlus, X as XIcon } from "lucide-react"; // ImagePlus is new
import { resizeImageToDataUrl } from "@/lib/image-utils";
```

(`X` is already imported — rename to `XIcon` if there's a conflict, or keep using the existing `X` import for both the close button and the remove-image button.)

### 3b. New state

Inside the `AiChatPanelInner` component, add:

```typescript
const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; fileName: string } | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
const [isDragOver, setIsDragOver] = useState(false);
```

### 3c. Image attachment handler

A shared handler that all three input methods (button, drop, paste) funnel into:

```typescript
const attachImage = useCallback(async (file: File) => {
  try {
    const dataUrl = await resizeImageToDataUrl(file);
    setAttachedImage({ dataUrl, fileName: file.name });
  } catch (err) {
    // Show error inline — could set a temporary error message in state
    console.error("[ai-chat] Image attach failed:", err);
  }
}, []);
```

### 3d. Props change

Update the `AiChatPanelProps` type to accept `imageDataUrl`:

```typescript
type AiChatPanelProps = {
  open: boolean;
  onClose: () => void;
  onSendMessage: (
    prompt: string,
    conversationHistory?: AiConversationMessage[],
    selectedElementIds?: string[],
    imageDataUrl?: string
  ) => string;
};
```

### 3e. Update ChatMessage type

Add an optional image thumbnail to chat messages so user messages with images display a preview:

```typescript
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCallSummary?: AiToolCallSummary[];
  error?: string;
  pending?: boolean;
  imageDataUrl?: string; // thumbnail for user messages with images
};
```

### 3f. Update handleSend

Modify the existing `handleSend` function. Key changes:

1. If there's an attached image but no text, use a default prompt.
2. Pass `imageDataUrl` to `onSendMessage`.
3. Store the image data URL on the user message for display.
4. Clear the attached image after sending.

```typescript
const handleSend = useCallback((overridePrompt?: string) => {
  const prompt = (overridePrompt ?? input).trim();
  const hasImage = attachedImage !== null;

  // Allow sending with just an image (no text)
  if (!prompt && !hasImage) return;

  const finalPrompt = prompt || "Recreate the content from this image on the board";

  const history: AiConversationMessage[] = messages
    .filter((m) => !m.pending && m.text)
    .map((m) => {
      let content = m.text;
      if (m.role === "assistant" && m.toolCallSummary?.length) {
        const actions = m.toolCallSummary.map(formatToolSummary).join(", ");
        content = `${content} [Actions: ${actions}]`;
      }
      return { role: m.role, content };
    })
    .slice(-10);

  const selectionIds = selectedElementIds.size > 0 ? Array.from(selectedElementIds) : undefined;
  const messageId = onSendMessage(
    finalPrompt,
    history.length > 0 ? history : undefined,
    selectionIds,
    hasImage ? attachedImage.dataUrl : undefined  // <-- new parameter
  );
  if (!messageId) return;

  const responseId = `${messageId}-response`;
  setMessages((prev) => [
    ...prev,
    {
      id: messageId,
      role: "user",
      text: finalPrompt,
      imageDataUrl: hasImage ? attachedImage.dataUrl : undefined,  // <-- store for display
    },
    {
      id: responseId,
      role: "assistant",
      text: "",
      pending: true,
    },
  ]);

  if (!overridePrompt) {
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }
  setAttachedImage(null);  // <-- clear attachment
  scrollToBottom();

  // ... existing timeout logic unchanged ...
}, [input, messages, onSendMessage, scrollToBottom, selectedElementIds, clearPendingTimeout, attachedImage]);
```

### 3g. Pending message text

When rendering the pending assistant message, show "Analyzing image..." instead of "Thinking..." if the preceding user message had an image. The simplest way: check if the user message right before the pending message had `imageDataUrl`. Alternatively, store a flag on the pending message itself.

Simplest approach — update the pending render:

```typescript
{msg.pending ? (
  <div className="flex items-center gap-2 text-[#888]">
    <Loader2 className="h-3 w-3 animate-spin" />
    <span>
      {messages.find((m) => m.id === msg.id.replace("-response", ""))?.imageDataUrl
        ? "Analyzing image..."
        : "Thinking..."}
    </span>
  </div>
) : /* ... existing ... */}
```

### 3h. User message image thumbnail

When rendering user messages, show a small thumbnail if `imageDataUrl` is present:

```typescript
{msg.role === "user" && msg.imageDataUrl && (
  <img
    src={msg.imageDataUrl}
    alt="Attached"
    className="rounded-md max-h-32 max-w-full mt-1"
  />
)}
```

Place this inside the user message bubble `<div>`, after the text.

### 3i. Image preview strip (above input area)

When an image is attached but not yet sent, show a preview strip between the selected-elements badge and the input row:

```typescript
{attachedImage && (
  <div className="flex items-center gap-2 mb-2 px-0.5">
    <img
      src={attachedImage.dataUrl}
      alt="Preview"
      className="h-12 w-12 rounded-md object-cover border border-[#333]"
    />
    <span className="text-xs text-[#999] truncate flex-1">{attachedImage.fileName}</span>
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 cursor-pointer"
      onClick={() => setAttachedImage(null)}
    >
      <X className="h-3 w-3" />
    </Button>
  </div>
)}
```

Insert this in the bottom input area, after the selected-elements badge and before the `<div className="flex items-end gap-2">` input row.

### 3j. Image button

Add an `ImagePlus` button next to the send button. Also add a hidden file input:

```typescript
<>
  <input
    ref={fileInputRef}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/gif"
    className="hidden"
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file) attachImage(file);
      e.target.value = "";  // reset so same file can be re-selected
    }}
  />
  <Button
    variant="ghost"
    size="icon"
    className="h-9 w-9 shrink-0 cursor-pointer"
    onClick={() => fileInputRef.current?.click()}
    disabled={attachedImage !== null}
  >
    <ImagePlus className="h-4 w-4" />
  </Button>
</>
```

Place the button to the left of the send button in the input row, so the layout becomes: `[textarea] [ImagePlus] [Send]`.

### 3k. Drag-and-drop support

Add drag-and-drop handlers to the main chat panel container div (the outermost `<div>` with `className="absolute top-4 right-4 ..."`):

```typescript
onDragOver={(e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer.types.includes("Files")) {
    setIsDragOver(true);
  }
}}
onDragLeave={(e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(false);
}}
onDrop={(e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(false);
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    attachImage(file);
  }
}}
```

Add a visual indicator when dragging over. Add `isDragOver` to the container's className:

```typescript
className={`absolute top-4 right-4 bottom-20 z-40 w-[380px] flex flex-col bg-[#1a1a1a] border rounded-xl shadow-2xl overflow-hidden ${
  isDragOver ? "border-blue-500/50 bg-blue-500/5" : "border-[#2a2a2a]"
}`}
```

### 3l. Clipboard paste support

Add an `onPaste` handler to the textarea:

```typescript
onPaste={(e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) attachImage(file);
      return;
    }
  }
  // If no image found, let the default paste behavior handle text
}}
```

### 3m. Add TOOL_LABELS entries for new compound tools

While here, add entries for `createQuadrant`, `createColumnLayout`, `createDiagram`, and `bulkCreateElements` to the `TOOL_LABELS` map if they're missing, so vision responses display nice badges:

```typescript
const TOOL_LABELS: Record<string, string> = {
  // ... existing entries ...
  createQuadrant: "Created quadrant",
  createColumnLayout: "Created columns",
  createDiagram: "Created diagram",
  bulkCreateElements: "Created",
};
```

---

## Change 4: Collab Connection

**File:** `apps/frontend/src/lib/collab.ts`

Update the `sendAiMessage` function to accept and forward `imageDataUrl`.

### Current code (lines 267–285):

```typescript
const sendAiMessage = (
  prompt: string,
  conversationHistory?: AiConversationMessage[],
  selectedElementIds?: string[]
): string => {
  const id = crypto.randomUUID();
  const request: AiChatRequest = {
    type: "ai_request",
    id,
    prompt,
    conversationHistory,
    selectedElementIds: selectedElementIds?.length ? selectedElementIds : undefined,
  };
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_AI);
  encoding.writeVarString(encoder, JSON.stringify(request));
  send(encoding.toUint8Array(encoder));
  return id;
};
```

### Target code:

```typescript
const sendAiMessage = (
  prompt: string,
  conversationHistory?: AiConversationMessage[],
  selectedElementIds?: string[],
  imageDataUrl?: string
): string => {
  const id = crypto.randomUUID();
  const request: AiChatRequest = {
    type: "ai_request",
    id,
    prompt,
    conversationHistory,
    selectedElementIds: selectedElementIds?.length ? selectedElementIds : undefined,
    imageDataUrl,
  };
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_AI);
  encoding.writeVarString(encoder, JSON.stringify(request));
  send(encoding.toUint8Array(encoder));
  return id;
};
```

Also update the return type of `createCollabConnection` to include the new parameter in the `sendAiMessage` signature. (Currently it's inferred, so this should happen automatically, but verify.)

---

## Change 5: Page Integration

**File:** `apps/frontend/src/app/canvas/[roomId]/page.tsx`

Update the `sendAiMessage` callback to pass through `imageDataUrl`.

### Current code (line ~1382):

```typescript
const sendAiMessage = useCallback((prompt: string, conversationHistory?: import("@collab/shared/collab").AiConversationMessage[], selectedElementIds?: string[]): string => {
  const connection = connectionRef.current;
  if (!connection) return "";
  return connection.sendAiMessage(prompt, conversationHistory, selectedElementIds);
}, []);
```

### Target code:

```typescript
const sendAiMessage = useCallback((
  prompt: string,
  conversationHistory?: import("@collab/shared/collab").AiConversationMessage[],
  selectedElementIds?: string[],
  imageDataUrl?: string
): string => {
  const connection = connectionRef.current;
  if (!connection) return "";
  return connection.sendAiMessage(prompt, conversationHistory, selectedElementIds, imageDataUrl);
}, []);
```

No other changes needed in page.tsx. The `AiChatPanel` component already receives `onSendMessage={sendAiMessage}` — the new parameter flows through automatically.

---

## Change 6: Backend AI Handler

**File:** `apps/backend/src/ai/handler.ts`

Two changes: validate the image payload and pass it to the agent.

### 6a. Validation

After parsing the request and checking for `request.type` / `request.prompt`, add image validation:

```typescript
// Validate image if present
if (request.imageDataUrl) {
  if (!request.imageDataUrl.startsWith("data:image/")) {
    const errorResponse: AiChatResponse = {
      type: "ai_response",
      id: request.id,
      text: "",
      toolCallSummary: [],
      error: "Invalid image format — expected a data:image/* URL",
    };
    socket.send(encodeAiResponse(errorResponse));
    return;
  }
  // Reject if base64 payload is too large (>2MB encoded)
  if (request.imageDataUrl.length > 2 * 1024 * 1024) {
    const errorResponse: AiChatResponse = {
      type: "ai_response",
      id: request.id,
      text: "",
      toolCallSummary: [],
      error: "Image too large — please use a smaller image",
    };
    socket.send(encodeAiResponse(errorResponse));
    return;
  }
}
```

Insert this after the `request.type !== "ai_request" || !request.prompt` check, but before `roomManager?.pauseBroadcast(roomId)`.

**Important:** Also update the prompt check. Currently we require `request.prompt` to be truthy. With vision, the user might send just an image with no text. So change:

```typescript
if (request.type !== "ai_request" || !request.prompt) {
```

to:

```typescript
if (request.type !== "ai_request" || (!request.prompt && !request.imageDataUrl)) {
```

The agent will use a default prompt ("Recreate the content from this image on the board") when no text is provided — but the handler should still allow the request through.

### 6b. Pass imageDataUrl to agent

Update the `handleAiCommand` call (line ~60):

```typescript
const result = await handleAiCommand({
  prompt: request.prompt || "Recreate the content from this image on the board",
  conversationHistory: request.conversationHistory,
  selectedElementIds: request.selectedElementIds,
  imageDataUrl: request.imageDataUrl,
  doc,
  userId,
  roomId,
});
```

---

## Change 7: Backend AI Agent

**File:** `apps/backend/src/ai/agent.ts`

This is the core backend change. Three modifications: args type, multimodal message assembly, and vision prompt.

### 7a. Update handleAiCommand args type

The `handleAiCommand` traceable function currently accepts:

```typescript
async (args: {
  prompt: string;
  conversationHistory?: AiConversationMessage[];
  selectedElementIds?: string[];
  doc: Y.Doc;
  userId: string;
  roomId: string;
})
```

Add `imageDataUrl`:

```typescript
async (args: {
  prompt: string;
  conversationHistory?: AiConversationMessage[];
  selectedElementIds?: string[];
  imageDataUrl?: string;
  doc: Y.Doc;
  userId: string;
  roomId: string;
})
```

Pass it through to `runAgentLoop`:

```typescript
return runAgentLoop(
  { prompt, conversationHistory, selectedElementIds, imageDataUrl },
  doc,
  elementsMap,
);
```

### 7b. Update runAgentLoop signature

```typescript
async function runAgentLoop(
  input: {
    prompt: string;
    conversationHistory?: AiConversationMessage[];
    selectedElementIds?: string[];
    imageDataUrl?: string;
  },
  doc: Y.Doc,
  elementsMap: Y.Map<unknown>,
): Promise<AgentResult> {
```

Pass it through to `traceMessageAssembly`:

```typescript
const allMessages: BaseMessage[] = await traceMessageAssembly(input, elementsMap);
```

### 7c. Update traceMessageAssembly

The `traceMessageAssembly` function builds the LangChain message array. It needs to:

1. Accept `imageDataUrl` in its input.
2. Build a multimodal `HumanMessage` when an image is present.
3. Append the vision prompt addendum to the system prompt.
4. Always compute the occupied region for vision requests.

#### Update the input type:

```typescript
const traceMessageAssembly = traceable(
  async (
    input: {
      prompt: string;
      conversationHistory?: AiConversationMessage[];
      selectedElementIds?: string[];
      imageDataUrl?: string;
    },
    elementsMap: Y.Map<unknown>,
  ): Promise<BaseMessage[]> => {
```

#### Update occupied region logic:

Replace:

```typescript
const occupiedRegion = promptLikelyNeedsOccupiedRegion(input.prompt)
  ? computeOccupiedRegion(elementsMap)
  : null;
```

With:

```typescript
const occupiedRegion = (input.imageDataUrl || promptLikelyNeedsOccupiedRegion(input.prompt))
  ? computeOccupiedRegion(elementsMap)
  : null;
```

#### Add vision prompt addendum:

After building `systemPrompt`, append the vision block when an image is present:

```typescript
let systemPrompt = occupiedRegion
  ? `${SYSTEM_PROMPT}\n\n${occupiedRegion}`
  : SYSTEM_PROMPT;

if (input.imageDataUrl) {
  systemPrompt += VISION_PROMPT_ADDENDUM;
}
```

#### Build multimodal user message:

Replace the final `HumanMessage` construction. Currently:

```typescript
return [
  new SystemMessage(systemPrompt),
  ...historyMessages,
  new HumanMessage(userContent),
];
```

Change to:

```typescript
const userMessage = input.imageDataUrl
  ? new HumanMessage({
      content: [
        { type: "text", text: userContent },
        {
          type: "image_url",
          image_url: { url: input.imageDataUrl },
        },
      ],
    })
  : new HumanMessage(userContent);

return [
  new SystemMessage(systemPrompt),
  ...historyMessages,
  userMessage,
];
```

Both `ChatOpenAI` and `ChatGoogle` in LangChain.js support this content format natively. The `image_url` content part accepts data URLs directly (no need to strip the `data:image/...;base64,` prefix).

### 7d. Vision prompt addendum

Add this constant near the `SYSTEM_PROMPT` constant:

```typescript
const VISION_PROMPT_ADDENDUM = `

VISION TASK: The user attached an image. Analyze it and recreate its content on the board using your tools.
- Identify all visual elements: sticky notes, shapes, text, arrows/connectors, frames/groups, labels.
- Preserve the spatial layout — map the image's relative positions to canvas coordinates starting from the SUGGESTED ORIGIN.
- Match colors as closely as possible using the available palettes listed above.
- Read and reproduce ALL visible text content accurately.
- For connected diagrams (flowcharts, org charts, trees, mind maps, state machines), use createDiagram with descriptive edge labels.
- For column-based layouts (kanban, retrospectives, journey maps), use createColumnLayout.
- For 2x2 quadrant layouts (SWOT, Eisenhower matrix, priority grids), use createQuadrant.
- For general mixed content, use batchCreateElements with frames to group related items.
- If the image shows a template or structured layout, pick the most appropriate compound tool rather than creating elements one by one.
- If you cannot identify something clearly, make your best guess rather than skipping it.
- The user's text prompt may provide additional instructions — follow them (e.g., "recreate this but add a marketing column").`;
```

### 7e. Agent step limit consideration

Vision commands may need more steps than usual if the model decides to use `getBoardState` + a creation tool. The current `MAX_AGENT_STEPS = 6` should be sufficient, but if testing reveals the model needs more steps for complex images, increase it. No change needed upfront.

---

## Image Input Methods Summary

All three methods funnel into the same `attachImage(file: File)` handler in the chat panel:

| Method | Trigger | Implementation |
|---|---|---|
| Button click | User clicks `ImagePlus` icon | Hidden `<input type="file" accept="image/*">` triggered by button click |
| Drag and drop | User drags image file onto chat panel | `onDragOver` / `onDrop` handlers on the chat panel container div |
| Clipboard paste | User presses Ctrl/Cmd+V with image in clipboard | `onPaste` handler on the textarea, reads `clipboardData.items` for `image/*` types |

---

## Example User Flows

### Flow 1 — Photo of physical whiteboard

1. User photographs their office whiteboard with sticky notes
2. Opens AI chat, drops the photo
3. Types "Recreate this whiteboard" (or just sends with no text — default prompt: "Recreate the content from this image on the board")
4. AI analyzes: 6 sticky notes in 2 columns, 1 heading text
5. AI calls `batchCreateElements` with frames + sticky notes
6. Digital version appears on canvas

### Flow 2 — Screenshot of a diagram

1. User has a flowchart screenshot from a PDF
2. Pastes it into the AI chat (Ctrl+V)
3. Types "Recreate this flowchart"
4. AI calls `createDiagram` with nodes and edges extracted from the image
5. Proper connected diagram with auto-layout appears

### Flow 3 — Hand-drawn sketch

1. User draws a rough wireframe on paper
2. Takes a photo, uploads via the image button
3. Types "Turn this sketch into a proper layout"
4. AI identifies boxes, labels, arrows and recreates with clean shapes

### Flow 4 — Mixed prompt + image

1. User uploads a screenshot of an org chart
2. Types "Recreate this org chart and add a Marketing department under the VP"
3. AI recreates the original chart via `createDiagram`, then modifies it with the addition

---

## Edge Cases and Validation

| Edge Case | Where Handled | Behavior |
|---|---|---|
| No prompt + image | Chat panel `handleSend` + handler.ts | Default prompt: "Recreate the content from this image on the board" |
| Image too large (>10MB raw file) | `resizeImageToDataUrl` in image-utils.ts | Throws error, caught by `attachImage`, logged to console |
| Base64 payload too large (>2MB encoded) | handler.ts validation | Returns error AiChatResponse before invoking agent |
| Invalid image MIME type | `resizeImageToDataUrl` validation | Throws error with descriptive message |
| Non-image file dropped | Chat panel `onDrop` handler | Ignored (checks `file.type.startsWith("image/")`) |
| Model fails to parse image | Normal agent flow | Model returns text response like "I couldn't identify clear content in this image" |
| Image with no recognizable board content | Normal agent flow | Model says so in its response |
| User removes image before sending | Chat panel state | `setAttachedImage(null)`, send proceeds as normal text command |
| Image + selected elements | Normal flow | Both `imageDataUrl` and `selectedElementIds` are passed — model gets both context sources |

---

## Files Changed (Summary)

| File | Change Type | Description |
|---|---|---|
| `packages/shared/src/collab.ts` | Modify | Add `imageDataUrl?: string` to `AiChatRequest` |
| `apps/frontend/src/lib/image-utils.ts` | New file | `resizeImageToDataUrl()` utility |
| `apps/frontend/src/components/board/ai-chat-panel.tsx` | Modify | Image attachment UI (button, drop, paste, preview), updated props and handleSend |
| `apps/frontend/src/lib/collab.ts` | Modify | Add `imageDataUrl` parameter to `sendAiMessage` |
| `apps/frontend/src/app/canvas/[roomId]/page.tsx` | Modify | Pass `imageDataUrl` through `sendAiMessage` callback |
| `apps/backend/src/ai/handler.ts` | Modify | Validate image, allow imageless prompt, pass `imageDataUrl` to agent |
| `apps/backend/src/ai/agent.ts` | Modify | Multimodal `HumanMessage`, vision prompt addendum, args type update |

---

## Implementation Order

1. **Shared types** — `packages/shared/src/collab.ts` (30 seconds, unblocks everything)
2. **Image utility** — `apps/frontend/src/lib/image-utils.ts` (standalone, no dependencies)
3. **Backend agent** — `apps/backend/src/ai/agent.ts` (args type + multimodal message + vision prompt)
4. **Backend handler** — `apps/backend/src/ai/handler.ts` (validation + passthrough)
5. **Collab client** — `apps/frontend/src/lib/collab.ts` (add parameter)
6. **Page integration** — `apps/frontend/src/app/canvas/[roomId]/page.tsx` (add parameter)
7. **Chat panel UI** — `apps/frontend/src/components/board/ai-chat-panel.tsx` (biggest change, needs 2+5+6 done)

Steps 2, 3, and 4 can be done in parallel. Steps 5 and 6 are trivial one-line changes. Step 7 is the main UI work.

---

## Testing

### Manual smoke test

1. **Button upload:** Click ImagePlus button → select a photo → verify preview shows → send → verify AI creates elements
2. **Drag and drop:** Drag an image file onto the chat panel → verify border highlight on dragover → verify preview shows on drop
3. **Clipboard paste:** Copy an image to clipboard (screenshot or right-click copy) → Ctrl+V in textarea → verify preview shows
4. **Remove before send:** Attach image → click X on preview → send text-only → verify no image sent
5. **No text + image:** Attach image → send with empty text → verify default prompt is used
6. **Image types:** Test with JPEG photo, PNG screenshot, WebP image
7. **Large image:** Test with a high-res photo (3000+ px) → verify it's resized (check network payload size in dev tools)
8. **Error handling:** Try uploading a non-image file (PDF, etc.) → verify it's rejected
9. **Vision accuracy:** Test with: photo of sticky notes on wall, screenshot of a flowchart, hand-drawn sketch
10. **Chat history:** Verify image messages display with thumbnail in chat history

### Performance considerations

- The base64 image only exists in memory during the request/response cycle — it's not persisted
- The resize step ensures payloads stay under ~500KB
- No impact on Yjs sync, canvas rendering, or cursor performance
- The agent timeout (`GENERATE_TIMEOUT_MS = 30000`) should be sufficient for vision commands (they may take slightly longer than text-only commands due to image processing on the model side)
- The chat panel timeout (`AI_RESPONSE_TIMEOUT_MS = 60000`) provides additional buffer

---

## Build Checklist Update

After implementation, add a new row to the "AI Board Agent" table in `docs/build-checklist.md`:

```
| 19 | AI Vision: image-to-board recreation | [x] Done | Upload/paste/drop image, vision model recreates on canvas |
```
