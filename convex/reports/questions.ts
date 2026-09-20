import { MAX_QUESTIONS, type ClinicianQuestion, type ReportFacts } from "./facts";

// The rules run in a fixed order, so a trimmed list keeps the low-confidence and
// below-midpoint questions ahead of the standing ones.
export function draftQuestions(facts: Omit<ReportFacts, "questions">): ClinicianQuestion[] {
  const { rollups, observations, insights, subject } = facts;
  return [
    rollups
      .filter((rollup) => rollup.lowConfidence)
      .map(({ domain }) => ({
        prompt: `The ${domain} check-in came back inconclusive. Should we repeat that check-in at the visit?`,
        basis: `domain:${domain}:low_confidence`,
      })),
    rollups.flatMap(({ domain, value }) =>
      value === null || value >= 3
        ? []
        : [
            {
              prompt: `The ${domain} result was ${value.toFixed(2)} out of 4. How does that compare with what you would expect for the ${subject.ageBand} age band?`,
              basis: `domain:${domain}:value`,
            },
          ],
    ),
    // Facts arrive newest first, so the head of the list is the two newest
    // observations.
    observations.slice(0, 2).map(({ id, factualSummary }) => ({
      prompt: `A recorded observation: "${factualSummary}". Should this be looked into further at the visit?`,
      basis: `observation:${id}`,
    })),
    insights.slice(0, 2).map(({ id, publisher, url }) => ({
      prompt: `Guidance from ${publisher} (${url}) may be relevant. Does it apply here?`,
      basis: `insight:${id}:${publisher}`,
    })),
    subject.medications.length === 0
      ? []
      : [
          {
            prompt: `Current medications include ${subject.medications.join(", ")}. Could any of them affect memory or sleep?`,
            basis: "subject:medications",
          },
        ],
    [
      {
        prompt: `Sleep was reported as: "${subject.sleep}". Does this pattern need attention?`,
        basis: "subject:sleep",
      },
    ],
    [{ prompt: "What should we track between now and the next visit?", basis: "report:next_steps" }],
  ]
    .flat()
    .slice(0, MAX_QUESTIONS);
}
