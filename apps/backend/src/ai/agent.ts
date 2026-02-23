
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGoogle } from "@langchain/google";
import { ChatOpenAI } from "@langchain/openai";
import { traceable } from "langsmith/traceable";
import * as Y from "yjs";

import type { AiConversationMessage, AiToolCallSummary } from "@collab/shared/collab";
import { createBoardTools } from "./tools";

const MAX_HISTORY_MESSAGES = 6;
const MAX_AGENT_STEPS = 6;
const GENERATE_TIMEOUT_MS = 30_000;

type ModelProvider = "openai" | "gemini";
const AI_PROVIDER: ModelProvider = (process.env.AI_PROVIDER as ModelProvider) ?? "gemini";

console.log(`AI_PROVIDER: ${AI_PROVIDER}`);

const SYSTEM_PROMPT = `AI assistant for a collaborative whiteboard. Create, modify, organize elements on an infinite canvas.

COORDINATES: (0,0) top-left. X→right, Y→down. Viewport ~1200x800.
ELEMENTS: sticky-note 200x200 | rectangle 200x150 | circle 150x150 | text 200x40 | frame 400x300 | line (x,y → endX,endY)
COLORS — Sticky: #facc15 #f472b6 #60a5fa #4ade80 #c084fc #fb923c | Shapes: #ffffff #d4d4d4 #facc15 #f472b6 #60a5fa #4ade80 #c084fc #fb923c #f87171 #2dd4bf

RULES:
1. Act immediately. Use defaults (random colors, viewport-center, standard sizes). Ask only when genuinely ambiguous.
2. Tool calls only — no planning text.
3. batchModifyElements: objectId + changed fields only. Move: objectId+x+y. Recolor: objectId+color. Frame titles: use title not text.
4. layoutElements: ONLY for rearranging EXISTING elements. To CREATE new elements in a grid/row/column, use batchCreateElements and position them yourself.
5. Resize-to-fit: use resizeFrameToFitContent — server computes bounds.
6. getBoardState: only for modify/delete, never create. Pass elementIds from SELECTION CONTEXT when known.
7. Multi-step: getBoardState → then act. Never create then modify — compute final state in one batchCreateElements.
8. Delete only elements created this conversation. Tell users to delete pre-existing manually.
9. Use only listed color palettes.
10. [SELECTION CONTEXT]: target selected element IDs. [OCCUPIED REGION]: use the SUGGESTED ORIGIN as the starting (x,y) for new content — the server computed it to avoid overlapping existing elements. Keep rearranged elements in their current area.
11. FRAME CHILDREN: In batchCreateElements, ALWAYS set frame \`children\` to ALL 0-based indices of child elements — omit none. Example: elements[0]=frame, elements[1..5]=stickies → children:[1,2,3,4,5]. Missing indices cause elements to appear outside the frame. The server applies frame collision deltas to children, so positions should be computed relative to the frame's intended origin.
12. Prefer sticky-note for labeled content (templates, maps, diagrams). Use text only for standalone headings/annotations, not for items inside frames.
13. For pros/cons grids: put "Pro 1", "Pro 2", etc. in top-row stickies and "Con 1", "Con 2", etc. in bottom-row stickies (or "Pro"/"Con" if one per row).
14. bulkCreateElements: use for 7+ elements of the SAME type in a flat grid with no structural elements (e.g. "create 200 sticky notes"). Specify count, colors, textPattern. Server expands the template — never enumerate them yourself. For mixed types or <7 elements, use batchCreateElements. NOT suitable for quadrants, matrices, or categorized layouts.
15. QUADRANT / MATRIX DIAGRAMS: use createQuadrant. ALWAYS pass items with placeholder labels per quadrant (e.g. for SWOT: items: {topLeft:["Strength 1","Strength 2"],topRight:["Weakness 1","Weakness 2"],bottomLeft:["Opportunity 1","Opportunity 2"],bottomRight:["Threat 1","Threat 2"]}). Also pass quadrantLabels for section titles. Stickies are created server-side in one call — no follow-up needed.
16. STRUCTURED DIAGRAMS: For timelines or any diagram needing structural elements (axis lines, dividers, labels) alongside content, use batchCreateElements with mixed types — lines for dividers/axes, text for labels, sticky-notes for content — all in one call. Use line elements for visual structure.
17. CONNECTED DIAGRAMS: For flowcharts, org charts, trees, mind maps, ER diagrams, process flows, state machines, or any diagram where nodes are connected by arrows, use createDiagram. Define nodes (label, optional color) and edges (from/to by 0-based node index). ALWAYS add edge labels to describe the relationship or action between nodes (e.g. "sends request", "triggers", "has many") — unlabeled edges make diagrams hard to read. Default to direction TB (top-to-bottom) — it reads better with curved connectors and labels. Only use LR when the user explicitly asks for horizontal/left-to-right. The server auto-layouts and creates all connectors. Do NOT manually create shapes + createConnector for connected diagrams.
18. COLUMN LAYOUTS: For user journey maps, retrospectives, kanban boards, or any column-based template, use createColumnLayout. ALWAYS include placeholder items so columns are not empty. Example journey map: columns: [{heading:"Awareness",items:["Touchpoint 1","Touchpoint 2","Touchpoint 3"]},{heading:"Consideration",items:["Touchpoint 1","Touchpoint 2","Touchpoint 3"]},...]. Retro: columns: [{heading:"What Went Well",items:["Item 1","Item 2","Item 3"]},{heading:"What Didn't",items:["Item 1","Item 2","Item 3"]},{heading:"Action Items",items:["Item 1","Item 2","Item 3"]}]. Server handles all positioning. Do NOT use batchCreateElements for these — createColumnLayout ensures correct layout.
`;

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

export type AgentResult = {
  text: string;
  toolCallSummary: AiToolCallSummary[];
  createdElementIds: string[];
};

type ToolCallRecord = { toolName: string; input?: unknown };

function isToolErrorResult(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    return parsed != null && typeof parsed === "object" && "error" in parsed;
  } catch {
    return false;
  }
}

function computeOccupiedRegion(elementsMap: Y.Map<unknown>): string | null {
  if (elementsMap.size === 0) return null;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  elementsMap.forEach((val) => {
    const m = val as Y.Map<unknown>;
    const x = m.get("x") as number | undefined;
    const y = m.get("y") as number | undefined;
    const w = m.get("width") as number | undefined;
    const h = m.get("height") as number | undefined;
    if (x == null || y == null || w == null || h == null) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  });
  if (!isFinite(minX)) return null;
  const suggestedX = Math.round(maxX + 80);
  const suggestedY = Math.round(minY);
  return `[OCCUPIED REGION]\nExisting elements occupy roughly x:${Math.round(minX)}..${Math.round(maxX)}, y:${Math.round(minY)}..${Math.round(maxY)}.\nSUGGESTED ORIGIN for new content: (${suggestedX}, ${suggestedY}). The server also auto-adjusts positions to avoid overlap, but starting here gives the best layout.`;
}

function buildSelectionContext(ids: string[]): string {
  return `[SELECTION CONTEXT]\nThe user currently has the following element(s) selected: ${ids.join(", ")}\nWhen the user says "this", "these", "it", "the selected", or refers to elements without specifying which ones, they mean these selected elements. You still need to call getBoardState if you need element details (color, position, etc.) but you already know which element IDs to target.`;
}

/** Heuristic: include occupied region only for create/layout prompts to reduce tokens. */
function promptLikelyNeedsOccupiedRegion(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(create|add|make|draw|put|new|layout|arrange|grid|row|column)\b/.test(lower);
}

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
    const history = (input.conversationHistory ?? []).slice(-MAX_HISTORY_MESSAGES);
    const hasSelection = input.selectedElementIds && input.selectedElementIds.length > 0;
    const userContent = hasSelection
      ? `${buildSelectionContext(input.selectedElementIds!)}\n\n${input.prompt}`
      : input.prompt;
    const occupiedRegion =
      input.imageDataUrl || promptLikelyNeedsOccupiedRegion(input.prompt)
        ? computeOccupiedRegion(elementsMap)
        : null;
    let systemPrompt = occupiedRegion
      ? `${SYSTEM_PROMPT}\n\n${occupiedRegion}`
      : SYSTEM_PROMPT;
    if (input.imageDataUrl) {
      systemPrompt += VISION_PROMPT_ADDENDUM;
    }
    const historyMessages: BaseMessage[] = [];
    for (const m of history) {
      if (m.role === "user") {
        historyMessages.push(new HumanMessage(m.content));
      } else {
        historyMessages.push(new AIMessage({ content: m.content }));
      }
    }
    const userMessage = input.imageDataUrl
      ? new HumanMessage({
          content: [
            { type: "text" as const, text: userContent },
            {
              type: "image_url" as const,
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
  },
  { name: "ai-message-assembly" }
);

const traceSummaryBuild = traceable(
  async (
    collectedToolCalls: ToolCallRecord[],
    finalText: string,
    createdElementIds: string[],
  ): Promise<AgentResult> => {
    const summary = buildSummaryText(collectedToolCalls);
    return {
      text: summary || finalText || "Done.",
      toolCallSummary: aggregateToolCalls(collectedToolCalls),
      createdElementIds,
    };
  },
  { name: "ai-summary-build" }
);

export const handleAiCommand = traceable(
  async (args: {
    prompt: string;
    conversationHistory?: AiConversationMessage[];
    selectedElementIds?: string[];
    imageDataUrl?: string;
    doc: Y.Doc;
    userId: string;
    roomId: string;
  }): Promise<AgentResult> => {
    const { prompt, conversationHistory, selectedElementIds, imageDataUrl, doc, userId, roomId } = args;

    const elementsMap = doc.getMap("elements");

    return runAgentLoop(
      { prompt, conversationHistory, selectedElementIds, imageDataUrl },
      doc,
      elementsMap,
    );
  },
  {
    name: "ai-board-command",
    run_type: "chain",
    tags: ["ai-command"],
  }
);

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
  const isGemini = AI_PROVIDER === "gemini";
  const { tools, aiCreatedIds } = createBoardTools(doc, { useGeminiSchema: isGemini });
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));

  const openaiModel = input.imageDataUrl ? "gpt-4o" : "gpt-5.1";
  const model = isGemini
    ? new ChatGoogle({
        model: "gemini-2.0-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0,
      }).bindTools(tools)
    : new ChatOpenAI({
        model: openaiModel,
        temperature: 0,
      }).bindTools(tools, { parallel_tool_calls: false });

  const allMessages: BaseMessage[] = await traceMessageAssembly(input, elementsMap);

  const INTERMEDIATE_TOOLS = new Set(["getBoardState"]);
  const collectedToolCalls: ToolCallRecord[] = [];
  let finalText = "";

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const response = (await model.invoke(allMessages, {
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    })) as AIMessage;

    allMessages.push(response);

    const tcs = response.tool_calls ?? [];
    if (tcs.length === 0) {
      finalText = typeof response.content === "string" ? response.content : "";
      break;
    }

    const toolResults: ToolMessage[] = [];
    const beforeCount = collectedToolCalls.length;
    for (const tc of tcs) {
      const toolFn = toolMap[tc.name] as
        | { invoke: (a: unknown, config?: unknown) => Promise<string> }
        | undefined;
      if (!toolFn) {
        toolResults.push(
          new ToolMessage({
            tool_call_id: tc.id ?? "unknown",
            content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
          })
        );
        continue;
      }
      try {
        const result = await toolFn.invoke(tc.args);
        const content: string =
          typeof result === "string" ? result : JSON.stringify(result ?? {});
        if (!isToolErrorResult(content)) {
          collectedToolCalls.push({ toolName: tc.name, input: tc.args });
        }
        toolResults.push(
          new ToolMessage({ tool_call_id: tc.id ?? "unknown", content })
        );
      } catch (err) {
        toolResults.push(
          new ToolMessage({
            tool_call_id: tc.id ?? "unknown",
            content: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          })
        );
      }
    }

    allMessages.push(...toolResults);

    const hasErrors = toolResults.some((r) => isToolErrorResult(r.content as string));
    const hasIntermediateCall = tcs.some((tc) => INTERMEDIATE_TOOLS.has(tc.name));

    if (!hasErrors && !hasIntermediateCall && collectedToolCalls.length > beforeCount) {
      break;
    }
  }

  const createdElementIds = Array.from(aiCreatedIds);

  if (collectedToolCalls.length === 0) {
    return { text: finalText || "Done.", toolCallSummary: [], createdElementIds };
  }

  return await traceSummaryBuild(collectedToolCalls, finalText, createdElementIds);
}

function buildSummaryText(toolCalls: ToolCallRecord[]): string {
  const parts: string[] = [];

  for (const call of toolCalls) {
    switch (call.toolName) {
      case "batchCreateElements": {
        const input = call.input as { elements?: Array<{ type: string }> } | undefined;
        if (!input?.elements?.length) break;
        const counts = new Map<string, number>();
        for (const el of input.elements) {
          const label = el.type === "sticky-note" ? "sticky note" : el.type;
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        const desc = Array.from(counts.entries())
          .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
          .join(", ");
        parts.push(`Created ${desc}`);
        break;
      }
      case "bulkCreateElements": {
        const input = call.input as { count?: number; type?: string; frameTitle?: string } | undefined;
        const count = input?.count ?? 0;
        const label = input?.type === "sticky-note" ? "sticky note" : (input?.type ?? "element");
        const desc = `Created ${count} ${label}${count !== 1 ? "s" : ""}`;
        parts.push(input?.frameTitle ? `${desc} in frame "${input.frameTitle}"` : desc);
        break;
      }
      case "batchModifyElements": {
        const input = call.input as { modifications?: unknown[] } | undefined;
        const n = input?.modifications?.length ?? 0;
        parts.push(`Modified ${n} element${n !== 1 ? "s" : ""}`);
        break;
      }
      case "resizeFrameToFitContent": {
        const input = call.input as { frameIds?: string[] } | undefined;
        const n = input?.frameIds?.length ?? 0;
        parts.push(`Resized ${n} frame${n !== 1 ? "s" : ""} to fit content`);
        break;
      }
      case "layoutElements": {
        const input = call.input as { elementIds?: string[]; strategy?: string } | undefined;
        const n = input?.elementIds?.length ?? 0;
        const strategy = input?.strategy ?? "grid";
        parts.push(`Arranged ${n} element${n !== 1 ? "s" : ""} in a ${strategy}`);
        break;
      }
      case "createQuadrant": {
        const input = call.input as { title?: string } | undefined;
        parts.push(input?.title ? `Created quadrant diagram "${input.title}"` : "Created quadrant diagram");
        break;
      }
      case "createColumnLayout": {
        const input = call.input as { title?: string; columns?: unknown[] } | undefined;
        const colCount = input?.columns?.length ?? 0;
        const desc = input?.title
          ? `Created column layout "${input.title}" with ${colCount} columns`
          : `Created column layout with ${colCount} columns`;
        parts.push(desc);
        break;
      }
      case "createDiagram": {
        const input = call.input as { title?: string; nodes?: unknown[]; edges?: unknown[] } | undefined;
        const nodeCount = input?.nodes?.length ?? 0;
        const edgeCount = input?.edges?.length ?? 0;
        const desc = input?.title
          ? `Created diagram "${input.title}" with ${nodeCount} nodes and ${edgeCount} connectors`
          : `Created diagram with ${nodeCount} nodes and ${edgeCount} connectors`;
        parts.push(desc);
        break;
      }
      case "createConnector":
        parts.push("Created a connector");
        break;
      case "deleteObject":
        parts.push("Deleted element");
        break;
    }
  }

  return parts.length > 0 ? parts.join(". ") + "." : "Done.";
}

function aggregateToolCalls(toolCalls: ToolCallRecord[]): AiToolCallSummary[] {
  const counts = new Map<string, number>();

  for (const call of toolCalls) {
    const name = call.toolName;
    if (name === "batchCreateElements") {
      const input = call.input as { elements?: unknown[] } | undefined;
      counts.set(name, (counts.get(name) ?? 0) + (input?.elements?.length ?? 0));
    } else if (name === "bulkCreateElements") {
      const input = call.input as { count?: number; frameTitle?: string } | undefined;
      const total = (input?.count ?? 0) + (input?.frameTitle ? 1 : 0);
      counts.set(name, (counts.get(name) ?? 0) + total);
    } else if (name === "batchModifyElements") {
      const input = call.input as { modifications?: unknown[] } | undefined;
      counts.set(name, (counts.get(name) ?? 0) + (input?.modifications?.length ?? 0));
    } else if (name === "resizeFrameToFitContent") {
      const input = call.input as { frameIds?: string[] } | undefined;
      counts.set(name, (counts.get(name) ?? 0) + (input?.frameIds?.length ?? 0));
    } else if (name === "layoutElements") {
      const input = call.input as { elementIds?: string[] } | undefined;
      counts.set(name, (counts.get(name) ?? 0) + (input?.elementIds?.length ?? 0));
    } else if (name === "createDiagram") {
      const input = call.input as { nodes?: unknown[]; edges?: unknown[] } | undefined;
      const total = (input?.nodes?.length ?? 0) + (input?.edges?.length ?? 0);
      counts.set(name, (counts.get(name) ?? 0) + total);
    } else if (name === "createColumnLayout") {
      const input = call.input as { columns?: unknown[] } | undefined;
      const total = (input?.columns?.length ?? 0) + 1;
      counts.set(name, (counts.get(name) ?? 0) + total);
    } else if (name !== "getBoardState") {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([toolName, elementCount]) => ({
    toolName,
    elementCount,
  }));
}
