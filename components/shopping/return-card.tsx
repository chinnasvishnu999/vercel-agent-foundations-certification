"use client";

import { CheckCircle2, CircleAlert, Clock, Loader2, PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";

export type FiledReturn = {
  status: "filed";
  orderId: string;
  trackingId: string;
  reason: string;
  items: { productId: string; name: string; quantity: number; lineTotal: string }[];
};

type Progress =
  | { state: "processing" }
  | { state: "failed" }
  | {
      state: "completed";
      returnId: string;
      decision: "approved" | "rejected" | "needs_info" | "pending";
      refundAmount: string | null;
      refundPreauthorized: string;
      notes: string | null;
    };

const POLL_MS = 5_000;
const POLL_LIMIT = 60; // about 5 minutes; the store decides within ~1 minute

const DECISION: Record<string, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  approved: { label: "Approved", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
  needs_info: { label: "More information needed", variant: "outline" },
  pending: { label: "Still under review", variant: "outline" },
};

/**
 * Confirms a filed return right away, then follows the background return
 * workflow (customer notified, refund pre-authorized, return filed, store
 * decision) by polling /api/returns/[trackingId] until it finishes.
 */
export function ReturnCard({ filed }: { filed: FiledReturn }) {
  const [progress, setProgress] = useState<Progress>({ state: "processing" });
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      polls += 1;
      try {
        const res = await fetch(`/api/returns/${encodeURIComponent(filed.trackingId)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const next = (await res.json()) as Progress;
          if (cancelled) return;
          setProgress(next);
          if (next.state !== "processing") return;
        }
      } catch {
        // Network blip: try again on the next tick.
      }
      if (cancelled) return;
      if (polls >= POLL_LIMIT) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, 1_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filed.trackingId]);

  const decision = progress.state === "completed" ? DECISION[progress.decision] : null;

  return (
    <article
      aria-label={`Return for order ${filed.orderId}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm"
    >
      <header className="flex items-start gap-2">
        <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex flex-col">
          <h3 className="font-semibold">Return filed for order {filed.orderId}</h3>
          <p className="text-xs text-muted-foreground">Reason: {filed.reason}</p>
        </div>
      </header>

      <ul className="flex flex-col gap-1" aria-label="Items being returned">
        {filed.items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-2 text-xs">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span className="text-muted-foreground">{item.lineTotal}</span>
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite" className="flex flex-col gap-1 border-t pt-2 text-xs">
        {progress.state === "processing" && !gaveUp && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Processing: notifying you, pre-authorizing the refund and waiting for the store&apos;s
            decision (usually under a minute).
          </p>
        )}
        {progress.state === "processing" && gaveUp && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            Your return is filed and still being reviewed. You&apos;ll get an email when it&apos;s
            decided.
          </p>
        )}
        {progress.state === "failed" && (
          <p className="flex items-center gap-2 text-destructive">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            We couldn&apos;t finish processing this return. Please contact support with order{" "}
            {filed.orderId}.
          </p>
        )}
        {progress.state === "completed" && decision && (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Decision: <Badge variant={decision.variant}>{decision.label}</Badge>
              {progress.refundAmount && progress.decision === "approved" && (
                <span>Refund {progress.refundAmount}</span>
              )}
            </p>
            {progress.notes && <p className="text-muted-foreground">{progress.notes}</p>}
          </>
        )}
      </div>
    </article>
  );
}
