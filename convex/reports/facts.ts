import type { DomainRollup } from "../scores/rollup";

export type ClinicianQuestion = {
  prompt: string;
  basis: string;
};

export type ReviewedObservation = {
  id: string;
  observedAt: number | null;
  factualSummary: string;
  context: string[];
  tags: string[];
};

export type CitedInsight = {
  id: string;
  matchType: string;
  confidence: number;
  rationaleCode: string;
  publisher: string;
  url: string;
  excerpt: string;
  fetchedAt: number;
};

// Everything the brief renders from, gathered once so the questions, the HTML and
// the stored file all describe the same rows.
export type ReportFacts = {
  subject: {
    name: string;
    ageBand: string;
    relationship: "self" | "parent" | "other";
    medications: string[];
    sleep: string;
    concern: string;
  };
  generatedAt: number;
  rollups: DomainRollup[];
  observations: ReviewedObservation[]; // reviewed only, newest first
  insights: CitedInsight[]; // strongest confidence first
  questions: ClinicianQuestion[];
};

export const MAX_OBSERVATIONS = 5;
export const MAX_INSIGHTS = 5;
export const MAX_QUESTIONS = 6;
