"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { useEffect } from "react";

import type { ShoppingUIMessage } from "@/lib/agent-types";

/**
 * Shopping chat with durable, resumable runs.
 *
 * - Each turn starts a Workflow run on the server (POST /api/chat).
 *   WorkflowChatTransport reconnects through /api/chat/<runId>/stream if the
 *   connection drops mid-answer.
 * - The conversation and the id of an unfinished run are kept in
 *   sessionStorage (this tab only). After a page refresh the chat restores the
 *   finished messages, drops the half-streamed answer, and reconnects to the
 *   SAME run, replaying its durable stream once: no duplicate output, and the
 *   work is never started again.
 */

const STORAGE_KEY = "ship-it-shop:shopping-chat";
const API = "/api/chat";

type Saved = { messages: ShoppingUIMessage[]; activeRunId: string | null };

function load(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(value: Saved) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the chat still works, it just
    // won't survive a refresh.
  }
}

/** Record (or clear) the unfinished run immediately, independent of message updates. */
function saveRunId(runId: string | null) {
  activeRunId.current = runId;
  const saved = load();
  save({ messages: saved?.messages ?? [], activeRunId: runId });
}

/** Messages up to the last user message: the answer after it is replayed. */
function withoutPendingAnswer(messages: ShoppingUIMessage[]): ShoppingUIMessage[] {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  return lastUser === -1 ? messages : messages.slice(0, lastUser + 1);
}

/**
 * The storefront has a single shopping chat panel, so the id of its unfinished
 * run and its transport live at module level (outside React state), shared by
 * the transport callbacks and the hook.
 */
const activeRunId: { current: string | null } = { current: null };

const transport = new WorkflowChatTransport<ShoppingUIMessage>({
  api: API,
  maxConsecutiveErrors: 5,
  // The run id arrives in the response header; save it right away so a reload
  // a moment later can still reconnect. Clear it once the answer finishes.
  onChatSendMessage: (response) => saveRunId(response.headers.get("x-workflow-run-id")),
  onChatEnd: () => saveRunId(null),
  // After a refresh the transport only knows the chat id, so point the
  // reconnect at the saved run. Mid-stream reconnects already carry it.
  prepareReconnectToStreamRequest: ({ api }) => ({
    api: activeRunId.current ? `${API}/${encodeURIComponent(activeRunId.current)}/stream` : api,
  }),
});

export function useShoppingChat() {
  const chat = useChat<ShoppingUIMessage>({ transport });
  const { messages, setMessages, resumeStream } = chat;

  // Restore on mount (client only, so server and client HTML match). This is
  // idempotent: in development React runs effects twice and cancels the first
  // resume, so the second run must be able to reconnect again.
  useEffect(() => {
    const saved = load();
    if (!saved || saved.messages.length === 0) return;
    if (saved.activeRunId) {
      activeRunId.current = saved.activeRunId;
      setMessages(withoutPendingAnswer(saved.messages));
      void resumeStream();
    } else {
      setMessages(saved.messages);
    }
  }, [resumeStream, setMessages]);

  // Persist messages after every change (including each streamed chunk). An
  // empty list is never written here, so the first render can't wipe a saved
  // chat before it is restored; "New chat" clears storage explicitly. The run
  // id is tracked by the transport callbacks above.
  useEffect(() => {
    if (messages.length === 0) return;
    save({ messages, activeRunId: activeRunId.current });
  }, [messages]);

  const stop = () => {
    saveRunId(null);
    void chat.stop();
  };

  const reset = () => {
    activeRunId.current = null;
    void chat.stop();
    setMessages([]);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return { ...chat, stop, reset };
}
