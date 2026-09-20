import type { Infer } from "convex/values";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { rollUp } from "../scores/rollup";

// Mirrors the read path in scores/rollup.ts so the step boundary validates the
// same shape the results screen reads.
export const rollupRow = v.object({
  domain: v.string(),
  value: v.union(v.number(), v.null()),
  confidence: v.number(),
  lowConfidence: v.boolean(),
  answers: v.number(),
  rationaleCode: v.string(),
});

const scoreOutcome = v.object({
  scoreId: v.id("scores"),
  domain: v.string(),
  value: v.number(),
  confidence: v.number(),
  lowConfidence: v.boolean(),
  rationaleCode: v.string(),
});

export type RollupRow = Infer<typeof rollupRow>;
export type ScoreOutcome = Infer<typeof scoreOutcome>;

// The assessment step: the answers this run still has to score. A response
// carries JEV's accuracy once it is scored, so a re-run picks up what is left
// instead of scoring an answer twice.
export const pendingResponses = internalQuery({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(v.object({ responseId: v.id("responses"), taskKey: v.string() })),
  handler: async (ctx, { assessmentId }) => {
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${assessmentId}`);
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_assessment_task", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    return responses
      .filter((response) => response.accuracy === undefined)
      .map((response) => ({ responseId: response._id, taskKey: response.taskKey }));
  },
});

// The rollup step: the domain numbers this run produced.
export const rollupFor = internalQuery({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(rollupRow),
  handler: async (ctx, { assessmentId }) =>
    rollUp(
      await ctx.db
        .query("scores")
        .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", assessmentId))
        .collect(),
    ),
});

// The score step, and the typed boundary of the run: JEV's numbers are checked
// against the ranges shared/contracts.ts declares before the run treats the
// answer as scored. The scoring action itself stays public for the check-in
// flow, so this boundary calls it through `api`.
export const scoreResponse = internalAction({
  args: { responseId: v.id("responses") },
  returns: scoreOutcome,
  handler: async (ctx, { responseId }): Promise<ScoreOutcome> => {
    const outcome = await ctx.runAction(api.jev.scoreAnswer.scoreResponse, { responseId });
    if (outcome.value < 0 || outcome.value > 4 || outcome.confidence < 0 || outcome.confidence > 1)
      throw new Error(
        `JEV scored ${responseId} at value ${outcome.value} and confidence ${outcome.confidence}`,
      );
    return outcome;
  },
});
