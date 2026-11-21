import type { InferUITools, UIDataTypes, UIMessage } from "ai";

import type { adminTools } from "@/lib/admin-tools";

/** Message type for the admin chat (type-only import: no server code in the browser). */
export type AdminUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<typeof adminTools>>;
