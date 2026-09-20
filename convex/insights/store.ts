import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { matchTypeValidator, rationaleCodeValidator } from "./rank";

// Insights are derived rows, so a re-run replaces the subject's set instead of
// appending to it.
export const persistInsights = internalMutation({
  args: {
    subjectId: v.id("subjects"),
    insights: v.array(
      v.object({
        evidenceId: v.id("researchDocs"),
        matchType: matchTypeValidator,
        confidence: v.number(),
        rationaleCode: rationaleCodeValidator,
      }),
    ),
  },
  returns: v.array(v.id("insights")),
  handler: async (ctx, { subjectId, insights }) => {
    const existing = await ctx.db
      .query("insights")
      .filter((q) => q.eq(q.field("subjectId"), subjectId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const ids: Id<"insights">[] = [];
    for (const insight of insights) {
      ids.push(
        await ctx.db.insert("insights", {
          subjectId,
          evidenceIds: [insight.evidenceId],
          matchType: insight.matchType,
          confidence: insight.confidence,
          rationaleCode: insight.rationaleCode,
        }),
      );
    }
    return ids;
  },
});
