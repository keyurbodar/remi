import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";

export type DomainRollup = {
  domain: string;
  value: number | null;
  confidence: number;
  lowConfidence: boolean;
  answers: number;
  rationaleCode: string;
};

const scoreRow = v.object({
  domain: v.string(),
  value: v.number(),
  confidence: v.number(),
  modelVersion: v.string(),
  lowConfidence: v.boolean(),
  rationaleCode: v.string(),
});

const rollupRow = v.object({
  domain: v.string(),
  value: v.union(v.number(), v.null()),
  confidence: v.number(),
  lowConfidence: v.boolean(),
  answers: v.number(),
  rationaleCode: v.string(),
});

export function rollUp(rows: Doc<"scores">[]): DomainRollup[] {
  const byDomain = new Map<string, Doc<"scores">[]>();
  for (const row of rows) byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row]);
  return [...byDomain]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([domain, domainRows]) => {
      // Gated answers never feed the domain number, and a domain only goes
      // gated when nothing trustworthy is left in it.
      const trusted = domainRows.filter((row) => !row.lowConfidence);
      if (trusted.length === 0) {
        return {
          domain,
          value: null,
          confidence: Math.min(...domainRows.map((row) => row.confidence)),
          lowConfidence: true,
          answers: 0,
          rationaleCode: "insufficient_evidence",
        };
      }
      const weakest = trusted.reduce((low, row) => (row.value < low.value ? row : low));
      const mean = trusted.reduce((sum, row) => sum + row.value, 0) / trusted.length;
      return {
        domain,
        value: Math.round(mean * 100) / 100,
        confidence: Math.min(...trusted.map((row) => row.confidence)),
        lowConfidence: false,
        answers: trusted.length,
        rationaleCode: weakest.rationaleCode,
      };
    });
}

export const answerScores = query({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(scoreRow),
  handler: async (ctx, { assessmentId }) =>
    (
      await ctx.db
        .query("scores")
        .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", assessmentId))
        .collect()
    ).map(({ domain, value, confidence, modelVersion, lowConfidence, rationaleCode }) => ({
      domain,
      value,
      confidence,
      modelVersion,
      lowConfidence,
      rationaleCode,
    })),
});

export const domainRollup = query({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(rollupRow),
  handler: async (ctx, { assessmentId }) =>
    rollUp(
      await ctx.db
        .query("scores")
        .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", assessmentId))
        .collect(),
    ),
});
