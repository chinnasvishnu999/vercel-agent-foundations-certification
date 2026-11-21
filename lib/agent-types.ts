import type { InferUITools, UIDataTypes, UIMessage } from "ai";

import type { shoppingTools } from "@/lib/tools";

/**
 * Message type shared by the shopping chat route and UI. A type-only import,
 * so client components get typed tool parts without bundling server code.
 */
export type ShoppingUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<typeof shoppingTools>
>;
