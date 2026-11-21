"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useEffect } from "react";

/**
 * A chat whose turns run as durable Workflow runs, with resumable streams.
 *
 * - Each turn POSTs to `api`, which starts a Workflow run and returns its id
 *   in `x-workflow-run-id`. WorkflowChatTransport reconnects through
 *   `${api}/<runId>/stream` if the connection drops mid-answer.
 * - The conversation and the id of an unfinished run are kept in
 *   sessionStorage (this tab only). After a page refresh the chat restores the
 *   finished messages, drops the half-streamed answer, and reconnects to the
 *   SAME run, replaying its durable stream once: no duplicate output, and the
 *   work is never started again.
 *
 * Call once per chat at module level; each page has one panel per chat, so
 * the run tracker and transport live outside React state.
 */
export function createDurableChat<M extends UIMessage>({
  api,
  storageKey,
}: {
  api: string;
  storageKey: string;
}) {
  type Saved = { messages: M[]; activeRunId: string | null };
  const activeRunId: { current: string | null } = { current: null };

  function load(): Saved | null {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
      return null;
    }
  }

  function save(value: Saved) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode, quota): the chat still works, it
      // just won't survive a refresh.
    }
  }

  /** Record (or clear) the unfinished run immediately, independent of message updates. */
  function saveRunId(runId: string | null) {
    activeRunId.current = runId;
    const saved = load();
    save({ messages: saved?.messages ?? [], activeRunId: runId });
  }

  /** Messages up to the last user message: the answer after it is replayed. */
  function withoutPendingAnswer(messages: M[]): M[] {
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    return lastUser === -1 ? messages : messages.slice(0, lastUser + 1);
  }

  const transport = new WorkflowChatTransport<M>({
    api,
    maxConsecutiveErrors: 5,
    // The run id arrives in the response header; save it right away so a
    // reload a moment later can still reconnect. Clear it once it finishes.
    onChatSendMessage: (response) => saveRunId(response.headers.get("x-workflow-run-id")),
    onChatEnd: () => saveRunId(null),
    // After a refresh the transport only knows the chat id, so point the
    // reconnect at the saved run. Mid-stream reconnects already carry it.
    prepareReconnectToStreamRequest: ({ api: defaultApi }) => ({
      api: activeRunId.current
        ? `${api}/${encodeURIComponent(activeRunId.current)}/stream`
        : defaultApi,
    }),
  });

  return function useDurableChat() {
    const chat = useChat<M>({ transport });
    const { messages, setMessages, resumeStream } = chat;

    // Restore on mount (client only, so server and client HTML match). This
    // is idempotent: in development React runs effects twice and cancels the
    // first resume, so the second run must be able to reconnect again.
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

    // Persist messages after every change (including each streamed chunk).
    // An empty list is never written here, so the first render can't wipe a
    // saved chat before it is restored; "New chat" clears storage explicitly.
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
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    };

    return { ...chat, stop, reset };
  };
}
