import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import {
    WS_MESSAGE_AI,
    type AiChatRequest,
    type AiChatResponse,
} from "@collab/shared/collab";
import type { RoomManager, SocketLike } from "../collab/room-manager";
import { handleAiCommand } from "./agent";

export function encodeAiResponse(response: AiChatResponse): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_AI);
  encoding.writeVarString(encoder, JSON.stringify(response));
  return encoding.toUint8Array(encoder);
}

export async function handleAiMessage(
  roomId: string,
  socket: SocketLike,
  doc: Y.Doc,
  payload: string,
  userId: string,
  roomManager?: RoomManager,
): Promise<void> {
  let request: AiChatRequest;
  try {
    request = JSON.parse(payload);
  } catch {
    const errorResponse: AiChatResponse = {
      type: "ai_response",
      id: "unknown",
      text: "",
      toolCallSummary: [],
      error: "Invalid AI request payload",
    };
    socket.send(encodeAiResponse(errorResponse));
    return;
  }

  if (request.type !== "ai_request" || !request.prompt) {
    const errorResponse: AiChatResponse = {
      type: "ai_response",
      id: request.id ?? "unknown",
      text: "",
      toolCallSummary: [],
      error: "Missing prompt in AI request",
    };
    socket.send(encodeAiResponse(errorResponse));
    return;
  }

  // Pause Yjs broadcasting so multi-step mutations arrive as one atomic
  // update when the agent finishes, avoiding visual jitter on the canvas.
  roomManager?.pauseBroadcast(roomId);

  try {
    const result = await handleAiCommand({
      prompt: request.prompt,
      conversationHistory: request.conversationHistory,
      selectedElementIds: request.selectedElementIds,
      doc,
      userId,
      roomId,
    });

    // Resume broadcasting first so the merged Yjs update reaches clients
    // right before (or effectively at the same time as) the chat response.
    roomManager?.resumeBroadcastAsAi(roomId, socket);

    const response: AiChatResponse = {
      type: "ai_response",
      id: request.id,
      text: result.text,
      toolCallSummary: result.toolCallSummary,
      createdElementIds: result.createdElementIds.length > 0
        ? result.createdElementIds
        : undefined,
    };
    socket.send(encodeAiResponse(response));

    // Flush tracing callbacks off the critical path
    awaitAllCallbacks().catch(() => {});
  } catch (error) {
    console.error("[ai] command failed:", error);
    // Always resume broadcasting even on failure to avoid stuck rooms
    roomManager?.resumeBroadcastAsAi(roomId, socket);
    const errorResponse: AiChatResponse = {
      type: "ai_response",
      id: request.id,
      text: "",
      toolCallSummary: [],
      error: error instanceof Error ? error.message : "AI command failed",
    };
    socket.send(encodeAiResponse(errorResponse));
    awaitAllCallbacks().catch(() => {}); // fire-and-forget tracing flush
  }
}
