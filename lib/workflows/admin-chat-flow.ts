import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { getWritable } from "workflow";

import { createAdminAgent } from "@/lib/admin-agent";
import { cleanupOldWorkspaces, readMemory } from "@/lib/admin-sandbox";

/**
 * Reads the admin memory file from the persistent sandbox at the start of the
 * conversation turn. A sandbox outage shouldn't block the chat, so it falls
 * back to an explicit "unavailable" note instead of failing the run.
 */
async function readAdminMemoryStep(): Promise<string> {
  "use step";
  // Housekeeping only: a failure here must not block the conversation.
  await cleanupOldWorkspaces().catch((err) =>
    console.error("[admin] workspace cleanup failed", err instanceof Error ? err.message : err),
  );
  try {
    return await readMemory();
  } catch (err) {
    console.error("[admin] couldn't read memory", err instanceof Error ? err.message : err);
    return "(memory is temporarily unavailable)";
  }
}

/**
 * One admin-chat turn as a durable workflow: model calls and back-office tool
 * calls run as Workflow steps (retried on transient failures, never re-run
 * once finished), and output goes to the run's durable stream so the admin
 * chat can reconnect through /admin/api/chat/[id]/stream.
 */
export async function adminChatFlow(
  messages: UIMessage[],
  options: { model: string; today: string; workspace: string },
) {
  "use workflow";

  const memory = await readAdminMemoryStep();
  const modelMessages = await convertToModelMessages(messages);
  const agent = createAdminAgent(options.model, options.today, memory, options.workspace);

  const result = await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { finishReason: result.finishReason, steps: result.steps.length };
}
