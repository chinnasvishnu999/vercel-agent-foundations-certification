import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { getWritable } from "workflow";

import { createAdminAgent } from "@/lib/admin-agent";

/**
 * One admin-chat turn as a durable workflow: model calls and back-office tool
 * calls run as Workflow steps (retried on transient failures, never re-run
 * once finished), and output goes to the run's durable stream so the admin
 * chat can reconnect through /admin/api/chat/[id]/stream.
 */
export async function adminChatFlow(
  messages: UIMessage[],
  options: { model: string; today: string },
) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages);
  const agent = createAdminAgent(options.model, options.today);

  const result = await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { finishReason: result.finishReason, steps: result.steps.length };
}
