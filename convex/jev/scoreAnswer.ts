import { action, internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { itemFor } from "../assessments/battery";
import { certainty, isLowConfidence } from "../scores/gate";
import { scoreAnswer } from "./adapter";

export const scoringInput = internalQuery({
  args: { responseId: v.id("responses") },
  returns: v.object({
    assessmentId: v.id("assessments"),
    subjectId: v.id("subjects"),
    taskKey: v.string(),
    answer: v.string(),
    reactionMs: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { responseId }) => {
    const response = await ctx.db.get(responseId);
    if (!response) throw new Error(`Unknown response: ${responseId}`);
    const assessment = await ctx.db.get(response.assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${response.assessmentId}`);
    return {
      assessmentId: response.assessmentId,
      subjectId: assessment.subjectId,
      taskKey: response.taskKey,
      answer: response.answer,
      reactionMs: response.reactionMs ?? null,
    };
  },
});

// The response row carries JEV's graded accuracy for the answer, so the rollup
// and trend read paths can trust it without a second scoring pass.
export const persistScore = internalMutation({
  args: {
    responseId: v.id("responses"),
    domain: v.string(),
    accuracy: v.number(),
    value: v.number(),
    confidence: v.number(),
    modelVersion: v.string(),
    lowConfidence: v.boolean(),
    rationaleCode: v.string(),
  },
  returns: v.id("scores"),
  handler: async (ctx, { responseId, domain, accuracy, value, confidence, modelVersion, lowConfidence, rationaleCode }) => {
    const response = await ctx.db.get(responseId);
    if (!response) throw new Error(`Unknown response: ${responseId}`);
    const scoreId = await ctx.db.insert("scores", {
      assessmentId: response.assessmentId,
      domain,
      value,
      confidence,
      modelVersion,
      lowConfidence,
      rationaleCode,
    });
    await ctx.db.patch(responseId, { accuracy });
    return scoreId;
  },
});

// Callers invoke this once per submitted response: one JEV call, one score row.
export const scoreResponse = action({
  args: { responseId: v.id("responses") },
  returns: v.object({
    scoreId: v.id("scores"),
    domain: v.string(),
    value: v.number(),
    confidence: v.number(),
    lowConfidence: v.boolean(),
    rationaleCode: v.string(),
  }),
  // The handler return type is written out because this action reads its own
  // module through `internal`, and inference would otherwise cycle.
  handler: async (
    ctx,
    { responseId },
  ): Promise<{
    scoreId: Id<"scores">;
    domain: string;
    value: number;
    confidence: number;
    lowConfidence: boolean;
    rationaleCode: string;
  }> => {
    const input = await ctx.runQuery(internal.jev.scoreAnswer.scoringInput, { responseId });
    const item = itemFor(input.taskKey);
    const { sessions } = await ctx.runQuery(internal.scores.history.sessionHistory, {
      assessmentId: input.assessmentId,
    });
    const priorTrend =
      sessions.length === 0
        ? "first session"
        : `prior ${item.domain} scores: ${sessions
            .map(({ domains }) => {
              const hit = domains.find((d) => d.domain === item.domain);
              return hit ? hit.value.toFixed(2) : "gated";
            })
            .join(", ")}`;

    const result = await scoreAnswer({
      domain: item.domain,
      question: item.question,
      correctAnswer: item.correctAnswer,
      userAnswer: input.answer,
      responseMs: input.reactionMs ?? undefined,
      priorTrend,
    });

    const confidence = certainty(result.correct);
    const lowConfidence = isLowConfidence(confidence);
    const rationaleCode =
      result.correct >= 0.7
        ? result.anomalous
          ? "answer_correct_slow"
          : "answer_correct"
        : result.correct >= 0.3
          ? "answer_partial"
          : "answer_incorrect";

    const scoreId = await ctx.runMutation(internal.jev.scoreAnswer.persistScore, {
      responseId,
      domain: item.domain,
      accuracy: result.correct,
      value: result.quality,
      confidence,
      modelVersion: result.modelVersion,
      lowConfidence,
      rationaleCode,
    });

    return { scoreId, domain: item.domain, value: result.quality, confidence, lowConfidence, rationaleCode };
  },
});
