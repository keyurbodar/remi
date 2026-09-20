import { v } from "convex/values";
import { query } from "../_generated/server";
import { byConfidence } from "./rank";

// The read path the results panel consumes: one row per insight, strongest first,
// each carrying the researchDocs rows behind its citations.
export const listBySubject = query({
  args: { subjectId: v.id("subjects") },
  returns: v.array(
    v.object({
      insightId: v.id("insights"),
      matchType: v.string(),
      confidence: v.number(),
      rationaleCode: v.string(),
      citations: v.array(
        v.object({
          researchDocId: v.id("researchDocs"),
          publisher: v.string(),
          url: v.string(),
          excerpt: v.string(),
          fetchedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { subjectId }) => {
    const rows = (
      await ctx.db
        .query("insights")
        .filter((q) => q.eq(q.field("subjectId"), subjectId))
        .collect()
    ).sort(byConfidence);
    return await Promise.all(
      rows.map(async ({ _id, matchType, confidence, rationaleCode, evidenceIds }) => ({
        insightId: _id,
        matchType,
        confidence,
        rationaleCode,
        citations: await Promise.all(
          evidenceIds.map(async (evidenceId) => {
            const doc = await ctx.db.get(evidenceId);
            // A citation with no researchDocs row behind it is a broken write, and the
            // panel is the surface that has to show it.
            if (!doc) throw new Error(`Unknown researchDoc: ${evidenceId}`);
            return {
              researchDocId: doc._id,
              publisher: doc.publisher,
              url: doc.url,
              excerpt: doc.excerpt,
              fetchedAt: doc.fetchedAt,
            };
          }),
        ),
      })),
    );
  },
});
