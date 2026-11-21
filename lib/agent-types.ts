import type { InferAgentUIMessage } from "ai";

import type { shoppingAgent } from "@/lib/agent";

/**
 * Message type shared by the shopping chat route and UI. A type-only import,
 * so client components get typed tool parts without bundling server code.
 */
export type ShoppingUIMessage = InferAgentUIMessage<typeof shoppingAgent>;
