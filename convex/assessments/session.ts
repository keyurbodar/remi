import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { itemFor } from "./battery";

export const start = mutation({
  args: { ownerId: v.string(), subjectId: v.id("subjects") },
  returns: v.id("assessments"),
  handler: async (ctx, args) =>
    ctx.db.insert("assessments", {
      ownerId: args.ownerId,
      subjectId: args.subjectId,
      status: "started",
      createdAt: Date.now(),
    }),
});

// Answers arrive one at a time from the check-in flow. Accuracy is absent here
// on purpose: the scoring action owns it.
export const submit = mutation({
  args: {
    assessmentId: v.id("assessments"),
    taskKey: v.string(),
    answer: v.string(),
    reactionMs: v.optional(v.number()),
    clientTs: v.number(),
  },
  returns: v.id("responses"),
  handler: async (ctx, args) => {
    const assessment = await ctx.db.get(args.assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${args.assessmentId}`);
    if (assessment.status === "finished") throw new Error("Assessment is already finished");

    const item = itemFor(args.taskKey);
    const responseId = await ctx.db.insert("responses", {
      assessmentId: assessment._id,
      taskKey: item.taskKey,
      promptVersion: item.promptVersion,
      answer: args.answer,
      reactionMs: args.reactionMs,
      clientTs: args.clientTs,
    });
    if (assessment.status === "started") await ctx.db.patch(assessment._id, { status: "in_progress" });
    return responseId;
  },
});

export const finish = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assessment = await ctx.db.get(args.assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${args.assessmentId}`);
    await ctx.db.patch(assessment._id, { status: "finished" });
    return null;
  },
});
