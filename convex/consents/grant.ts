import { v } from "convex/values";
import { mutation } from "../_generated/server";

// The consent screen calls this once the person has seen the exact report,
// recipient and scope it stores.
export const grant = mutation({
  args: { reportId: v.id("reports"), recipient: v.string(), scope: v.string() },
  returns: v.id("consents"),
  handler: async (ctx, { reportId, recipient, scope }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error(`Unknown report: ${reportId}`);
    // The grant binds the address the person was shown, so a caller that shows
    // one address and stores another is a bug, not a state the person can see.
    if (report.recipient !== recipient)
      throw new Error(
        `Recipient mismatch on report ${reportId}: report is for ${report.recipient}, grant is for ${recipient}`,
      );
    if (scope.trim() === "") throw new Error("Consent scope is blank");
    // A grant after a revoke inserts a new row on purpose: revoked rows stay as
    // history and the guard resolves the live grant as the most recent one.
    return await ctx.db.insert("consents", { reportId, scope, grantedAt: Date.now() });
  },
});
