import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { assessTrend } from "../jev/adapter";

type DomainTrend = {
  domain: string;
  current: number;
  previous: number | null;
  delta: number | null;
  direction: "first_session" | "improving" | "stable" | "declining";
  probability: number;
  sessions: number;
};

export const trendDelta = action({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(
    v.object({
      domain: v.string(),
      current: v.number(),
      previous: v.union(v.number(), v.null()),
      delta: v.union(v.number(), v.null()),
      direction: v.union(
        v.literal("first_session"),
        v.literal("improving"),
        v.literal("stable"),
        v.literal("declining"),
      ),
      probability: v.number(),
      sessions: v.number(),
    }),
  ),
  handler: async (ctx, { assessmentId }): Promise<DomainTrend[]> => {
    const { sessions } = await ctx.runQuery(internal.scores.history.sessionHistory, {
      assessmentId,
    });
    const latest = sessions[sessions.length - 1];
    if (!latest) return [];
    // One trend question per domain over that domain's own series, so the
    // independent calls fan out together.
    return await Promise.all(
      latest.domains.map(async ({ domain }): Promise<DomainTrend> => {
        const series = sessions.flatMap((session) => {
          const value = session.domains.find((entry) => entry.domain === domain)?.value;
          return value === undefined
            ? []
            : [{ date: new Date(session.createdAt).toISOString().slice(0, 10), score: value }];
        });
        const current = series[series.length - 1].score;
        const previous = series.length > 1 ? series[series.length - 2].score : null;
        const trend =
          previous === null
            ? { direction: "first_session" as const, probability: 1 }
            : await assessTrend({ domain, sessions: series });
        return {
          domain,
          current,
          previous,
          delta: previous === null ? null : Math.round((current - previous) * 100) / 100,
          direction: trend.direction,
          probability: trend.probability,
          sessions: series.length,
        };
      }),
    );
  },
});
