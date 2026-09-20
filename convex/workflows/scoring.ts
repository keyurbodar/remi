import { start, WorkflowManager, type WorkflowCtx } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { recordTransition, type Transition } from "../workflowRuns/record";

// Two retries after the first attempt, then the run gives up and fails.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 250;

const workflow = new WorkflowManager(components.workflow);

type RecordStep = (transition: Transition) => Promise<unknown>;

// The trail renders in the results screen, so a row carries the model's own
// message and not the stack Convex appends to it.
const failureText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0].trim();

// One answer, one JEV call per attempt, every attempt written before the next
// one starts. A third-party outage reads as retryable then failed, with the
// model's error text on the row, instead of vanishing into a log line.
async function scoreWithRetry(
  step: WorkflowCtx,
  record: RecordStep,
  entityId: string,
  response: { responseId: Id<"responses">; taskKey: string },
): Promise<void> {
  const transition = { entityId, step: `score:${response.taskKey}` };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await record({ ...transition, attempt, state: "running" });
    try {
      await step.runAction(
        internal.workflows.steps.scoreResponse,
        { responseId: response.responseId },
        { retry: false },
      );
      await record({ ...transition, attempt, state: "succeeded" });
      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        await record({ ...transition, attempt, state: "failed", error: failureText(error) });
        throw error;
      }
      await record({ ...transition, attempt, state: "retryable", error: failureText(error) });
      await step.sleep(BACKOFF_MS * attempt);
    }
  }
}

// The durable scoring pipeline: read the answers a check-in still owes a score,
// score each one, then roll the scores up per domain. Started per assessment.
export const scoringRun = workflow.define({
  args: { assessmentId: v.id("assessments") },
  returns: v.object({ scored: v.number(), domains: v.number() }),
  handler: async (step, { assessmentId }): Promise<{ scored: number; domains: number }> => {
    const record: RecordStep = (transition) =>
      step.runMutation(internal.workflowRuns.record.record, transition);
    const run = { entityId: assessmentId, step: "run", attempt: 1 };
    await record({ ...run, state: "running" });
    try {
      await record({ entityId: assessmentId, step: "assessment", attempt: 1, state: "running" });
      const pending = await step.runQuery(internal.workflows.steps.pendingResponses, {
        assessmentId,
      });
      await record({ entityId: assessmentId, step: "assessment", attempt: 1, state: "succeeded" });

      for (const response of pending) await scoreWithRetry(step, record, assessmentId, response);

      await record({ entityId: assessmentId, step: "rollup", attempt: 1, state: "running" });
      const domains = await step.runQuery(internal.workflows.steps.rollupFor, { assessmentId });
      await record({ entityId: assessmentId, step: "rollup", attempt: 1, state: "succeeded" });

      await record({ ...run, state: "succeeded" });
      return { scored: pending.length, domains: domains.length };
    } catch (error) {
      await record({ ...run, state: "failed", error: failureText(error) });
      throw error;
    }
  },
});

// Starts the run for one assessment and queues its first row, so a caller can
// watch workflowRuns from the moment it triggers the pipeline.
export const startScoring = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.object({ workflowId: v.string(), runId: v.id("workflowRuns") }),
  // Written out for the same reason as the workflow handler: this mutation
  // reaches its own module through `internal`, and inference would cycle.
  handler: async (
    ctx,
    { assessmentId },
  ): Promise<{ workflowId: string; runId: Id<"workflowRuns"> }> => {
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${assessmentId}`);
    const runId = await recordTransition(ctx, {
      entityId: assessmentId,
      step: "run",
      attempt: 1,
      state: "queued",
    });
    const workflowId = await start(ctx, internal.workflows.scoring.scoringRun, { assessmentId }, {
      startAsync: true,
    });
    return { workflowId, runId };
  },
});
