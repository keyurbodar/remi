/**
 * AgentMail boundary: the only place that talks to api.agentmail.to.
 * Convex actions are its only callers, so AGENTMAIL_API_KEY stays server side.
 *
 * Remi's outbound mail is HTML, because the visit brief renders to styled HTML
 * and is sent as the message body rather than as a generated plain text note.
 * The send carries an Idempotency-Key so a retry of the same logical send
 * returns the original message instead of mailing the person twice.
 */
import type {
  AgentMailReceiveInput,
  AgentMailSendInput,
  AgentMailSendResult,
} from "../../shared/contracts";

// AgentMail issues one address per account inbox and the address is not a
// secret, so it lives beside the endpoint it belongs to.
const INBOX = "keyur@agentmail.to";
const API = "https://api.agentmail.to/v0";

export async function send(input: AgentMailSendInput): Promise<AgentMailSendResult> {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error("AGENTMAIL_API_KEY is unset");
  const response = await fetch(`${API}/inboxes/${encodeURIComponent(INBOX)}/messages/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({ to: [input.to], subject: input.subject, html: input.body }),
  });
  if (!response.ok) {
    throw new Error(`AgentMail send failed: ${response.status} ${await response.text()}`);
  }
  const { message_id, thread_id } = (await response.json()) as {
    message_id: string;
    thread_id: string;
  };
  // The send response carries no delivery state, so a send that returned is sent
  // and the delivery webhook is what moves it on from there.
  return { messageId: message_id, threadId: thread_id, deliveryStatus: "sent" };
}

// The webhook payload is untrusted until the signature verifies, so every field
// the message row needs is read here rather than at the write. `from` arrives as
// a string on the message payload and as a list on some event shapes, and neither
// is used by the row, so both collapse to one address.
const asText = (value: unknown): string => {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" ? one : "";
};

const requiredText = (value: unknown): string | undefined => {
  const one = asText(value);
  return one === "" ? undefined : one;
};

export function parseReceived(message: unknown): AgentMailReceiveInput | null {
  if (typeof message !== "object" || message === null) return null;
  const row = message as Record<string, unknown>;
  const agentmailMessageId = requiredText(row.message_id);
  const agentmailThreadId = requiredText(row.thread_id);
  const body = requiredText(row.text) ?? requiredText(row.preview) ?? requiredText(row.html);
  const receivedAt = Date.parse(asText(row.timestamp));
  if (
    agentmailMessageId === undefined ||
    agentmailThreadId === undefined ||
    body === undefined ||
    Number.isNaN(receivedAt)
  ) {
    return null;
  }
  return {
    agentmailMessageId,
    agentmailThreadId,
    from: asText(row.from) || asText(row.from_),
    subject: asText(row.subject),
    body,
    receivedAt,
  };
}

// Every event but message.received carries its own sub-object, and only that
// sub-object holds the message id.
const DELIVERY_PAYLOAD_KEY: Record<string, string> = {
  "message.sent": "send",
  "message.delivered": "delivery",
  "message.bounced": "bounce",
  "message.rejected": "reject",
  "message.complained": "complaint",
};

// A rejected or complained message is a failure rather than a state of its own,
// so those two land on the contract's `failed` and every stored value stays one
// of the delivery states the rest of the backend reads.
const DELIVERY_STATUS: Record<string, string> = {
  "message.sent": "sent",
  "message.delivered": "delivered",
  "message.bounced": "bounced",
  "message.rejected": "failed",
  "message.complained": "failed",
};

export function parseDeliveryEvent(
  event: { event_type?: string } & Record<string, unknown>,
): { agentmailMessageId: string; deliveryStatus: string } | null {
  const eventType = event.event_type ?? "";
  const payloadKey = DELIVERY_PAYLOAD_KEY[eventType];
  const deliveryStatus = DELIVERY_STATUS[eventType];
  if (payloadKey === undefined || deliveryStatus === undefined) return null;
  const payload = event[payloadKey];
  if (typeof payload !== "object" || payload === null) return null;
  const agentmailMessageId = requiredText((payload as Record<string, unknown>).message_id);
  return agentmailMessageId === undefined ? null : { agentmailMessageId, deliveryStatus };
}
