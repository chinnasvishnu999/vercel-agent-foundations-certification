// Server-side only (route handlers and Workflow steps). Admin-only: these
// tools are never given to the shopping agent.

import { tool } from "ai";
import { z } from "zod";

import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
} from "@/lib/api";
import { appendMemory, runInSandbox, writeDataset } from "@/lib/admin-sandbox";
import { formatPrice } from "@/lib/format";
import { getAllCategories, handleStoreError, searchProducts } from "@/lib/tools";

/**
 * Read-only back-office tools for the store admin agent. Each `execute` is a
 * Workflow step (retried on transient store failures). Inputs mirror the
 * filters of the starter's API helpers; results keep the API's metadata
 * (date window, totals, pagination) and give money both as integer cents
 * (for calculations) and formatted. Nothing here can change store data.
 */

const MAX_ROWS_TO_MODEL = 100;

const date = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/, "Use YYYY-MM-DD or an ISO 8601 datetime.");

const dateRange = {
  from: date.optional().describe("Start date (YYYY-MM-DD or ISO). Defaults to 30 days before `to`."),
  to: date.optional().describe("End date (YYYY-MM-DD or ISO). Defaults to now."),
};

/**
 * Save the full dataset (every row, not just what the model sees) into the
 * admin sandbox for calculations. A sandbox problem never hides the data.
 */
async function saveForSandbox(
  workspace: string,
  name: string,
  value: { filters: unknown; meta: unknown; rows: object[] },
): Promise<{ path: string; rowCount: number; rowFields: string[] } | null> {
  try {
    const path = await writeDataset(workspace, name, value);
    // Tell the agent exactly how the file is shaped, so commands don't guess.
    return { path, rowCount: value.rows.length, rowFields: Object.keys(value.rows[0] ?? {}) };
  } catch (err) {
    console.error(`[admin-tools] couldn't save ${name} to the sandbox`, err instanceof Error ? err.message : err);
    return null;
  }
}

function capped<T>(rows: T[]) {
  return {
    rows: rows.slice(0, MAX_ROWS_TO_MODEL),
    truncated: rows.length > MAX_ROWS_TO_MODEL,
  };
}

// --- Steps -------------------------------------------------------------------

export async function getSupportTicketsStep(input: {
  from?: string;
  to?: string;
  status?: "open" | "pending" | "resolved" | "closed";
  priority?: "low" | "normal" | "high" | "urgent";
  category?:
    | "shipping"
    | "returns"
    | "product_quality"
    | "sizing"
    | "billing"
    | "payment"
    | "account"
    | "other";
  assignee?: string;
  limit?: number;
}, workspace: string) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(input);
    const all = data.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        assignee: t.assignee,
        customerEmail: t.customerEmail,
        relatedOrderId: t.relatedOrderId,
        relatedReturnId: t.relatedReturnId,
        preview: t.messagePreview,
        createdAt: t.createdAt,
        lastMessageAt: t.lastMessageAt,
      }));
    const sandboxFile = await saveForSandbox(workspace, "support-tickets", { filters: input, meta, rows: all });
    const { rows, truncated } = capped(all);
    return {
      status: "ok" as const,
      range: { from: meta.from, to: meta.to },
      count: meta.count,
      truncated,
      sandboxFile,
      tickets: rows,
    };
  } catch (err) {
    return handleStoreError(err, "support tickets");
  }
}

export async function getReturnsHistoryStep(input: {
  from?: string;
  to?: string;
  status?: "pending" | "processing" | "completed";
  decision?: "approved" | "rejected" | "needs_info";
  limit?: number;
}, workspace: string) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeReturns(input);
    const all = data.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        decision: r.decision,
        reason: r.reason,
        items: r.items,
        refundCents: r.refundAmount,
        refund: r.refundAmount != null ? formatPrice(r.refundAmount) : null,
        orderTotal: r.order ? formatPrice(r.order.total) : null,
        orderStatus: r.order?.status ?? null,
        notes: r.notes,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      }));
    const sandboxFile = await saveForSandbox(workspace, "returns", { filters: input, meta, rows: all });
    const { rows, truncated } = capped(all);
    return {
      status: "ok" as const,
      range: { from: meta.from, to: meta.to },
      count: meta.count,
      truncated,
      sandboxFile,
      returns: rows,
    };
  } catch (err) {
    return handleStoreError(err, "returns");
  }
}

export async function getInventoryStockStep(input: {
  productIds?: string[];
  lowStock?: boolean;
  inStock?: boolean;
  page?: number;
  limit?: number;
}, workspace: string) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock(input);
    const stock = data.map((s) => ({
        productId: s.productId,
        name: s.product.name,
        category: s.product.category,
        stock: s.stock,
        inStock: s.inStock,
        lowStock: s.lowStock,
        updatedAt: s.updatedAt,
      }));
    const sandboxFile = await saveForSandbox(workspace, "inventory", { filters: input, meta, rows: stock });
    // Ids the store doesn't know come back as no rows; say so explicitly so a
    // wrong id is never read as "out of stock".
    const found = new Set(stock.map((s) => s.productId));
    const unknownProductIds = (input.productIds ?? []).filter((id) => !found.has(id));
    return {
      status: "ok" as const,
      pagination: meta.pagination,
      ...(unknownProductIds.length > 0 && {
        unknownProductIds,
        note: "No product exists with these ids (this is not a stock level). Get ids from tool results or searchProducts.",
      }),
      sandboxFile,
      stock,
    };
  } catch (err) {
    return handleStoreError(err, "inventory");
  }
}

export async function getSalesAnalyticsStep(input: {
  from?: string;
  to?: string;
  productId?: string;
}, workspace: string) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(input);
    const result = {
      status: "ok" as const,
      range: { from: meta.from, to: meta.to, days: meta.days },
      currency: meta.currency,
      totals: {
        unitsSold: meta.totals.unitsSold,
        ordersCount: meta.totals.ordersCount,
        revenueCents: meta.totals.revenue,
        revenue: formatPrice(meta.totals.revenue, meta.currency),
      },
      products: data.map((row) => ({
        productId: row.productId,
        name: row.product.name,
        category: row.product.category,
        unitsSold: row.unitsSold,
        ordersCount: row.ordersCount,
        revenueCents: row.revenue,
        revenue: formatPrice(row.revenue, row.currency),
      })),
    };
    const sandboxFile = await saveForSandbox(workspace, "sales", {
      filters: input,
      meta,
      rows: result.products,
    });
    return { ...result, sandboxFile };
  } catch (err) {
    return handleStoreError(err, "sales");
  }
}

export async function runSandboxCommandStep({ command }: { command: string }) {
  "use step";
  // Infrastructure errors throw (the step retries); a non-zero exit code is a
  // normal result the agent can read and fix.
  const result = await runInSandbox(command);
  return {
    status: result.exitCode === 0 ? ("ok" as const) : ("failed" as const),
    ...result,
  };
}

const SECRET_HINTS = /password|passwd|secret|token|api[_ -]?key|bypass|letmeinadminagent/i;

export async function saveMemoryStep({
  kind,
  note,
  today,
}: {
  kind: "preference" | "correction" | "business_context";
  note: string;
  today: string;
}) {
  "use step";
  const bypass = process.env.BYPASS_SECRET;
  if (SECRET_HINTS.test(note) || (bypass && note.includes(bypass))) {
    return {
      status: "invalid" as const,
      message: "Memory can't store credentials, passwords or secrets.",
    };
  }
  const memory = await appendMemory(kind, note, today);
  return { status: "saved" as const, kind, note, entries: memory.split("\n").filter(Boolean).length };
}

// --- Tool definitions ----------------------------------------------------------

const getSupportTickets = (workspace: string) => tool({
  description:
    "Read support tickets, newest first. Filter by date range, status, priority, category, assignee (staff username) and limit. Read-only.",
  inputSchema: z.object({
    ...dateRange,
    status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    category: z
      .enum(["shipping", "returns", "product_quality", "sizing", "billing", "payment", "account", "other"])
      .optional(),
    assignee: z
      .string()
      .trim()
      .regex(/^[a-z0-9._-]{1,40}$/i)
      .optional()
      .describe("Staff username, e.g. 'alex'. Unassigned tickets are excluded when set."),
    limit: z.number().int().min(1).max(500).optional().describe("1-500, default 25."),
  }),
  execute: (input) => getSupportTicketsStep(input, workspace),
});

const getReturnsHistory = (workspace: string) => tool({
  description:
    "Read historical returns with their order and refund details. Filter by date range, status, decision and limit. Read-only.",
  inputSchema: z.object({
    ...dateRange,
    status: z.enum(["pending", "processing", "completed"]).optional(),
    decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
    limit: z.number().int().min(1).max(500).optional().describe("1-500, default 25."),
  }),
  execute: (input) => getReturnsHistoryStep(input, workspace),
});

const getInventoryStock = (workspace: string) => tool({
  description:
    "Read current stock levels. Filter by product ids, low stock (1-5 units) and in stock; results are paginated (page, limit up to 200). Read-only.",
  inputSchema: z.object({
    productIds: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    lowStock: z.boolean().optional().describe("true: only 1-5 units left; false: exclude those."),
    inStock: z.boolean().optional().describe("true: only products with stock; false: only out of stock."),
    page: z.number().int().min(1).optional().describe("1-based page number, default 1."),
    limit: z.number().int().min(1).max(200).optional().describe("1-200, default 50."),
  }),
  execute: (input) => getInventoryStockStep(input, workspace),
});

const getSalesAnalytics = (workspace: string) => tool({
  description:
    "Read sales totals per product (units, orders, revenue) for a date range, optionally for one product. Read-only.",
  inputSchema: z.object({
    ...dateRange,
    productId: z.string().trim().min(1).max(120).optional().describe("Restrict to one product id."),
  }),
  execute: (input) => getSalesAnalyticsStep(input, workspace),
});

export const bash = tool({
  description:
    "Run a bash command in the admin's isolated Vercel Sandbox (no internet access, 60 s limit). Use it for every calculation over fetched data: each back-office tool result has sandboxFile { path, rowCount, rowFields }; the file is JSON { filters, meta, rows: [...] } where every row has exactly rowFields. jq, node and python3 are available. The command is bash, not Python: run Python with a quoted heredoc so no escaping is needed, e.g. python3 - <<'PY' (newline) script lines (newline) PY. Returns exit code, stdout and stderr.",
  inputSchema: z.object({
    command: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("The bash command, e.g. jq over a sandboxFile.path. Runs in /vercel/sandbox."),
  }),
  execute: runSandboxCommandStep,
});

function createSaveMemoryTool(today: string) {
  return tool({
    description:
      "Save a durable note to the admin's memory file (kept across conversations): an employee preference, a correction to something you got wrong, or business context. Never save secrets or store data that changes (sales, stock).",
    inputSchema: z.object({
      kind: z.enum(["preference", "correction", "business_context"]),
      note: z
        .string()
        .trim()
        .min(5)
        .max(500)
        .describe("One concise, self-contained sentence, e.g. 'Report revenue weekly from Monday to Sunday.'"),
    }),
    execute: ({ kind, note }) => saveMemoryStep({ kind, note, today }),
  });
}

/**
 * The admin agent's tools for one conversation: `today` dates memory notes and
 * `workspace` is the conversation's own data folder in the sandbox.
 */
export function createAdminTools(today: string, workspace: string) {
  return {
    getSupportTickets: getSupportTickets(workspace),
    getReturnsHistory: getReturnsHistory(workspace),
    getInventoryStock: getInventoryStock(workspace),
    getSalesAnalytics: getSalesAnalytics(workspace),
    // Catalog context: identify products before combining back-office data.
    searchProducts,
    getAllCategories,
    bash,
    saveMemory: createSaveMemoryTool(today),
  };
}

/** Tool set shape for the chat's message types (values are placeholders). */
export const adminTools = createAdminTools("1970-01-01", "types");
