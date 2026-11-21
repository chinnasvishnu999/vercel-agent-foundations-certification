import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

/**
 * Reconnects to an existing shopping-chat run (the `[id]` is its run id).
 * WorkflowChatTransport calls this when a stream ends without `finish`, and
 * the chat calls it after a page refresh. It replays the run's durable stream
 * from `startIndex`, so the response continues without duplicates and the
 * work is never started again.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^wrun_[A-Za-z0-9]+$/.test(id)) {
    return Response.json({ error: "Unknown chat run." }, { status: 404 });
  }

  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? "0");
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json(
      { error: "startIndex must be a non-negative integer." },
      { status: 400 },
    );
  }

  const run = getRun(id);
  if (!(await run.exists.catch(() => false))) {
    return Response.json({ error: "Unknown chat run." }, { status: 404 });
  }

  // The durable stream stores raw model-call parts, so replay from 0 and let
  // the transform skip to the UI chunk the client already has.
  const readable = run
    .getReadable({ startIndex: 0 })
    .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex }));

  return createUIMessageStreamResponse({
    stream: readable,
    headers: { "x-workflow-run-id": id },
  });
}
