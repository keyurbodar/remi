/**
 * JEV adapter: Remi's single interface to TypeSafe System One.
 *
 * SETUP (Day 0):
 *   1. npm i @typesafe-ai/sdk          (Node 20+)
 *   2. Get key: https://console.typesafe.ai/settings/keys
 *   3. npx convex env set TYPESAFE_API_KEY <key>
 *   4. Verify with one real call (scoreAnswer on a sample) before building on it.
 *
 * RULES:
 *   - Move into `convex/jev/` at scaffold; call ONLY from Convex actions
 *     (API key stays server-side, never in client bundles).
 *   - This file is the Day-0 contract: Keyur (scoring) and Aether
 *     (classification) both go through it. Fallback: if JEV access lapses,
 *     re-implement these five functions over any structured-output LLM,
 *     callers must not change.
 *   - Independent questions over the same state are batched into ONE
 *     systemOne call (parallel sampling, no cross-contamination).
 *
 * Primitives used (per docs.typesafe.ai):
 *   noul:   yes/no probability (no separate confidence field)
 *   choice: one of a defined set + full distribution + confidence
 *   score:  probability-weighted level on an ordered rubric + confidence
 */
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY

// ---------------------------------------------------------------------------
// 1) Per-answer scoring (Lane A: check-in loop, ~70ms per call)
// ---------------------------------------------------------------------------

export type AnswerScore = {
  /** 0..1 probability the answer is correct for this item */
  correct: number;
  /** true when response time suggests unusual difficulty (threshold: tune on real data) */
  anomalous: boolean;
  /** 0..4 quality level (probability-weighted; can land between levels) */
  quality: number;
};

export async function scoreAnswer(input: {
  domain: "memory" | "attention" | "language" | "visuospatial" | "speed";
  question: string;
  /** omitted for open-ended items: JEV judges quality, not exact match */
  correctAnswer?: string;
  userAnswer: string;
  /** client-measured, from jsPsych trial data */
  responseMs?: number;
  /** short trend summary from prior sessions, if any */
  priorTrend?: string;
}): Promise<AnswerScore> {
  const res = await client.systemOne({
    state: {
      domain: input.domain,
      question: input.question,
      expected: input.correctAnswer ?? "(open response: judge quality, not exact match)",
      userAnswer: input.userAnswer,
      responseMs: input.responseMs ?? null,
      trend: input.priorTrend ?? "first session",
    },
    questions: {
      correct: noul("Is the user's answer correct for this cognitive check-in item?", {
        true: "Matches the expected response or is a valid variant",
        false: "Wrong, omitted, or incoherent",
      }),
      anomalous: noul(
        "Does the response time suggest unusual difficulty for this item (far slower than typical)?",
        {
          true: "Response time is an outlier suggesting struggle or confusion",
          false: "Response time is unremarkable",
        },
      ),
      quality: score("Rate the overall quality of this answer.", [
        "No answer or incoherent",
        "Poor: mostly incorrect",
        "Partial: some elements right",
        "Good: correct, unremarkable speed",
        "Excellent: correct and quick",
      ]),
    },
  });
  return {
    correct: res.answers.correct.noul,
    anomalous: res.answers.anomalous.noul > 0.7, // TODO: calibrate threshold on real sessions
    quality: res.answers.quality.score,
  };
}

// ---------------------------------------------------------------------------
// 2) Trend delta across sessions (Lane A: trend dashboard)
// ---------------------------------------------------------------------------

export type TrendAssessment = {
  direction: "improving" | "stable" | "declining";
  /** probability of the returned direction */
  probability: number;
};

export async function assessTrend(input: {
  domain: string;
  sessions: { date: string; score: number }[]; // oldest → newest
}): Promise<TrendAssessment> {
  const res = await client.systemOne({
    state: { domain: input.domain, sessions: input.sessions },
    questions: {
      declining: noul("Is performance in this domain declining across these sessions?", {
        true: "Later sessions are consistently worse than earlier ones",
        false: "No consistent decline",
      }),
      improving: noul("Is performance in this domain improving across these sessions?", {
        true: "Later sessions are consistently better than earlier ones",
        false: "No consistent improvement",
      }),
    },
  });
  const declining = res.answers.declining.noul;
  const improving = res.answers.improving.noul;
  if (declining >= improving && declining > 0.6) {
    return { direction: "declining", probability: declining };
  }
  if (improving > declining && improving > 0.6) {
    return { direction: "improving", probability: improving };
  }
  return { direction: "stable", probability: 1 - Math.max(declining, improving) };
}

// ---------------------------------------------------------------------------
// 3) Escalation recommendation (Lane A: results screen, confidence-gated)
// ---------------------------------------------------------------------------

export type Escalation = {
  recommend: boolean;
  urgency: "routine" | "soon" | "prompt";
  confidence: number;
};

export async function recommendEscalation(input: {
  profile: Record<string, unknown>; // age band, family history, meds, concerns
  domainScores: Record<string, number>;
  trend: Record<string, TrendAssessment>;
}): Promise<Escalation> {
  const res = await client.systemOne({
    state: input,
    questions: {
      see_professional: noul(
        "Given this profile and these results, should this person be encouraged to discuss them with a clinician?",
        {
          true: "Signals or uncertainty warrant professional evaluation",
          false: "Results are unremarkable; routine next check-in is fine",
        },
      ),
      urgency: score("How soon should they seek professional evaluation?", [
        "Routine: mention at next scheduled visit",
        "Soon: within weeks",
        "Promptly: within days",
      ]),
    },
  });
  const recommend = res.answers.see_professional.noul > 0.5;
  const urgencyLevel = res.answers.urgency.score;
  return {
    recommend,
    urgency: urgencyLevel >= 2 ? "prompt" : urgencyLevel >= 1 ? "soon" : "routine",
    confidence: res.answers.see_professional.noul,
  };
}

// ---------------------------------------------------------------------------
// 4) Inbound reply classification (Lane B: AgentMail webhook → record)
// ---------------------------------------------------------------------------

export type ReplyClassification = {
  category:
    | "cognitive_concern"
    | "mood"
    | "functional_change"
    | "positive_update"
    | "logistics";
  confidence: number;
  /** true for sudden/severe changes: overrides normal flow, shows care card */
  redFlag: boolean;
};

export async function classifyReply(input: {
  emailText: string;
  senderRole: "user" | "caregiver";
}): Promise<ReplyClassification> {
  const res = await client.systemOne({
    state: { email: input.emailText, from: input.senderRole },
    questions: {
      category: choice("What is this check-in reply mainly about?", {
        cognitive_concern: "Memory/thinking changes: forgetting, losing things, getting lost, word-finding",
        mood: "Low mood, anxiety, sleep, motivation",
        functional_change: "Daily-task changes: bills, cooking, appointments, medications",
        positive_update: "Neutral or positive status update",
        logistics: "Scheduling, unsubscribe, product questions",
      }),
      red_flag: noul(
        "Does this email describe a sudden or severe change that warrants prompt professional contact?",
        {
          true: "Sudden severe change (e.g., sudden confusion, getting lost in familiar places, safety incident)",
          false: "No sudden or severe change described",
        },
      ),
    },
  });
  return {
    category: res.answers.category.choice as ReplyClassification["category"],
    confidence: res.answers.category.confidence,
    redFlag: res.answers.red_flag.noul > 0.7,
  };
}

// ---------------------------------------------------------------------------
// 5) Research-relevance matching (Lane B: citations panel)
//    One noul per finding, ALL batched in a single call over the same state.
//    Jev supports high-cardinality question maps; keep batches < 100.
// ---------------------------------------------------------------------------

export type FindingMatch = { id: string; relevant: number };

export async function matchFindings(input: {
  profile: Record<string, unknown>;
  findings: { id: string; title: string; excerpt: string }[];
}): Promise<FindingMatch[]> {
  const questions = Object.fromEntries(
    input.findings.map((f) => [
      f.id,
      noul(`Is this finding relevant to this person's cognitive profile?`, {
        true: "Directly bears on this person's domains, age band, history, or stated concerns",
        false: "Generic, unrelated, or about a different condition/population",
      }),
    ]),
  );
  const res = await client.systemOne({
    state: { profile: input.profile, findings: input.findings },
    questions,
  });
  return input.findings.map((f) => ({ id: f.id, relevant: res.answers[f.id].noul }));
}
