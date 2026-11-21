"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
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
import type { ShoppingUIMessage } from "@/lib/agent-types";

const STARTERS = [
  "Show me hoodies",
  "What categories do you have?",
  "Tell me about the water bottle",
];

type ShoppingPart = ShoppingUIMessage["parts"][number];

export function AgentChat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error, regenerate, clearError } =
    useChat<ShoppingUIMessage>({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

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
              title="Ask the Ship It Shop assistant"
              description="Find products, compare items, or ask about a product's details."
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) => (
                    <ChatPart
                      key={`${message.id}-${i}`}
                      part={part}
                      role={message.role}
                    />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
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
                The assistant couldn&apos;t answer.
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
            {STARTERS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about products"
              aria-label="Message the shopping assistant"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
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

function ChatPart({ part, role }: { part: ShoppingPart; role: string }) {
  switch (part.type) {
    case "text":
      return role === "assistant" ? (
        <MessageResponse>{part.text}</MessageResponse>
      ) : (
        <p className="whitespace-pre-wrap">{part.text}</p>
      );
    case "tool-searchProducts":
    case "tool-getAllCategories":
    case "tool-getProductDetails":
      return <ToolResult part={part} />;
    default:
      return null;
  }
}

const PENDING_LABEL: Record<string, string> = {
  "tool-searchProducts": "Searching products…",
  "tool-getAllCategories": "Loading categories…",
  "tool-getProductDetails": "Looking up product details…",
};

type ToolPart = Extract<
  ShoppingPart,
  { type: "tool-searchProducts" | "tool-getAllCategories" | "tool-getProductDetails" }
>;

/**
 * Basic tool-result rendering: progress, failures and a compact result.
 * Richer product cards replace the success views in the next step.
 */
function ToolResult({ part }: { part: ToolPart }) {
  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {PENDING_LABEL[part.type]}
      </p>
    );
  }
  if (part.state === "output-error") {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4" aria-hidden="true" />
        That lookup failed. Please try again.
      </p>
    );
  }
  if (part.state !== "output-available") return null;

  const output = part.output;
  if (output.status !== "ok") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <AlertCircle className="size-4" aria-hidden="true" />
        {output.message}
      </p>
    );
  }

  if ("products" in output) {
    if (output.products.length === 0) {
      return <p className="text-sm text-muted-foreground">No matching products.</p>;
    }
    return (
      <ul className="flex flex-col gap-1 text-sm">
        {output.products.map((p) => (
          <li key={p.id}>
            <Link href={p.url} className="underline underline-offset-2">
              {p.name}
            </Link>{" "}
            <span className="text-muted-foreground">{p.price}</span>
          </li>
        ))}
      </ul>
    );
  }
  if ("product" in output) {
    return (
      <p className="text-sm">
        <Link href={output.product.url} className="font-medium underline underline-offset-2">
          {output.product.name}
        </Link>{" "}
        <span className="text-muted-foreground">{output.product.price}</span>
      </p>
    );
  }
  // A successful category lookup is an internal step: the agent uses it to
  // pick a filter, so there is nothing for the shopper to see.
  return null;
}
