import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

import { requireAdmin } from "@/lib/admin-guard";

/** Reconnects the admin chat to an existing run (dropped connection or refresh). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  if (!/^wrun_[A-Za-z0-9]+$/.test(id)) {
    return Response.json({ error: "Unknown chat run." }, { status: 404 });
  }
  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? "0");
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "startIndex must be a non-negative integer." }, { status: 400 });
  }

  const run = getRun(id);
  if (!(await run.exists.catch(() => false))) {
    return Response.json({ error: "Unknown chat run." }, { status: 404 });
  }
  // Only admin-chat runs can be replayed here (not shopping or return runs).
  if (!(await run.workflowName).endsWith("adminChatFlow")) {
    return Response.json({ error: "Unknown chat run." }, { status: 404 });
  }

  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex })),
    headers: { "x-workflow-run-id": id },
  });
}
