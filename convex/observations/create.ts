import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    subjectId: v.id("subjects"),
    rawText: v.string(),
    observedAt: v.optional(v.number()),
    factualSummary: v.string(),
    context: v.array(v.string()),
    tags: v.array(v.string()),
    uncertainty: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.subjectId))) {
      throw new Error("Cannot create an observation for an unknown subject");
    }
    return ctx.db.insert("observations", {
      ...args,
      source: "journal",
      reviewed: false,
      corrected: false,
    });
  },
});
