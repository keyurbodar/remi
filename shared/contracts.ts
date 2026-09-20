/**
 * Shared contracts for Remi: adapter signatures plus the document types every
 * module imports. Co-owned by both builders, frozen at the backend-done gate.
 *
 * Ids are plain strings so this file stays runtime free and importable from
 * the browser and from Convex functions. Convex validators enforce table
 * correctness at every boundary; these types describe shape, not storage.
 */

export type JevDomain = "memory" | "attention" | "language" | "visuospatial" | "speed";

export type DeliveryStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";

export type WorkflowState = "queued" | "running" | "succeeded" | "failed" | "retryable";

// ---------------------------------------------------------------------------
// Adapter signatures. Adapters return these validated types and nothing else.
// ---------------------------------------------------------------------------

export type JevScoreInput = {
 domain: JevDomain;
 question: string;
 /** Omitted for open-ended items: JEV judges quality, not exact match. */
 correctAnswer?: string;
 userAnswer: string;
 /** Client measured, from the check-in trial data. */
 responseMs?: number;
 /** Short trend summary from prior sessions, if any. */
 priorTrend?: string;
};

export type JevScoreResult = {
 /** 0..1 probability the answer is correct for this item. */
 correct: number;
 /** True when response time suggests unusual difficulty. */
 anomalous: boolean;
 /** 0..4 quality level, probability weighted, can land between levels. */
 quality: number;
 /** Reported by JEV on every call, stored verbatim on scores. */
 modelVersion: string;
};

export type FirecrawlRefreshInput = {
 url: string;
 publisher: string;
};

export type FirecrawlRefreshResult = {
 url: string;
 publisher: string;
 excerpt: string;
 extractedFacts: string[];
 fetchedAt: number;
};

export type AgentMailSendInput = {
 to: string;
 subject: string;
 body: string;
 idempotencyKey: string;
};

export type AgentMailSendResult = {
 messageId: string;
 threadId: string;
 deliveryStatus: DeliveryStatus;
};

export type AgentMailReceiveInput = {
 agentmailMessageId: string;
 agentmailThreadId: string;
 from: string;
 subject: string;
 body: string;
 receivedAt: number;
};

/** The inbound webhook payload after validation, ready to persist as a message. */
export type AgentMailReceiveResult = AgentMailReceiveInput;

export interface JevAdapter {
 score(input: JevScoreInput): Promise<JevScoreResult>;
}

export interface FirecrawlAdapter {
 refresh(input: FirecrawlRefreshInput): Promise<FirecrawlRefreshResult>;
}

export interface AgentMailAdapter {
 send(input: AgentMailSendInput): Promise<AgentMailSendResult>;
 receive(input: AgentMailReceiveInput): Promise<AgentMailReceiveResult>;
}

// ---------------------------------------------------------------------------
// Document types, one per Convex table in convex/schema.ts.
// ---------------------------------------------------------------------------

export type SubjectDoc = {
 name: string;
 relationship: "self" | "parent" | "other";
 ageBand: string;
 medications: string[];
 sleep: string;
 concern: string;
 createdAt: number;
};

export type AssessmentDoc = {
 ownerId: string;
 subjectId: string;
 status: "started" | "in_progress" | "finished";
 createdAt: number;
};

export type ResponseDoc = {
 assessmentId: string;
 taskKey: string;
 promptVersion: string;
 answer: string;
 accuracy?: number;
 reactionMs?: number;
 clientTs: number;
};

export type ScoreDoc = {
 assessmentId: string;
 domain: JevDomain;
 value: number;
 confidence: number;
 modelVersion: string;
 lowConfidence: boolean;
 rationaleCode: string;
};

export type ObservationDoc = {
 subjectId: string;
 source: "journal" | "email";
 rawText: string;
 observedAt?: number;
 factualSummary: string;
 context: string[];
 tags: string[];
 uncertainty: string;
 reviewed: boolean;
 corrected: boolean;
};

export type ResearchDocDoc = {
 url: string;
 publisher: string;
 excerpt: string;
 extractedFacts: string[];
 fetchedAt: number;
 embedding?: number[];
};

export type InsightDoc = {
 subjectId: string;
 evidenceIds: string[];
 matchType: string;
 confidence: number;
 rationaleCode: string;
};

export type ReportDoc = {
 ownerId: string;
 subjectId: string;
 assessmentIds: string[];
 observationIds: string[];
 insightIds: string[];
 fileId?: string;
 recipient?: string;
 status: "draft" | "final";
 createdAt: number;
};

export type ConsentDoc = {
 reportId: string;
 scope: string;
 grantedAt: number;
 revokedAt?: number;
};

export type EmailThreadDoc = {
 agentmailThreadId: string;
};

export type MessageDoc = {
 threadId: string;
 direction: "outbound" | "inbound";
 agentmailMessageId: string;
 body: string;
 classification?: string;
 deliveryStatus: DeliveryStatus;
 receivedAt: number;
};

export type WorkflowRunDoc = {
 kind: string;
 entityId: string;
 step: string;
 attempt: number;
 state: WorkflowState;
 error?: string;
 startedAt: number;
 completedAt?: number;
};
