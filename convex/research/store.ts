import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const save = internalMutation({
  args: {
    url: v.string(),
    publisher: v.string(),
    excerpt: v.string(),
    extractedFacts: v.array(v.string()),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {

    const existing = await ctx.db
      .query("researchDocs")
      .withIndex("by_url", (query) => query.eq("url", args.url))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("researchDocs", args);
  },
});
