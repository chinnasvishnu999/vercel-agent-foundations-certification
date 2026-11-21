"use client";

import { createDurableChat } from "@/components/chat/durable-chat";
import type { ShoppingUIMessage } from "@/lib/agent-types";

/** The storefront shopping chat: durable runs at /api/chat, resumable after refresh. */
export const useShoppingChat = createDurableChat<ShoppingUIMessage>({
  api: "/api/chat",
  storageKey: "ship-it-shop:shopping-chat",
});
