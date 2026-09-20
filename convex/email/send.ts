import { v } from "convex/values";
import type { DeliveryStatus } from "../../shared/contracts";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { action, type ActionCtx } from "../_generated/server";
import { send as sendEmail } from "./adapter";

type Delivery = {
  reportId: Id<"reports">;
  recipient: string;
  scope: string;
  idempotencyKey: string;
  subject: string;
  body: string;
};

// The action reaches its own module through `internal`, so these return types are
// written out or the inference cycles.
type Receipt = {
  messageId: string;
  threadId: string;
  deliveryStatus: DeliveryStatus;
  consentId: Id<"consents">;
};

/**
 * The one door every outbound report email goes through, so the consent gate,
 * the AgentMail send and the message row cannot drift apart. The guard is called
 * with the exact recipient and scope about to be sent, and a refusal is a typed
 * ConvexError the caller branches on, so no mail leaves for a revoked consent.
 */
export async function deliver(ctx: ActionCtx, delivery: Delivery): Promise<Receipt> {
  const consent = await ctx.runQuery(internal.consents.guard.requireConsent, {
    reportId: delivery.reportId,
    recipient: delivery.recipient,
    scope: delivery.scope,
  });
  const { messageId, threadId, deliveryStatus } = await sendEmail({
    to: delivery.recipient,
    subject: delivery.subject,
    body: delivery.body,
    idempotencyKey: delivery.idempotencyKey,
  });
  await ctx.runMutation(internal.email.ingest.recordOutbound, {
    agentmailThreadId: threadId,
    agentmailMessageId: messageId,
    body: delivery.body,
    deliveryStatus,
  });
  return { messageId, threadId, deliveryStatus, consentId: consent.consentId };
}

/** The stored artifact is what the person previewed, so it is read back rather than re-rendered. */
export async function storedReport(
  ctx: ActionCtx,
  reportId: Id<"reports">,
): Promise<{ subjectName: string; html: string }> {
  const report = await ctx.runQuery(internal.reports.build.reportForDelivery, { reportId });
  const blob = await ctx.storage.get(report.fileId);
  if (!blob) throw new Error(`Report ${reportId} has no stored file`);
  return { subjectName: report.subjectName, html: await blob.text() };
}

// The consent screen calls this once the person has seen the report, the
// recipient and the scope, and only then does the brief go out. The idempotency
// key is the report itself: the same brief to the same address is one logical
// send, so a retried action cannot mail it twice.
export const sendReport = action({
  args: { reportId: v.id("reports"), recipient: v.string(), scope: v.string() },
  returns: v.object({
    messageId: v.string(),
    threadId: v.string(),
    deliveryStatus: v.string(),
    consentId: v.id("consents"),
  }),
  handler: async (ctx, { reportId, recipient, scope }): Promise<Receipt> => {
    const { subjectName, html } = await storedReport(ctx, reportId);
    return await deliver(ctx, {
      reportId,
      recipient,
      scope,
      idempotencyKey: `report-${reportId}`,
      subject: `Remi visit brief for ${subjectName}`,
      body: html,
    });
  },
});
