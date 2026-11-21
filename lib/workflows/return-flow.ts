import { FatalError, createWebhook, sleep } from "workflow";

import {
  ApiRequestError,
  createReturn,
  getOrder,
  getReturnStatus,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";

/**
 * A customer return as a durable workflow, started by the shopping agent's
 * returnOrder tool so the chat can confirm right away while this keeps
 * running in the background.
 *
 * Each action is its own step, run in this order: look up the order, notify
 * the customer, pre-authorize the refund, file the return. Workflow steps are
 * recorded once they finish, so if a later step fails and is retried (or the
 * run resumes after a crash or deploy), finished steps such as the customer
 * notification and the refund pre-authorization are NOT repeated.
 *
 * The store decides the return 15-60 s after filing and POSTs the decision to
 * the webhook passed as `callback` (on the public production domain in
 * production). If it doesn't arrive within 90 s, the workflow polls the
 * return every 30 s until a decision is recorded.
 */

export type ReturnItem = { productId: string; quantity: number };

export type ReturnRequest = {
  orderId: string;
  reason: string;
  items: ReturnItem[];
};

export type ReturnOutcome = {
  orderId: string;
  returnId: string;
  refundPreauthorization: { id: string; amount: string };
  decision: "approved" | "rejected" | "needs_info" | "pending";
  refundAmount: string | null;
  notes: string | null;
};

// The store decides 15-60 s after filing. Wait that long for its callback,
// then poll a few times in case the callback can't reach this deployment.
const CALLBACK_WAIT = "90s";
const POLL_INTERVAL = "30s";
const MAX_POLLS = 8;

/**
 * Webhook URLs are built from VERCEL_URL, the per-deployment address that
 * Vercel's deployment protection guards, so the store's callback would be
 * rejected. In production, send the store the public production domain
 * instead (the token still resumes this run). Elsewhere the URL is left as is
 * and the workflow relies on polling.
 */
function publicCallbackUrl(webhookUrl: string): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !productionHost) return webhookUrl;
  const url = new URL(webhookUrl);
  url.protocol = "https:";
  url.host = productionHost;
  return url.toString();
}

/** Map store errors: definite failures stop the workflow, others retry. */
function rethrow(err: unknown, action: string): never {
  if (err instanceof ApiRequestError && [400, 404, 422].includes(err.status)) {
    throw new FatalError(`${action} failed: ${err.message}`);
  }
  const status = err instanceof ApiRequestError ? err.status : 0;
  throw new Error(`${action} failed (status ${status || "network"}); will retry.`);
}

async function lookUpOrderStep(orderId: string) {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (order.status === "paid" || order.status === "cancelled") {
      throw new FatalError(`Order ${orderId} is ${order.status} and can't be returned.`);
    }
    return { id: order.id, status: order.status, currency: order.currency };
  } catch (err) {
    if (err instanceof FatalError) throw err;
    rethrow(err, "Order lookup");
  }
}

async function notifyCustomerStep(orderId: string) {
  "use step";
  await notifyReturnInProcess(orderId);
  return { notifiedAt: new Date().toISOString() };
}

async function preauthorizeRefundStep(orderId: string) {
  "use step";
  try {
    const auth = await preauthorizeRefund(orderId);
    return { id: auth.id, amount: formatPrice(auth.amount, auth.currency) };
  } catch (err) {
    rethrow(err, "Refund pre-authorization");
  }
}

async function fileReturnStep(request: ReturnRequest, callback: string) {
  "use step";
  try {
    const created = await createReturn({ ...request, callback: publicCallbackUrl(callback) });
    return { id: created.id, status: created.status };
  } catch (err) {
    rethrow(err, "Filing the return");
  }
}

async function readReturnDecisionStep(returnId: string, currency: string) {
  "use step";
  try {
    const ret = await getReturnStatus(returnId);
    // The store also returns "needs_info" (see the API reference), which the
    // starter's Return type doesn't list.
    const decision = (ret.decision ?? "pending") as ReturnOutcome["decision"];
    return {
      decision,
      refundAmount: ret.refundAmount != null ? formatPrice(ret.refundAmount, currency) : null,
      notes: ret.notes ?? null,
    };
  } catch (err) {
    rethrow(err, "Reading the return status");
  }
}

type DecisionPayload = {
  decision?: "approved" | "rejected" | "needs_info";
  refundAmount?: number | null;
  notes?: string | null;
};

export async function returnOrderFlow(request: ReturnRequest): Promise<ReturnOutcome> {
  "use workflow";

  const order = await lookUpOrderStep(request.orderId);
  await notifyCustomerStep(request.orderId);
  const preauth = await preauthorizeRefundStep(request.orderId);

  using webhook = createWebhook();
  const filed = await fileReturnStep(request, webhook.url);

  // Wait for the store's decision callback, or fall back to polling.
  const callback = await Promise.race([
    webhook.then(async (req) => (await req.json()) as DecisionPayload),
    sleep(CALLBACK_WAIT).then(() => null),
  ]);

  let decision: ReturnOutcome["decision"];
  let refundAmount: string | null;
  let notes: string | null;
  if (callback?.decision) {
    decision = callback.decision;
    refundAmount =
      callback.refundAmount != null ? formatPrice(callback.refundAmount, order.currency) : null;
    notes = callback.notes ?? null;
  } else {
    ({ decision, refundAmount, notes } = await readReturnDecisionStep(filed.id, order.currency));
    for (let poll = 1; decision === "pending" && poll < MAX_POLLS; poll++) {
      await sleep(POLL_INTERVAL);
      ({ decision, refundAmount, notes } = await readReturnDecisionStep(filed.id, order.currency));
    }
  }

  return {
    orderId: request.orderId,
    returnId: filed.id,
    refundPreauthorization: preauth,
    decision,
    refundAmount,
    notes,
  };
}
