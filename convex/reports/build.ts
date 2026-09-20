import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { byConfidence } from "../insights/rank";
import { rollUp } from "../scores/rollup";
import { MAX_INSIGHTS, MAX_OBSERVATIONS, type ClinicianQuestion } from "./facts";
import { draftQuestions } from "./questions";
import { renderReport } from "./render";

// The action reaches its own module through `internal`, so its return type has to
// be spelled out or the inference cycles.
type BuiltReport = {
  reportId: Id<"reports">;
  fileId: Id<"_storage">;
  html: string;
  questions: ClinicianQuestion[];
};

const subjectRow = v.object({
  name: v.string(),
  ageBand: v.string(),
  relationship: v.union(v.literal("self"), v.literal("parent"), v.literal("other")),
  medications: v.array(v.string()),
  sleep: v.string(),
  concern: v.string(),
});

const rollupRow = v.object({
  domain: v.string(),
  value: v.union(v.number(), v.null()),
  confidence: v.number(),
  lowConfidence: v.boolean(),
  answers: v.number(),
  rationaleCode: v.string(),
});

const observationRow = v.object({
  id: v.id("observations"),
  observedAt: v.union(v.number(), v.null()),
  factualSummary: v.string(),
  context: v.array(v.string()),
  tags: v.array(v.string()),
});

const citationRow = v.object({
  id: v.id("insights"),
  matchType: v.string(),
  confidence: v.number(),
  rationaleCode: v.string(),
  publisher: v.string(),
  url: v.string(),
  excerpt: v.string(),
  fetchedAt: v.number(),
});

// Blob storage is action-only, so the build is an action over these two helpers:
// one reads the reviewed state, one writes the report row the stored file backs.
export const buildReport = action({
  args: { ownerId: v.string(), subjectId: v.id("subjects") },
  returns: v.object({
    reportId: v.id("reports"),
    fileId: v.id("_storage"),
    html: v.string(),
    questions: v.array(v.object({ prompt: v.string(), basis: v.string() })),
  }),
  handler: async (ctx, { ownerId, subjectId }): Promise<BuiltReport> => {
    const { assessmentIds, ...collected } = await ctx.runQuery(
      internal.reports.build.collectFacts,
      { subjectId },
    );
    const generatedAt = Date.now();
    const questions = draftQuestions({ ...collected, generatedAt });
    const html = renderReport({ ...collected, generatedAt, questions });
    const fileId = await ctx.storage.store(new Blob([html], { type: "text/html" }));
    const reportId = await ctx.runMutation(internal.reports.build.persistReport, {
      ownerId,
      subjectId,
      assessmentIds,
      observationIds: collected.observations.map((row) => row.id),
      insightIds: collected.insights.map((row) => row.id),
      fileId,
      createdAt: generatedAt,
    });
    return { reportId, fileId, html, questions };
  },
});

export const collectFacts = internalQuery({
  args: { subjectId: v.id("subjects") },
  returns: v.object({
    subject: subjectRow,
    rollups: v.array(rollupRow),
    observations: v.array(observationRow),
    insights: v.array(citationRow),
    assessmentIds: v.array(v.id("assessments")),
  }),
  handler: async (ctx, { subjectId }) => {
    const subject = await ctx.db.get(subjectId);
    if (subject === null) throw new Error(`Unknown subject: ${subjectId}`);
    // A subject with no finished check-in still gets a brief: the score section is
    // empty rather than absent.
    const assessment = await ctx.db
      .query("assessments")
      .withIndex("by_subject_created", (q) => q.eq("subjectId", subjectId))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "finished"))
      .first();
    return {
      subject: {
        name: subject.name,
        ageBand: subject.ageBand,
        relationship: subject.relationship,
        medications: subject.medications,
        sleep: subject.sleep,
        concern: subject.concern,
      },
      rollups:
        assessment === null
          ? []
          : rollUp(
              await ctx.db
                .query("scores")
                .withIndex("by_assessment_domain", (q) => q.eq("assessmentId", assessment._id))
                .collect(),
            ),
      assessmentIds: assessment === null ? [] : [assessment._id],
      observations: (
        await ctx.db
          .query("observations")
          .withIndex("by_subject_observed", (q) => q.eq("subjectId", subjectId))
          .order("desc")
          .filter((q) => q.eq(q.field("reviewed"), true))
          .take(MAX_OBSERVATIONS)
      ).map(({ _id, observedAt, factualSummary, context, tags }) => ({
        id: _id,
        observedAt: observedAt ?? null,
        factualSummary,
        context,
        tags,
      })),
      insights: await Promise.all(
        (
          await ctx.db
            .query("insights")
            .filter((q) => q.eq(q.field("subjectId"), subjectId))
            .collect()
        )
          .sort(byConfidence)
          .slice(0, MAX_INSIGHTS)
          .map(async ({ _id, evidenceIds, matchType, confidence, rationaleCode }) => {
            const citation = await ctx.db.get(evidenceIds[0]);
            if (citation === null) throw new Error(`Unknown researchDoc: ${evidenceIds[0]}`);
            return {
              id: _id,
              matchType,
              confidence,
              rationaleCode,
              publisher: citation.publisher,
              url: citation.url,
              excerpt: citation.excerpt,
              fetchedAt: citation.fetchedAt,
            };
          }),
      ),
    };
  },
});

export const persistReport = internalMutation({
  args: {
    ownerId: v.string(),
    subjectId: v.id("subjects"),
    assessmentIds: v.array(v.id("assessments")),
    observationIds: v.array(v.id("observations")),
    insightIds: v.array(v.id("insights")),
    fileId: v.id("_storage"),
    createdAt: v.number(),
  },
  returns: v.id("reports"),
  handler: async (ctx, args) => ctx.db.insert("reports", { ...args, status: "draft" }),
});

export const finalize = mutation({
  args: { reportId: v.id("reports"), recipient: v.string() },
  returns: v.null(),
  handler: async (ctx, { reportId, recipient }) => {
    const report = await ctx.db.get(reportId);
    if (report === null) throw new Error(`Unknown report: ${reportId}`);
    if (recipient.trim() === "") throw new Error("A recipient is required");
    if (report.status === "final") throw new Error(`Report ${reportId} is already final`);
    // The stored HTML is the artifact the person consented to, so finalizing only
    // records who it goes to.
    await ctx.db.patch(reportId, { recipient, status: "final" });
    return null;
  },
});

// Both delivery paths hand out the stored artifact, and a report row with no file
// behind it is a broken write rather than an empty state.
const loadReport = async (ctx: QueryCtx, reportId: Id<"reports">) => {
  const report = await ctx.db.get(reportId);
  if (report === null) throw new Error(`Unknown report: ${reportId}`);
  if (report.fileId === undefined) throw new Error(`Report ${reportId} has no stored file`);
  return { report, fileId: report.fileId };
};

export const previewReport = query({
  args: { reportId: v.id("reports") },
  returns: v.object({
    reportId: v.id("reports"),
    status: v.union(v.literal("draft"), v.literal("final")),
    recipient: v.union(v.string(), v.null()),
    fileId: v.id("_storage"),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { reportId }) => {
    const { report, fileId } = await loadReport(ctx, reportId);
    return {
      reportId,
      status: report.status,
      recipient: report.recipient ?? null,
      fileId,
      url: await ctx.storage.getUrl(fileId),
    };
  },
});

export const reportForDelivery = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.object({
    reportId: v.id("reports"),
    subjectName: v.string(),
    status: v.union(v.literal("draft"), v.literal("final")),
    recipient: v.union(v.string(), v.null()),
    fileId: v.id("_storage"),
  }),
  handler: async (ctx, { reportId }) => {
    const { report, fileId } = await loadReport(ctx, reportId);
    const subject = await ctx.db.get(report.subjectId);
    if (subject === null) throw new Error(`Unknown subject: ${report.subjectId}`);
    return {
      reportId,
      subjectName: subject.name,
      status: report.status,
      recipient: report.recipient ?? null,
      fileId,
    };
  },
});
