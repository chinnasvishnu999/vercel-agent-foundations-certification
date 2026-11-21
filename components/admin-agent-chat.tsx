"use client";

import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { AdminToolResult, type AdminToolPart } from "@/components/admin/admin-tool-result";
import { useAdminChat } from "@/components/admin/use-admin-chat";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import type { AdminUIMessage } from "@/lib/admin-agent-types";

const SUGGESTIONS = [
  "Show me low-stock items",
  "What were yesterday's top sellers?",
  "Summarize this week's revenue",
  "Which urgent support tickets are still open?",
  "What are the most common return reasons this month?",
];

type AdminPart = AdminUIMessage["parts"][number];

export function AdminAgentChat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, reset, error, regenerate, clearError } =
    useAdminChat();

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (error) clearError();
    sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text ?? "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Ask about store operations"
              description="Support tickets, returns, inventory and sales. Read-only: the agent can't change store data."
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) => (
                    <AdminChatPart key={`${message.id}-${i}`} part={part} role={message.role} />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Thinking…
            </p>
          )}
          {error && (
            <div
              className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <p className="flex items-center gap-2 font-medium text-destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                The admin agent couldn&apos;t answer.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => {
                  clearError();
                  regenerate();
                }}
              >
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
              aria-label="Message the admin agent"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {messages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  aria-label="Start a new admin chat"
                >
                  <RotateCcw aria-hidden="true" />
                  New chat
                </Button>
              )}
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function AdminChatPart({ part, role }: { part: AdminPart; role: string }) {
  if (part.type === "text") {
    return role === "assistant" ? (
      <MessageResponse>{part.text}</MessageResponse>
    ) : (
      <p className="whitespace-pre-wrap">{part.text}</p>
    );
  }
  if (part.type.startsWith("tool-")) {
    return <AdminToolResult part={part as AdminToolPart} />;
  }
  return null;
}
