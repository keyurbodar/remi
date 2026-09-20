import { v } from "convex/values";
import { mutation } from "../_generated/server";

// Consent is withdrawn for the report rather than for one row, because a report
// can hold more than one live grant and a revoke that missed one would leave the
// gate open. One call stamps one revokedAt across every row it closes, and a row
// that is already revoked keeps its earlier stamp, so a repeated revoke never
// moves the moment consent ended. The patch never touches scope, so a revoked
// row keeps the scope it was granted with.
export const revoke = mutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const consents = await ctx.db
      .query("consents")
      .withIndex("by_report", (q) => q.eq("reportId", reportId))
      .collect();
    const revokedAt = Date.now();
    for (const consent of consents) {
      if (consent.revokedAt === undefined) await ctx.db.patch(consent._id, { revokedAt });
    }
    return null;
  },
});
