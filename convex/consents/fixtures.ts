import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Report creation belongs to issue #6, and this fixture exists only so the
// consent flow can be proven headless before #6 lands.
export const stageReport = internalMutation({
  args: { ownerId: v.string(), subjectId: v.id("subjects"), recipient: v.string() },
  returns: v.id("reports"),
  handler: async (ctx, { ownerId, subjectId, recipient }) =>
    await ctx.db.insert("reports", {
      ownerId,
      subjectId,
      assessmentIds: [],
      observationIds: [],
      insightIds: [],
      recipient,
      status: "final",
      createdAt: Date.now(),
    }),
});
