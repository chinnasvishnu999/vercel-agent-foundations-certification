"use client";

import { createDurableChat } from "@/components/chat/durable-chat";
import type { AdminUIMessage } from "@/lib/admin-agent-types";

/** The admin chat: durable runs at /admin/api/chat (behind the admin gate). */
export const useAdminChat = createDurableChat<AdminUIMessage>({
  api: "/admin/api/chat",
  storageKey: "ship-it-shop:admin-chat",
});
