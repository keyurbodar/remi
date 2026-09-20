// Profile to evidence matching: one JEV batch judges every candidate finding,
// and rankInsights turns those scores into the insight rows the panel reads.
import { action, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { matchFindings } from "../jev/adapter";
import { rankInsights, type MatchingProfile } from "../insights/rank";
import { rollUp } from "../scores/rollup";

// JEV answers one noul per finding inside a single call, and the adapter keeps
// a batch under 100.
const MAX_CANDIDATES = 99;

export const matchingState = internalQuery({
  args: { assessmentId: v.id("assessments") },
  returns: v.object({
    subjectId: v.id("subjects"),
    profile: v.object({
      relationship: v.union(v.literal("self"), v.literal("parent"), v.literal("other")),
      ageBand: v.string(),
      concern: v.string(),
      sleep: v.string(),
      medications: v.array(v.string()),
      domains: v.array(
        v.object({ domain: v.string(), value: v.number(), confidence: v.number() }),
      ),
      observation: v.union(
        v.null(),
        v.object({
          factualSummary: v.string(),
          context: v.array(v.string()),
          tags: v.array(v.string()),
          uncertainty: v.string(),
        }),
      ),
    }),
    findings: v.array(
      v.object({ id: v.id("researchDocs"), title: v.string(), excerpt: v.string() }),
    ),
  }),
  handler: async (ctx, { assessmentId }) => {
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) throw new Error(`Unknown assessment: ${assessmentId}`);
    const subject = await ctx.db.get(assessment.subjectId);
    if (!subject) throw new Error(`Unknown subject: ${assessment.subjectId}`);
    const domains = rollUp(
      await ctx.db
        .query("scores")
        .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", assessmentId))
        .collect(),
    ).flatMap((entry) =>
      entry.value === null
        ? []
        : [{ domain: entry.domain, value: entry.value, confidence: entry.confidence }],
    );
    const latest = (
      await ctx.db
        .query("observations")
        .withIndex("by_subject_observed", (q) => q.eq("subjectId", subject._id))
        .collect()
    )
      .filter((row) => row.reviewed)
      .sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))
      .at(0);
    const findings = (await ctx.db.query("researchDocs").collect())
      .sort((a, b) => b.fetchedAt - a.fetchedAt || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
      .slice(0, MAX_CANDIDATES)
      .map((doc) => ({
        id: doc._id,
        title: doc.publisher,
        excerpt: [doc.excerpt, ...doc.extractedFacts].join(" "),
      }));
    const profile: MatchingProfile = {
      relationship: subject.relationship,
      ageBand: subject.ageBand,
      concern: subject.concern,
      sleep: subject.sleep,
      medications: subject.medications,
      domains,
      observation: latest
        ? {
            factualSummary: latest.factualSummary,
            context: latest.context,
            tags: latest.tags,
            uncertainty: latest.uncertainty,
          }
        : null,
    };
    return { subjectId: subject._id, profile, findings };
  },
});

// The one entry point for a check-in's evidence: it reads the profile, asks JEV
// once about the whole candidate set, and stores the ranked insights.
export const matchSubject = action({
  args: { assessmentId: v.id("assessments") },
  returns: v.object({
    subjectId: v.id("subjects"),
    candidates: v.number(),
    matches: v.array(v.object({ id: v.string(), relevant: v.number() })),
  }),
  // The handler return type is written out because this action reads its own
  // module through `internal`, and inference would otherwise cycle.
  handler: async (
    ctx,
    { assessmentId },
  ): Promise<{
    subjectId: Id<"subjects">;
    candidates: number;
    matches: { id: string; relevant: number }[];
  }> => {
    const { subjectId, profile, findings } = await ctx.runQuery(
      internal.research.match.matchingState,
      { assessmentId },
    );
    if (findings.length === 0) return { subjectId, candidates: 0, matches: [] };

    const matches = await matchFindings({ profile, findings });
    const insights = rankInsights(
      findings,
      new Map(matches.map(({ id, relevant }) => [id, relevant])),
      profile,
    );
    await ctx.runMutation(internal.insights.store.persistInsights, { subjectId, insights });

    return { subjectId, candidates: findings.length, matches };
  },
});
