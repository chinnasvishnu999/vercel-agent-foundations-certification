import { AlertCircle, BookmarkCheck, Database, Loader2, SearchX } from "lucide-react";

import type { AdminUIMessage } from "@/lib/admin-agent-types";

type AdminPart = AdminUIMessage["parts"][number];
export type AdminToolPart = Extract<AdminPart, { type: `tool-${string}` }>;

const LABELS: Record<string, { running: string; done: string }> = {
  "tool-getSupportTickets": { running: "Reading support tickets…", done: "Support tickets" },
  "tool-getReturnsHistory": { running: "Reading returns history…", done: "Returns" },
  "tool-getInventoryStock": { running: "Reading inventory…", done: "Inventory" },
  "tool-getSalesAnalytics": { running: "Reading sales…", done: "Sales" },
  "tool-searchProducts": { running: "Searching the catalog…", done: "Catalog search" },
  "tool-getAllCategories": { running: "Loading categories…", done: "Categories" },
  "tool-saveMemory": { running: "Saving to memory…", done: "Memory" },
};

function day(iso: string) {
  return iso.slice(0, 10);
}

/** One line describing what data a lookup returned (the agent explains it). */
function summary(output: Record<string, unknown>): string {
  const parts: string[] = [];
  const range = output.range as { from: string; to: string } | undefined;
  if (typeof output.count === "number") parts.push(`${output.count} records`);
  if (Array.isArray(output.stock)) {
    const page = output.pagination as { page: number; totalPages: number; total: number } | undefined;
    parts.push(`${output.stock.length} products${page ? ` (page ${page.page} of ${page.totalPages}, ${page.total} total)` : ""}`);
  }
  if (Array.isArray(output.products)) parts.push(`${output.products.length} products`);
  if (Array.isArray(output.categories)) parts.push(`${output.categories.length} categories`);
  const totals = output.totals as { revenue?: string; unitsSold?: number } | undefined;
  if (totals?.revenue) parts.push(`${totals.revenue} revenue, ${totals.unitsSold} units`);
  if (range) parts.push(`${day(range.from)} → ${day(range.to)}`);
  if (output.truncated) parts.push("first 100 shown to the agent");
  const file = output.sandboxFile as { path?: string } | null | undefined;
  if (file?.path) parts.push(`saved to sandbox ${file.path}`);
  return parts.join(" · ");
}

/** Compact, accessible status for an admin data lookup: running, failed or done. */
export function AdminToolResult({ part }: { part: AdminToolPart }) {
  const label = LABELS[part.type] ?? { running: "Working…", done: "Lookup" };
  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {label.running}
      </p>
    );
  }
  if (part.state === "output-error") {
    return (
      <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
        <AlertCircle className="size-3.5" aria-hidden="true" />
        {label.done}: the lookup failed after retries.
      </p>
    );
  }
  if (part.state !== "output-available") return null;
  const output = part.output as Record<string, unknown> & { status: string; message?: string };
  if (output.status === "saved" || output.status === "already_saved") {
    return (
      <p className="flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground" role="status">
        <BookmarkCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground">
            {output.status === "saved" ? "Saved to memory" : "Already in memory"}
          </span>{" "}
          · {String(output.note)}
        </span>
      </p>
    );
  }
  if (output.status !== "ok") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <SearchX className="size-3.5" aria-hidden="true" />
        {label.done}: {output.message}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
      <Database className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground">{label.done}</span> · {summary(output)}
      </span>
    </p>
  );
}
