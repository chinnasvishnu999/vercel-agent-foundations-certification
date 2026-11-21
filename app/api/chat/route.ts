import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import { resolveShoppingModel } from "@/lib/agent";
import { shoppingChatFlow } from "@/lib/workflows/chat-flow";

const MAX_MESSAGES = 60;

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

/**
 * Starts one durable shopping-chat run and streams it. The run id goes back in
 * `x-workflow-run-id` so WorkflowChatTransport can reconnect through
 * `/api/chat/[id]/stream` after a dropped connection or a page refresh.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json(
      { error: "Send a JSON body with a non-empty `messages` array." },
      { status: 400 },
    );
  }

  const run = await start(shoppingChatFlow, [
    body.messages as UIMessage[],
    resolveShoppingModel(),
  ]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
