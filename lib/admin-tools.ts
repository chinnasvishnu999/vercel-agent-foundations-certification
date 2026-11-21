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
}) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(input);
    const { rows, truncated } = capped(data);
    return {
      status: "ok" as const,
      range: { from: meta.from, to: meta.to },
      count: meta.count,
      truncated,
      tickets: rows.map((t) => ({
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
      })),
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
}) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeReturns(input);
    const { rows, truncated } = capped(data);
    return {
      status: "ok" as const,
      range: { from: meta.from, to: meta.to },
      count: meta.count,
      truncated,
      returns: rows.map((r) => ({
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
      })),
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
}) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock(input);
    return {
      status: "ok" as const,
      pagination: meta.pagination,
      stock: data.map((s) => ({
        productId: s.productId,
        name: s.product.name,
        category: s.product.category,
        stock: s.stock,
        inStock: s.inStock,
        lowStock: s.lowStock,
        updatedAt: s.updatedAt,
      })),
    };
  } catch (err) {
    return handleStoreError(err, "inventory");
  }
}

export async function getSalesAnalyticsStep(input: {
  from?: string;
  to?: string;
  productId?: string;
}) {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(input);
    return {
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
  } catch (err) {
    return handleStoreError(err, "sales");
  }
}

// --- Tool definitions ----------------------------------------------------------

export const getSupportTickets = tool({
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
  execute: getSupportTicketsStep,
});

export const getReturnsHistory = tool({
  description:
    "Read historical returns with their order and refund details. Filter by date range, status, decision and limit. Read-only.",
  inputSchema: z.object({
    ...dateRange,
    status: z.enum(["pending", "processing", "completed"]).optional(),
    decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
    limit: z.number().int().min(1).max(500).optional().describe("1-500, default 25."),
  }),
  execute: getReturnsHistoryStep,
});

export const getInventoryStock = tool({
  description:
    "Read current stock levels. Filter by product ids, low stock (1-5 units) and in stock; results are paginated (page, limit up to 200). Read-only.",
  inputSchema: z.object({
    productIds: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    lowStock: z.boolean().optional().describe("true: only 1-5 units left; false: exclude those."),
    inStock: z.boolean().optional().describe("true: only products with stock; false: only out of stock."),
    page: z.number().int().min(1).optional().describe("1-based page number, default 1."),
    limit: z.number().int().min(1).max(200).optional().describe("1-200, default 50."),
  }),
  execute: getInventoryStockStep,
});

export const getSalesAnalytics = tool({
  description:
    "Read sales totals per product (units, orders, revenue) for a date range, optionally for one product. Read-only.",
  inputSchema: z.object({
    ...dateRange,
    productId: z.string().trim().min(1).max(120).optional().describe("Restrict to one product id."),
  }),
  execute: getSalesAnalyticsStep,
});

export const adminTools = {
  getSupportTickets,
  getReturnsHistory,
  getInventoryStock,
  getSalesAnalytics,
  // Catalog context: identify products before combining back-office data.
  searchProducts,
  getAllCategories,
};
