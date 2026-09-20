import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const RELEVANCE_THRESHOLD = 0.7; // the same certainty bar the scoring gate uses
export const STRONG_RELEVANCE = 0.85;
export const MAX_INSIGHTS = 5;

export const matchTypeValidator = v.union(
  v.literal("domain_signal"),
  v.literal("observation_signal"),
  v.literal("concern_signal"),
);
export const rationaleCodeValidator = v.union(
  v.literal("strong_relevance"),
  v.literal("moderate_relevance"),
);
export type MatchType = Infer<typeof matchTypeValidator>;
export type RationaleCode = Infer<typeof rationaleCodeValidator>;

// The exact profile state the matcher sends to JEV. Type alias, not interface, so it
// stays assignable to Record<string, JsonValue>.
export type MatchingProfile = {
  relationship: "self" | "parent" | "other";
  ageBand: string;
  concern: string;
  sleep: string;
  medications: string[];
  domains: { domain: string; value: number; confidence: number }[];
  observation: {
    factualSummary: string;
    context: string[];
    tags: string[];
    uncertainty: string;
  } | null;
};

export type RankedInsight = {
  evidenceId: Id<"researchDocs">;
  matchType: MatchType;
  confidence: number;
  rationaleCode: RationaleCode;
};

export const byConfidence = (a: { confidence: number }, b: { confidence: number }) =>
  b.confidence - a.confidence;

// Words under five letters are noise, and five also drops the usual stopwords without
// shipping a stopword list.
const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z]{5,}/g) ?? []);

// The three anchors a candidate is scored against. The order is fixed and doubles as
// the tie-break: the earliest signal with the highest overlap wins.
export function signalsFor(
  profile: MatchingProfile,
): { matchType: MatchType; terms: Set<string> }[] {
  const observation = profile.observation;
  return [
    {
      matchType: "domain_signal",
      terms: tokens(profile.domains.map((entry) => entry.domain).join(" ")),
    },
    {
      matchType: "observation_signal",
      // A subject with no journal entry has nothing to observe, so this signal stays
      // empty and can never win.
      terms: observation
        ? tokens(
            [observation.factualSummary, ...observation.tags, ...observation.context].join(" "),
          )
        : new Set<string>(),
    },
    {
      matchType: "concern_signal",
      terms: tokens(
        [profile.concern, profile.ageBand, profile.sleep, ...profile.medications].join(" "),
      ),
    },
  ];
}

// Turns one JEV relevance score per candidate into the insight rows the panel reads.
export function rankInsights(
  candidates: { id: Id<"researchDocs">; title: string; excerpt: string }[],
  relevance: Map<string, number>,
  profile: MatchingProfile,
): RankedInsight[] {
  const signals = signalsFor(profile);
  const kept: RankedInsight[] = [];
  for (const candidate of candidates) {
    const confidence = relevance.get(candidate.id);
    // A rejected candidate produces no row at all: the frozen insights table has no
    // place to park a match the cutoff threw out.
    if (confidence === undefined || confidence < RELEVANCE_THRESHOLD) continue;
    const text = tokens(`${candidate.title} ${candidate.excerpt}`);
    const overlaps = signals.map((signal) => ({
      matchType: signal.matchType,
      count: [...signal.terms].filter((term) => text.has(term)).length,
    }));
    const best = overlaps.reduce((top, entry) => (entry.count > top.count ? entry : top));
    kept.push({
      evidenceId: candidate.id,
      // A candidate sharing no term at all still cites the subject's stated worry.
      matchType: best.count === 0 ? "concern_signal" : best.matchType,
      confidence,
      rationaleCode: confidence >= STRONG_RELEVANCE ? "strong_relevance" : "moderate_relevance",
    });
  }
  return kept
    .sort(
      (a, b) =>
        byConfidence(a, b) ||
        (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0),
    )
    .slice(0, MAX_INSIGHTS);
}
