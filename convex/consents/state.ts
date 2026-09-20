import { v } from "convex/values";
import { query } from "../_generated/server";
import { latestGrant } from "./guard";

type ConsentStatus = "none" | "active" | "revoked";

// The consent screen reads this: the current consent state of every report for
// one subject, newest report first.
export const consentState = query({
  args: { subjectId: v.id("subjects") },
  returns: v.array(
    v.object({
      reportId: v.id("reports"),
      recipient: v.union(v.string(), v.null()),
      scope: v.union(v.string(), v.null()),
      status: v.union(v.literal("none"), v.literal("active"), v.literal("revoked")),
      grantedAt: v.union(v.number(), v.null()),
      revokedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { subjectId }) => {
    // The frozen schema carries no subject index on reports, so this scan is
    // deliberate.
    const reports = await ctx.db
      .query("reports")
      .filter((q) => q.eq(q.field("subjectId"), subjectId))
      .collect();
    return await Promise.all(
      reports
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (report) => {
          const latest = latestGrant(
            await ctx.db
              .query("consents")
              .withIndex("by_report", (q) => q.eq("reportId", report._id))
              .collect(),
          );
          const status: ConsentStatus =
            latest === undefined ? "none" : latest.revokedAt === undefined ? "active" : "revoked";
          return {
            reportId: report._id,
            recipient: report.recipient ?? null,
            scope: latest?.scope ?? null,
            status,
            grantedAt: latest?.grantedAt ?? null,
            revokedAt: latest?.revokedAt ?? null,
          };
        }),
    );
  },
});
