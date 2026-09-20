import { v } from "convex/values";
import { query } from "../_generated/server";
import { workflowState } from "./record";

// The full state trail of one run, oldest first. The frozen schema carries no
// index on workflowRuns, so this filters in memory: one deployment's runs, read
// by the results screen and the verification script.
export const trail = query({
  args: { entityId: v.string() },
  returns: v.array(
    v.object({
      step: v.string(),
      attempt: v.number(),
      state: workflowState,
      error: v.optional(v.string()),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { entityId }) =>
    (await ctx.db.query("workflowRuns").collect())
      .filter((row) => row.entityId === entityId)
      .sort((a, b) => a.startedAt - b.startedAt || a._creationTime - b._creationTime)
      .map(({ step, attempt, state, error, startedAt, completedAt }) => ({
        step,
        attempt,
        state,
        error,
        startedAt,
        completedAt,
      })),
});
