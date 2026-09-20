import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { rollUp } from "./rollup";

export const sessionHistory = internalQuery({
  args: { assessmentId: v.id("assessments") },
  returns: v.object({
    subjectId: v.id("subjects"),
    sessions: v.array(
      v.object({
        assessmentId: v.id("assessments"),
        createdAt: v.number(),
        domains: v.array(
          v.object({ domain: v.string(), value: v.number(), confidence: v.number() }),
        ),
      }),
    ),
  }),
  handler: async (ctx, { assessmentId }) => {
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${assessmentId}`);
    const finished = await ctx.db
      .query("assessments")
      .withIndex("by_subject_created", (q) =>
        q.eq("subjectId", assessment.subjectId).lte("createdAt", assessment.createdAt),
      )
      .filter((q) => q.eq(q.field("status"), "finished"))
      .collect();
    return {
      subjectId: assessment.subjectId,
      sessions: await Promise.all(
        finished.map(async (session) => ({
          assessmentId: session._id,
          createdAt: session.createdAt,
          domains: rollUp(
            await ctx.db
              .query("scores")
              .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", session._id))
              .collect(),
          ).flatMap((entry) =>
            entry.value === null
              ? []
              : [{ domain: entry.domain, value: entry.value, confidence: entry.confidence }],
          ),
        })),
      ),
    };
  },
});
