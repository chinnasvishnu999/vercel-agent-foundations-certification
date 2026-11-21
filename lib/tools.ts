// Server-side only. These modules run in Next.js route handlers and in
// Workflow steps (which don't load the React Server Components "server-only"
// guard). The browser only imports their *types* via `import type`.

import { tool } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import {
  ApiRequestError,
  getCategories,
  getOrder,
  getProductById,
  getProducts,
  getProductStock,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/lib/types";
import { returnOrderFlow } from "@/lib/workflows/return-flow";

/**
 * Shopping-agent tools. Each `execute` is a Workflow step ("use step"), so it
 * runs durably inside the chat workflow:
 * - inputs are validated with Zod (the model sees the schema descriptions);
 * - facts come from the store API, never from the model;
 * - definite answers return `{ status: "ok" | "not_found" | "invalid", ... }`
 *   so the agent can explain them instead of inventing success;
 * - transient failures (network, 429, 5xx) are THROWN so the workflow retries
 *   the step; if every retry fails the agent receives a tool error.
 * No result or error ever contains the API base URL, the bypass secret or raw
 * upstream errors.
 */

const SEARCH_LIMIT_MAX = 30;
const CATALOG_LIMIT = 100;

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: string;
  image: string | null;
  url: string;
};

export type ToolFailure = {
  status: "not_found" | "invalid";
  message: string;
};

/** Lowercase word stems: "Black Mugs" → ["black", "mug"]. */
function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * The store API matches `search` as one exact substring, so "black mug" or
 * "mugs" find nothing. When that happens, match every keyword against the
 * product's name, category, tags and description instead.
 */
function matchesAllKeywords(product: Product, words: string[]): boolean {
  const haystack = [product.name, product.category, product.description, ...product.tags]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return words.every((w) => haystack.includes(w));
}

function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: formatPrice(product.price, product.currency),
    image: product.images[0] ?? null,
    url: `/products/${product.slug}`,
  };
}

/**
 * Turn a store error into a definite answer (not found / invalid) or rethrow a
 * sanitized error for transient failures so the workflow step is retried.
 */
export function handleStoreError(err: unknown, what: string): ToolFailure {
  if (err instanceof ApiRequestError && err.status === 404) {
    return { status: "not_found", message: `No ${what} matches that request.` };
  }
  if (err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) {
    return { status: "invalid", message: `The store rejected that ${what} request as invalid.` };
  }
  const status = err instanceof ApiRequestError ? err.status : 0;
  console.error(`[tools] ${what} lookup failed`, { status });
  throw new Error(`The store couldn't be reached to look up ${what} (status ${status || "network"}).`);
}

// --- Steps -------------------------------------------------------------------

export async function getAllCategoriesStep() {
  "use step";
  try {
    const categories = await getCategories();
    return {
      status: "ok" as const,
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      })),
    };
  } catch (err) {
    return handleStoreError(err, "categories");
  }
}

export async function searchProductsStep({
  query,
  category,
  limit,
}: {
  query?: string;
  category?: string;
  limit?: number;
}) {
  "use step";
  const max = limit ?? (query || category ? 12 : SEARCH_LIMIT_MAX);
  try {
    if (category) {
      const slugs = (await getCategories()).map((c) => c.slug);
      if (!slugs.includes(category)) {
        return {
          status: "invalid" as const,
          message: `"${category}" isn't a store category. Valid categories: ${slugs.join(", ")}.`,
        };
      }
    }
    let products = await getProducts({
      search: query || undefined,
      category: category || undefined,
      limit: max,
    });
    const words = query ? keywords(query) : [];
    if (products.length === 0 && words.length > 0) {
      const catalog = await getProducts({ category: category || undefined, limit: CATALOG_LIMIT });
      products = catalog.filter((p) => matchesAllKeywords(p, words)).slice(0, max);
    }
    return {
      status: "ok" as const,
      query: query ?? null,
      category: category ?? null,
      products: products.map(toSummary),
    };
  } catch (err) {
    return handleStoreError(err, "products");
  }
}

export async function getProductDetailsStep({ productId }: { productId: string }) {
  "use step";
  try {
    const product = await getProductById(productId);
    // Stock is live data; a stock outage shouldn't hide the product itself.
    const stock = await getProductStock(product.id).catch(() => null);
    return {
      status: "ok" as const,
      product: {
        ...toSummary(product),
        description: product.description,
        images: product.images,
        tags: product.tags,
        // Raw values for the chat's Add to cart button (the cart works in cents).
        priceCents: product.price,
        currency: product.currency,
        stock: stock
          ? { inStock: stock.inStock, lowStock: stock.lowStock, quantity: stock.stock }
          : null,
      },
    };
  } catch (err) {
    return handleStoreError(err, "product");
  }
}

// --- Tool definitions ----------------------------------------------------------

export const getAllCategories = tool({
  description:
    "List the store's current product categories with their slugs and product counts. Use it to discover valid category filters; never assume a category exists.",
  inputSchema: z.object({}),
  execute: getAllCategoriesStep,
});

export const searchProducts = tool({
  description:
    "Search the product catalog. Pass `query` for free-text search, `category` (a slug from getAllCategories) to narrow results, both, or neither to browse the full catalog.",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe("Free-text search terms, e.g. 'hoodie' or 'black bottle'. Omit to browse."),
    category: z
      .string()
      .trim()
      .max(50)
      .optional()
      .describe("Category slug from getAllCategories, e.g. 'hoodies'."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_LIMIT_MAX)
      .optional()
      .describe(
        `Maximum products to return (1-${SEARCH_LIMIT_MAX}). Defaults to 12, or the whole catalog when browsing with no query or category.`,
      ),
  }),
  execute: searchProductsStep,
});

export const getProductDetails = tool({
  description:
    "Get full details for one product by its id or slug (from searchProducts): description, price, images, tags and live stock.",
  inputSchema: z.object({
    productId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Product id (e.g. 'bottle_001') or slug from a search result."),
  }),
  execute: getProductDetailsStep,
});

// --- Returns ---------------------------------------------------------------------

const RETURNABLE_STATUSES = new Set(["fulfilled", "shipped", "delivered"]);

/**
 * Validates the order, then starts the durable return workflow and returns at
 * once, so the chat can confirm the return is filed without waiting for it.
 * The customer notification, refund pre-authorization and filing happen in
 * returnOrderFlow; the shopper can follow progress on the return card.
 */
export async function returnOrderStep({
  orderId,
  reason,
  productIds,
  productNames,
}: {
  orderId: string;
  reason: string;
  productIds?: string[];
  productNames?: string[];
}) {
  "use step";
  let order;
  try {
    order = await getOrder(orderId);
  } catch (err) {
    return handleStoreError(err, "order");
  }
  if (!RETURNABLE_STATUSES.has(order.status)) {
    const why =
      order.status === "paid"
        ? "it hasn't shipped yet"
        : order.status === "cancelled"
          ? "it was cancelled"
          : `its status is "${order.status}"`;
    return {
      status: "invalid" as const,
      message: `Order ${orderId} can't be returned because ${why}.`,
    };
  }

  const itemName = (item: (typeof order.items)[number]) =>
    (item as { product?: { name?: string } }).product?.name ?? item.productId;
  const ids = productIds?.length ? new Set(productIds) : null;
  const names = productNames?.length ? productNames.map(keywords).filter((w) => w.length > 0) : null;
  const lines = order.items.filter((item) => {
    if (!ids && !names) return true;
    if (ids?.has(item.productId)) return true;
    const label = `${itemName(item)} ${item.productId}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return names?.some((words) => words.every((w) => label.includes(w))) ?? false;
  });
  if (lines.length === 0) {
    return {
      status: "invalid" as const,
      message: `None of those products are in order ${orderId}. It contains: ${order.items.map(itemName).join(", ")}.`,
    };
  }

  const run = await start(returnOrderFlow, [
    {
      orderId,
      reason,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    },
  ]);

  return {
    status: "filed" as const,
    orderId,
    trackingId: run.runId,
    reason,
    items: lines.map((l) => ({
      productId: l.productId,
      name: itemName(l),
      quantity: l.quantity,
      lineTotal: formatPrice(l.lineTotal, order.currency),
    })),
  };
}

export const returnOrder = tool({
  description:
    "File a return for a delivered order. Requires the order number and the shopper's reason. Optionally limit it to some products in the order; otherwise every item is returned. The return is processed in the background (customer notified, refund pre-authorized, return filed) and the result is shown to the shopper.",
  inputSchema: z.object({
    orderId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,40}$/, "Order numbers contain only letters, digits, - and _.")
      .describe("The order number, e.g. '11111'."),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .describe("Why the shopper is returning it, in their words (3-500 characters)."),
    productIds: z
      .array(z.string().trim().min(1).max(120))
      .max(20)
      .optional()
      .describe("Product ids from the order to return. Omit both lists to return the whole order."),
    productNames: z
      .array(z.string().trim().min(2).max(120))
      .max(20)
      .optional()
      .describe("Product names the shopper mentioned, e.g. 'hoodie'. Matched against the order's items."),
  }),
  execute: returnOrderStep,
});

export const shoppingTools = {
  searchProducts,
  getAllCategories,
  getProductDetails,
  returnOrder,
};
