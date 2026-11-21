import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { getWritable } from "workflow";

import { createShoppingAgent } from "@/lib/agent";

/**
 * One shopping-chat turn as a durable workflow.
 *
 * - Model calls and tool calls run as Workflow steps: transient failures are
 *   retried, and finished steps are never re-run when the workflow resumes.
 * - Output goes to the run's durable stream (`getWritable`). The route pipes
 *   it to the browser, and `/api/chat/[id]/stream` replays it so a refreshed
 *   or disconnected chat reconnects to the same run instead of starting over.
 */
export async function shoppingChatFlow(messages: UIMessage[], model: string) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages);
  const agent = createShoppingAgent(model);

  const result = await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { finishReason: result.finishReason, steps: result.steps.length };
}
