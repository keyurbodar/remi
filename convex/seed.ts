import { GenericMutationCtx } from "convex/server";
import { DataModel } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

const tables = [
  "subjects",
  "assessments",
  "responses",
  "scores",
  "observations",
  "researchDocs",
  "insights",
  "reports",
  "consents",
  "emailThreads",
  "messages",
  "workflowRuns",
] as const;

async function clearAll(ctx: GenericMutationCtx<DataModel>) {
  for (const table of tables) {
    for (const doc of await ctx.db.query(table).collect()) {
      await ctx.db.delete(doc._id);
    }
  }
}

// One synthetic subject with a finished assessment, its responses and scores,
// and one reviewed journal observation. Safe to run repeatedly: clears first.
export const seed = mutation({
  args: {},
  returns: v.object({
    subjectId: v.id("subjects"),
    assessmentId: v.id("assessments"),
    responseId: v.id("responses"),
    scoreId: v.id("scores"),
    observationId: v.id("observations"),
  }),
  handler: async (ctx) => {
    await clearAll(ctx);
    const now = Date.now();

    const subjectId = await ctx.db.insert("subjects", {
      name: "Asha Mehta",
      relationship: "self",
      ageBand: "65-74",
      medications: [],
      sleep: "Wakes twice most nights",
      concern: "Repeating questions and misplacing things",
      createdAt: now,
    });

    const assessmentId = await ctx.db.insert("assessments", {
      ownerId: "demo-user",
      subjectId,
      status: "finished",
      createdAt: now,
    });

    const responseId = await ctx.db.insert("responses", {
      assessmentId,
      taskKey: "word-recall-3",
      promptVersion: "v1",
      answer: "apple, table, chair",
      accuracy: 0.33,
      reactionMs: 6100,
      clientTs: now,
    });

    const scoreId = await ctx.db.insert("scores", {
      assessmentId,
      domain: "memory",
      value: 2.01,
      confidence: 0.99,
      modelVersion: "jev-1.13.0",
      lowConfidence: false,
      rationaleCode: "partial_recall",
    });

    const observationId = await ctx.db.insert("observations", {
      subjectId,
      source: "journal",
      rawText: "Asked me about the same appointment three times this week.",
      observedAt: now,
      factualSummary: "Repeated the same question three times in one week",
      context: ["morning"],
      tags: ["repetition"],
      uncertainty: "none",
      reviewed: true,
      corrected: false,
    });

    return { subjectId, assessmentId, responseId, scoreId, observationId };
  },
});

// Removes every seeded row across all tables.
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    await clearAll(ctx);
  },
});
