import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  ApiRequestError,
  getCategories,
  getProductById,
  getProducts,
  getProductStock,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Shopping-agent tools. Every tool:
 * - validates its input with Zod (the model sees the schema descriptions),
 * - reads facts from the store API instead of letting the model guess,
 * - returns a small, UI-ready result: `{ status: "ok", ... }` on success,
 *   `{ status: "not_found" | "invalid" | "error", message }` otherwise, so the
 *   agent can explain the problem instead of inventing a successful outcome.
 * No result ever contains the API base URL, the bypass secret or raw errors.
 */

const SEARCH_LIMIT_MAX = 30;
const CATALOG_LIMIT = 100;

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
  status: "not_found" | "invalid" | "error";
  message: string;
};

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

/** A message that is safe to show the shopper: no URLs, secrets or stack traces. */
function failure(err: unknown, what: string): ToolFailure {
  if (err instanceof ApiRequestError && err.status === 404) {
    return { status: "not_found", message: `No ${what} matches that request.` };
  }
  if (err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) {
    return { status: "invalid", message: `The store rejected that ${what} request as invalid.` };
  }
  console.error(
    `[tools] ${what} lookup failed`,
    err instanceof ApiRequestError ? { status: err.status, code: err.code } : err,
  );
  return {
    status: "error",
    message: `The store couldn't be reached to look up ${what}. Please try again in a moment.`,
  };
}

export const getAllCategories = tool({
  description:
    "List the store's current product categories with their slugs and product counts. Use it to discover valid category filters; never assume a category exists.",
  inputSchema: z.object({}),
  execute: async () => {
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
      return failure(err, "categories");
    }
  },
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
  execute: async ({ query, category, limit }) => {
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
      return failure(err, "products");
    }
  },
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
  execute: async ({ productId }) => {
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
      return failure(err, "product");
    }
  },
});

export const shoppingTools = {
  searchProducts,
  getAllCategories,
  getProductDetails,
};
