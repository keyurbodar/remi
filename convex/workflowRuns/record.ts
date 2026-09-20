import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";

// One kind today: the scoring pipeline. A second durable run adds its own here.
const SCORING_RUN = "scoring";

export const workflowState = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("retryable"),
);

export type WorkflowState = Infer<typeof workflowState>;

export type Transition = {
  entityId: string;
  step: string;
  attempt: number;
  state: WorkflowState;
  error?: string;
};

// The start mutation queues a run inside its own transaction, so the row shape
// lives here and both writers share it. Only a terminal state closes the row:
// a step left in running is a run that died mid-flight.
export async function recordTransition(ctx: MutationCtx, transition: Transition) {
  const now = Date.now();
  const done = transition.state === "succeeded" || transition.state === "failed";
  return await ctx.db.insert("workflowRuns", {
    kind: SCORING_RUN,
    ...transition,
    startedAt: now,
    completedAt: done ? now : undefined,
  });
}

// Every step of a durable run writes through this mutation, so the trail is
// readable from the dashboard while the run is still in flight.
export const record = internalMutation({
  args: {
    entityId: v.string(),
    step: v.string(),
    attempt: v.number(),
    state: workflowState,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, transition) => {
    await recordTransition(ctx, transition);
    return null;
  },
});
