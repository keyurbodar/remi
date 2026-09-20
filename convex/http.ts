import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { parseDeliveryEvent, parseReceived } from "./email/adapter";

// Root route so the convex.site URL serves the deployment before the
// frontend exists.
const serveSpine = httpAction(async () => {
  return new Response(
    "<!doctype html><title>Remi</title><h1>Remi backend spine</h1><p>Contracts frozen, schema deployed, seed data loaded.</p>",
    { headers: { "content-type": "text/html" } },
  );
});

/**
 * AgentMail delivers every message event here, signed by Svix. The signature is
 * checked against the raw body before anything is read, so an unsigned or forged
 * request never reaches the database. The body is not parsed until it verifies.
 *
 * A received message is written once and then classified out of band, because
 * classification is a JEV call and AgentMail should not wait on it. Replayed
 * deliveries are the normal case, not an error: the write is keyed on
 * `agentmailMessageId`, so a replay lands as one row.
 */
const receiveAgentMail = httpAction(async (ctx, request) => {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) throw new Error("AGENTMAIL_WEBHOOK_SECRET is unset");
  const raw = await request.text();
  // Only the three Svix headers are read, so the record is built by name rather
  // than spread from Headers, which is not iterable in every runtime.
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };
  try {
    new Webhook(secret).verify(raw, headers);
  } catch {
    return new Response("signature verification failed", { status: 400 });
  }

  const event = JSON.parse(raw) as { event_type?: string; message?: unknown };
  if (event.event_type === "message.received") {
    const received = parseReceived(event.message);
    if (received === null) return new Response("unusable message payload", { status: 400 });
    const { messageId, inserted } = await ctx.runMutation(internal.email.ingest.recordInbound, {
      agentmailThreadId: received.agentmailThreadId,
      agentmailMessageId: received.agentmailMessageId,
      body: received.body,
      receivedAt: received.receivedAt,
    });
    if (inserted) {
      await ctx.scheduler.runAfter(0, internal.email.classify.classifyInbound, { messageId });
    }
    return new Response(null, { status: 204 });
  }

  if (
    event.event_type === "message.sent" ||
    event.event_type === "message.delivered" ||
    event.event_type === "message.bounced" ||
    event.event_type === "message.rejected" ||
    event.event_type === "message.complained"
  ) {
    const delivery = parseDeliveryEvent(event);
    if (delivery === null) return new Response("unusable delivery payload", { status: 400 });
    await ctx.runMutation(internal.email.ingest.recordDelivery, delivery);
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
});

const http = httpRouter();

http.route({ path: "/", method: "GET", handler: serveSpine });
http.route({ path: "/api/agentmail", method: "POST", handler: receiveAgentMail });

export default http;
