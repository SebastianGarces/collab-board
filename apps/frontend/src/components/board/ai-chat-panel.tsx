"use client";

import { Loader2, Send, Sparkles, X } from "lucide-react";
import {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCanvasStore } from "@/stores/canvas-store";
import type { AiChatResponse, AiConversationMessage, AiToolCallSummary } from "@collab/shared/collab";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCallSummary?: AiToolCallSummary[];
  error?: string;
  pending?: boolean;
};

type AiChatPanelProps = {
  open: boolean;
  onClose: () => void;
  onSendMessage: (prompt: string, conversationHistory?: AiConversationMessage[], selectedElementIds?: string[]) => string;
};

const TOOL_LABELS: Record<string, string> = {
  createStickyNote: "Created sticky note",
  createShape: "Created shape",
  createFrame: "Created frame",
  createConnector: "Created connector",
  moveObject: "Moved",
  resizeObject: "Resized",
  updateText: "Updated text",
  changeColor: "Changed color",
  deleteObject: "Deleted",
  batchCreateElements: "Created",
  batchModifyElements: "Modified",
  layoutElements: "Arranged",
  resizeFrameToFitContent: "Resized to fit",
};

function formatToolSummary(summary: AiToolCallSummary): string {
  const label = TOOL_LABELS[summary.toolName] ?? summary.toolName;
  if (summary.elementCount > 1) {
    return `${label} ${summary.elementCount} elements`;
  }
  return label;
}

const AI_RESPONSE_TIMEOUT_MS = 60_000;

const EXAMPLE_PROMPTS = [
  "Create a SWOT analysis template with four quadrants",
  "Build a user journey map with 5 stages",
  "Set up a retrospective board with What Went Well, What Didn't, and Action Items columns",
  "Create a flowchart with Start, Validate, Decision, and Success nodes",
];

const AiChatPanelInner = forwardRef<
  ((response: AiChatResponse) => void) | null,
  AiChatPanelProps
>(function AiChatPanelInner({ open, onClose, onSendMessage }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  const clearPendingTimeout = useCallback(() => {
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  }, []);

  const handleSend = useCallback((overridePrompt?: string) => {
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt) return;

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
    const messageId = onSendMessage(prompt, history.length > 0 ? history : undefined, selectionIds);
    if (!messageId) return;

    const responseId = `${messageId}-response`;
    setMessages((prev) => [
      ...prev,
      { id: messageId, role: "user", text: prompt },
      { id: responseId, role: "assistant", text: "", pending: true },
    ]);
    if (!overridePrompt) {
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    }
    scrollToBottom();

    clearPendingTimeout();
    pendingTimeoutRef.current = setTimeout(() => {
      pendingTimeoutRef.current = null;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === responseId && msg.pending
            ? { ...msg, pending: false, error: "Request timed out — please try again." }
            : msg
        )
      );
    }, AI_RESPONSE_TIMEOUT_MS);
  }, [input, messages, onSendMessage, scrollToBottom, selectedElementIds, clearPendingTimeout]);

  const handleAiResponse = useCallback(
    (response: AiChatResponse) => {
      clearPendingTimeout();
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === `${response.id}-response`) {
            return {
              ...msg,
              text: response.text,
              toolCallSummary: response.toolCallSummary,
              error: response.error,
              pending: false,
            };
          }
          return msg;
        })
      );
      scrollToBottom();
    },
    [scrollToBottom, clearPendingTimeout]
  );

  useImperativeHandle(ref, () => handleAiResponse, [handleAiResponse]);

  useEffect(() => {
    return clearPendingTimeout;
  }, [clearPendingTimeout]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="absolute top-4 right-4 bottom-20 z-40 w-[380px] flex flex-col bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden" onWheel={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#888]" />
          <span className="text-sm font-medium text-white">AI Assistant</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="text-center text-[#666] text-sm py-8">
              <Sparkles className="h-8 w-8 mx-auto mb-3 text-[#444]" />
              <p>Ask me to create, modify, or organize elements on the board.</p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`rounded-lg px-3 py-2 text-sm max-w-[90%] ${
                  msg.role === "user"
                    ? "bg-[#2a2a2a] text-[#e0e0e0]"
                    : "bg-[#222] text-[#ccc]"
                }`}
              >
                {msg.pending ? (
                  <div className="flex items-center gap-2 text-[#888]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                ) : msg.error ? (
                  <span className="text-red-400">{msg.error}</span>
                ) : (
                  msg.text
                )}
              </div>
              {msg.toolCallSummary && msg.toolCallSummary.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1">
                  {msg.toolCallSummary.map((tc, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="text-[10px] bg-[#2a2a2a] text-[#999] border-0"
                    >
                      {formatToolSummary(tc)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 py-3 border-t border-[#2a2a2a]">
        {messages.length === 0 && (
          <div className="mb-3 flex flex-col gap-2">
            <span className="px-0.5 text-[11px] font-medium text-[#666] uppercase tracking-wider">
              Try an example
            </span>
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleSend(prompt)}
                className="w-full text-left rounded-lg border border-[#2a2a2a] bg-[#222] px-3 py-2.5 text-[13px] leading-snug text-[#bbb] hover:border-[#444] hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        {selectedElementIds.size > 0 && (
          <div className="flex items-center gap-1.5 mb-2 px-0.5">
            <Badge variant="secondary" className="text-[10px] bg-[#2a2a2a] text-[#aaa] border border-[#333]">
              {selectedElementIds.size} {selectedElementIds.size === 1 ? "element" : "elements"} selected
            </Badge>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask the AI to do something..."
            className="flex-1 resize-none overflow-hidden bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#666] outline-none focus:border-[#444] focus:ring-1 focus:ring-[#444]"
          />
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => handleSend()}
            disabled={!input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});

export const AiChatPanel = memo(AiChatPanelInner);
