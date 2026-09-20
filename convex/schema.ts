import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The only shared storage surface. Table and field shapes mirror the document
// types in shared/contracts.ts. Frozen at the backend-done gate.
export default defineSchema({
  subjects: defineTable({
    name: v.string(),
    relationship: v.union(v.literal("self"), v.literal("parent"), v.literal("other")),
    ageBand: v.string(),
    medications: v.array(v.string()),
    sleep: v.string(),
    concern: v.string(),
    createdAt: v.number(),
  }),

  assessments: defineTable({
    ownerId: v.string(),
    subjectId: v.id("subjects"),
    status: v.union(v.literal("started"), v.literal("in_progress"), v.literal("finished")),
    createdAt: v.number(),
  }).index("by_subject_created", ["subjectId", "createdAt"]),

  responses: defineTable({
    assessmentId: v.id("assessments"),
    taskKey: v.string(),
    promptVersion: v.string(),
    answer: v.string(),
    accuracy: v.optional(v.number()),
    reactionMs: v.optional(v.number()),
    clientTs: v.number(),
  }).index("by_assessment_task", ["assessmentId", "taskKey"]),

  scores: defineTable({
    assessmentId: v.id("assessments"),
    domain: v.string(),
    value: v.number(),
    confidence: v.number(),
    modelVersion: v.string(),
    lowConfidence: v.boolean(),
    rationaleCode: v.string(),
  }).index("by_assessment_domain", ["assessmentId", "domain"]),

  observations: defineTable({
    subjectId: v.id("subjects"),
    source: v.union(v.literal("journal"), v.literal("email")),
    rawText: v.string(),
    observedAt: v.optional(v.number()),
    factualSummary: v.string(),
    context: v.array(v.string()),
    tags: v.array(v.string()),
    uncertainty: v.string(),
    reviewed: v.boolean(),
    corrected: v.boolean(),
  }).index("by_subject_observed", ["subjectId", "observedAt"]),

  researchDocs: defineTable({
    url: v.string(),
    publisher: v.string(),
    excerpt: v.string(),
    extractedFacts: v.array(v.string()),
    fetchedAt: v.number(),
    embedding: v.optional(v.array(v.number())),
  })
    .index("by_url", ["url"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["publisher"],
    }),

  insights: defineTable({
    subjectId: v.id("subjects"),
    evidenceIds: v.array(v.id("researchDocs")),
    matchType: v.string(),
    confidence: v.number(),
    rationaleCode: v.string(),
  }),

  reports: defineTable({
    ownerId: v.string(),
    subjectId: v.id("subjects"),
    assessmentIds: v.array(v.id("assessments")),
    observationIds: v.array(v.id("observations")),
    insightIds: v.array(v.id("insights")),
    fileId: v.optional(v.id("_storage")),
    recipient: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("final")),
    createdAt: v.number(),
  }).index("by_owner_created", ["ownerId", "createdAt"]),

  consents: defineTable({
    reportId: v.id("reports"),
    scope: v.string(),
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_report", ["reportId"]),

  emailThreads: defineTable({
    agentmailThreadId: v.string(),
  }),

  messages: defineTable({
    threadId: v.id("emailThreads"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    agentmailMessageId: v.string(),
    body: v.string(),
    classification: v.optional(v.string()),
    deliveryStatus: v.string(),
    receivedAt: v.number(),
  }).index("by_agentmail_message_id", ["agentmailMessageId"]),

  workflowRuns: defineTable({
    kind: v.string(),
    entityId: v.string(),
    step: v.string(),
    attempt: v.number(),
    state: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("retryable"),
    ),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }),
});
