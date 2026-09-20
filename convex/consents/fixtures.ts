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

// A second subject, so the consent read path can be shown to return one
// subject's reports and not another's.
export const stageSubject = internalMutation({
  args: {},
  returns: v.id("subjects"),
  handler: async (ctx) =>
    await ctx.db.insert("subjects", {
      name: "Other subject",
      relationship: "other",
      ageBand: "70-79",
      medications: [],
      sleep: "seven hours",
      concern: "fixture subject",
      createdAt: Date.now(),
    }),
});
