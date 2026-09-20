import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { classifyReply } from "../jev/adapter";

// The reminder reply path calls this once per inbound message. The frozen messages
// table carries a single optional string column for the classification, so the typed
// judgement travels as JSON.
export const classifyInbound = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.object({
    messageId: v.id("messages"),
    classification: v.string(),
    confidence: v.number(),
    redFlag: v.boolean(),
  }),
  // The handler return type is written out because this action reads its own
  // module through `internal`, and inference would otherwise cycle.
  handler: async (
    ctx,
    { messageId },
  ): Promise<{
    messageId: Id<"messages">;
    classification: string;
    confidence: number;
    redFlag: boolean;
  }> => {
    const { body } = await ctx.runQuery(internal.email.ingest.messageForClassification, { messageId });
    // The schema records no sender role, so a reply is treated as coming from the
    // person themselves.
    const { category, confidence, redFlag } = await classifyReply({ emailText: body, senderRole: "user" });
    await ctx.runMutation(internal.email.ingest.recordClassification, {
      messageId,
      classification: JSON.stringify({ category, confidence, redFlag }),
    });
    return { messageId, classification: category, confidence, redFlag };
  },
});
