import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import { resolveAdminModel } from "@/lib/admin-agent";
import { requireAdmin } from "@/lib/admin-guard";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

const MAX_MESSAGES = 60;

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

/**
 * Admin chat API. It lives under /admin (not /api/admin) so the admin session
 * cookie, which is scoped to path=/admin, is sent with the request and the
 * proxy.ts gate applies; requireAdmin() checks the cookie again here.
 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json(
      { error: "Send a JSON body with a non-empty `messages` array." },
      { status: 400 },
    );
  }

  // The conversation's sandbox folder: the first message id stays the same
  // for every turn of a chat (and changes for a new chat), so follow-ups can
  // reuse files while concurrent conversations stay apart.
  const firstId = (body.messages[0] as { id?: unknown } | undefined)?.id;
  const workspace =
    typeof firstId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(firstId)
      ? `chat-${firstId}`
      : `chat-${crypto.randomUUID()}`;

  const run = await start(adminChatFlow, [
    body.messages as UIMessage[],
    { model: resolveAdminModel(), today: new Date().toISOString().slice(0, 10), workspace },
  ]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
