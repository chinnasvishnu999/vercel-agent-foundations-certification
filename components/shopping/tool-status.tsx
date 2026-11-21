import { AlertCircle, Loader2, SearchX } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

/** Progress for a running lookup: a spinner with a plain label and a skeleton. */
export function ToolPending({ label, cards = 0 }: { label: string; cards?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </p>
      {cards > 0 && (
        <div className="grid grid-cols-2 gap-2" aria-hidden="true">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A lookup that didn't produce a result. "not_found" and "invalid" are normal
 * answers (shown calmly); "error" means the store couldn't be reached.
 */
export function ToolProblem({
  kind,
  message,
}: {
  kind: "not_found" | "invalid" | "error";
  message: string;
}) {
  const isError = kind === "error";
  const Icon = isError ? AlertCircle : SearchX;
  return (
    <p
      className={
        isError
          ? "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          : "flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground"
      }
      role={isError ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
