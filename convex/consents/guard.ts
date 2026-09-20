import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";

export type ConsentDenial = {
  code: "consent_missing" | "consent_revoked" | "recipient_mismatch" | "scope_mismatch";
  reportId: Id<"reports">;
};

// A report can be granted, revoked, then granted again, so the live grant is the
// most recent row and the older rows stay as history. Equal grantedAt values fall
// to the last row the index returns, which is the one created last.
export const latestGrant = (rows: Doc<"consents">[]): Doc<"consents"> | undefined =>
  rows.reduce<Doc<"consents"> | undefined>(
    (latest, row) => (latest === undefined || row.grantedAt >= latest.grantedAt ? row : latest),
    undefined,
  );

// The gate the send path calls before AgentMail. #6 runs this through
// ctx.runQuery with the recipient and scope it is about to send, and only sends
// when it returns.
export const requireConsent = internalQuery({
  args: { reportId: v.id("reports"), recipient: v.string(), scope: v.string() },
  returns: v.object({
    consentId: v.id("consents"),
    reportId: v.id("reports"),
    recipient: v.string(),
    scope: v.string(),
    grantedAt: v.number(),
  }),
  handler: async (ctx, { reportId, recipient, scope }) => {
    const report = await ctx.db.get(reportId);
    if (report === null) throw new Error(`Unknown report: ${reportId}`);
    const grant = latestGrant(
      await ctx.db.query("consents").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect(),
    );
    if (grant === undefined) throw new ConvexError<ConsentDenial>({ code: "consent_missing", reportId });
    if (grant.revokedAt !== undefined) throw new ConvexError<ConsentDenial>({ code: "consent_revoked", reportId });
    // The consent row has no recipient column, so the report the person saw is
    // what binds the address: a send to anyone else is not the consented send.
    if (report.recipient !== recipient) throw new ConvexError<ConsentDenial>({ code: "recipient_mismatch", reportId });
    if (grant.scope !== scope) throw new ConvexError<ConsentDenial>({ code: "scope_mismatch", reportId });
    return { consentId: grant._id, reportId, recipient, scope: grant.scope, grantedAt: grant.grantedAt };
  },
});
