import { getRun } from "workflow/api";

import type { ReturnOutcome } from "@/lib/workflows/return-flow";

/**
 * Progress of a return started from the shopping chat (`[id]` is the return
 * workflow's run id, shown to the shopper as the tracking id). Returns only
 * what the return card needs: never order contents, emails or store errors.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^wrun_[A-Za-z0-9]+$/.test(id)) {
    return Response.json({ error: "Unknown return." }, { status: 404 });
  }

  const run = getRun<ReturnOutcome>(id);
  if (!(await run.exists.catch(() => false))) {
    return Response.json({ error: "Unknown return." }, { status: 404 });
  }
  // Only return workflows are reported here, never chat or admin runs.
  if (!(await run.workflowName).endsWith("returnOrderFlow")) {
    return Response.json({ error: "Unknown return." }, { status: 404 });
  }

  const status = await run.status;
  if (status === "completed") {
    const outcome = await run.returnValue;
    return Response.json({
      state: "completed",
      returnId: outcome.returnId,
      decision: outcome.decision,
      refundAmount: outcome.refundAmount,
      refundPreauthorized: outcome.refundPreauthorization.amount,
      notes: outcome.notes,
    });
  }
  if (status === "failed" || status === "cancelled") {
    return Response.json({ state: "failed" });
  }
  return Response.json({ state: "processing" });
}
