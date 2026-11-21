import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { z } from "zod";

import { shoppingAgent } from "@/lib/agent";

// A tool round trip plus streaming the answer stays well under this limit.
export const maxDuration = 60;

const MAX_MESSAGES = 60;

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

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

  return createAgentUIStreamResponse({
    agent: shoppingAgent,
    uiMessages: body.messages as UIMessage[],
    onError: (error) => {
      console.error("[api/chat] agent error", error);
      // Never forward provider or API error text (it can include URLs).
      return "Sorry, something went wrong while answering. Please try again.";
    },
  });
}
