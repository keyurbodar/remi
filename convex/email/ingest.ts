import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";

// emailThreads carries no index on agentmailThreadId, so this scan is deliberate:
// the table holds one row per thread and the webhook needs that row before it can
// attach a message to it.
const threadIdFor = async (ctx: MutationCtx, agentmailThreadId: string) => {
  const thread = await ctx.db
    .query("emailThreads")
    .filter((q) => q.eq(q.field("agentmailThreadId"), agentmailThreadId))
    .first();
  return thread?._id ?? (await ctx.db.insert("emailThreads", { agentmailThreadId }));
};

// The send path records what AgentMail accepted. AgentMail retries, so a repeat of
// the same message id returns the row the first attempt wrote instead of a second.
export const recordOutbound = internalMutation({
  args: {
    agentmailThreadId: v.string(),
    agentmailMessageId: v.string(),
    body: v.string(),
    deliveryStatus: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, { agentmailThreadId, agentmailMessageId, body, deliveryStatus }) => {
    const sent = await ctx.db
      .query("messages")
      .withIndex("by_agentmail_message_id", (q) => q.eq("agentmailMessageId", agentmailMessageId))
      .first();
    if (sent) return sent._id;
    return await ctx.db.insert("messages", {
      threadId: await threadIdFor(ctx, agentmailThreadId),
      direction: "outbound",
      agentmailMessageId,
      body,
      deliveryStatus,
      receivedAt: Date.now(),
    });
  },
});

// The inbound webhook replays a delivery it already handled, and a replay has to
// leave exactly one row behind.
export const recordInbound = internalMutation({
  args: {
    agentmailThreadId: v.string(),
    agentmailMessageId: v.string(),
    body: v.string(),
    receivedAt: v.number(),
  },
  returns: v.object({ messageId: v.id("messages"), inserted: v.boolean() }),
  handler: async (ctx, { agentmailThreadId, agentmailMessageId, body, receivedAt }) => {
    const stored = await ctx.db
      .query("messages")
      .withIndex("by_agentmail_message_id", (q) => q.eq("agentmailMessageId", agentmailMessageId))
      .first();
    if (stored) return { messageId: stored._id, inserted: false };
    return {
      messageId: await ctx.db.insert("messages", {
        threadId: await threadIdFor(ctx, agentmailThreadId),
        direction: "inbound",
        agentmailMessageId,
        body,
        deliveryStatus: "received",
        receivedAt,
      }),
      inserted: true,
    };
  },
});

// AgentMail reports delivery for messages this deployment never sent, so an unknown
// id is a no-op rather than an error. delivered and bounced are the end of the
// line: a later weaker event must not reopen them.
export const recordDelivery = internalMutation({
  args: { agentmailMessageId: v.string(), deliveryStatus: v.string() },
  returns: v.null(),
  handler: async (ctx, { agentmailMessageId, deliveryStatus }) => {
    const message = await ctx.db
      .query("messages")
      .withIndex("by_agentmail_message_id", (q) => q.eq("agentmailMessageId", agentmailMessageId))
      .first();
    if (message === null || message.deliveryStatus === "delivered" || message.deliveryStatus === "bounced") {
      return null;
    }
    await ctx.db.patch(message._id, { deliveryStatus });
    return null;
  },
});

// The classification action reads the body from here, so it classifies the row the
// webhook stored rather than the payload a retry carried.
export const messageForClassification = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.object({ messageId: v.id("messages"), body: v.string(), receivedAt: v.number() }),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (message === null) throw new Error(`Unknown message: ${messageId}`);
    return { messageId, body: message.body, receivedAt: message.receivedAt };
  },
});

// The verification script drives this through the Convex CLI to read back what the
// send and webhook paths actually wrote.
export const listMessages = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      messageId: v.id("messages"),
      direction: v.union(v.literal("outbound"), v.literal("inbound")),
      agentmailMessageId: v.string(),
      body: v.string(),
      deliveryStatus: v.string(),
      classification: v.union(v.string(), v.null()),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("messages").collect();
    return rows
      .sort((left, right) => right.receivedAt - left.receivedAt)
      .map(({ _id, direction, agentmailMessageId, body, deliveryStatus, classification, receivedAt }) => ({
        messageId: _id,
        direction,
        agentmailMessageId,
        body,
        deliveryStatus,
        classification: classification ?? null,
        receivedAt,
      }));
  },
});

export const recordClassification = internalMutation({
  args: { messageId: v.id("messages"), classification: v.string() },
  returns: v.null(),
  handler: async (ctx, { messageId, classification }) => {
    await ctx.db.patch(messageId, { classification });
    return null;
  },
});
