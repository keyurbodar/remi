import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { DomainRollup } from "../convex/scores/rollup";
import type { ScoreDoc } from "../shared/contracts";

type Answer = { taskKey: string; answer: string; reactionMs?: number };

type TrendRow = {
  domain: string;
  current: number;
  previous: number | null;
  delta: number | null;
  direction: "first_session" | "improving" | "stable" | "declining";
  probability: number;
  sessions: number;
};

type Check = { name: string; pass: boolean; measured: string };

type ScoredAnswer = Omit<ScoreDoc, "assessmentId">;

type ScoreOutcome = ScoredAnswer & { scoreId: string };

const DIRECTIONS = ["first_session", "improving", "stable", "declining"] as const;

const seed = makeFunctionReference<"mutation", Record<string, never>, { subjectId: string }>(
  "seed:seed",
);

const startSession = makeFunctionReference<
  "mutation",
  { ownerId: string; subjectId: string },
  string
>("assessments/session:start");

const submitAnswer = makeFunctionReference<
  "mutation",
  { assessmentId: string; taskKey: string; answer: string; reactionMs?: number; clientTs: number },
  string
>("assessments/session:submit");

const finishSession = makeFunctionReference<"mutation", { assessmentId: string }, null>(
  "assessments/session:finish",
);

const scoreResponse = makeFunctionReference<
  "action",
  { responseId: string },
  ScoreOutcome
>("jev/scoreAnswer:scoreResponse");

const answerScores = makeFunctionReference<"query", { assessmentId: string }, ScoredAnswer[]>(
  "scores/rollup:answerScores",
);

const domainRollup = makeFunctionReference<"query", { assessmentId: string }, DomainRollup[]>(
  "scores/rollup:domainRollup",
);

const trendDelta = makeFunctionReference<"action", { assessmentId: string }, TrendRow[]>(
  "scores/trend:trendDelta",
);

const SESSION_A: Answer[] = [
  { taskKey: "memory-word-recall-3", answer: "apple, penny, table" },
  { taskKey: "attention-digit-span", answer: "7 2 9 4" },
  { taskKey: "attention-serial-sevens", answer: "93, 86, 79, 72, 65" },
  {
    taskKey: "language-fluency",
    answer: "dog, cat, horse, cow, sheep, goat, rabbit, mouse, deer, fox",
  },
  {
    taskKey: "visuospatial-clock",
    answer:
      "Draw a circle, write the numbers 1 to 12 around the edge, " +
      "put the short hand on the 11 and the long hand on the 2.",
  },
  { taskKey: "speed-tap", answer: "tapped", reactionMs: 320 },
];

// Session B reruns the same battery with three answers swapped: a wrong recall,
// a short fluency list, and a reaction time inside the confidence gate band.
const SESSION_B_ANSWERS: Record<string, Answer> = {
  "memory-word-recall-3": { taskKey: "memory-word-recall-3", answer: "banana, chair, window" },
  "language-fluency": { taskKey: "language-fluency", answer: "dog, cat, horse, bird, fish" },
  "speed-tap": { taskKey: "speed-tap", answer: "tapped", reactionMs: 460 },
};

const SESSION_B: Answer[] = SESSION_A.map((item) => SESSION_B_ANSWERS[item.taskKey] ?? item);

const checks: Check[] = [];

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is unset. Run `npm run verify:scoring`, which loads .env.local.");
}

const convex = new ConvexHttpClient(convexUrl);

function check(name: string, pass: boolean, measured: string) {
  checks.push({ name, pass, measured });
}

function show(value: unknown) {
  return value === undefined ? "missing" : String(value);
}

function entryFor<T extends { domain: string }>(list: T[], domain: string) {
  return list.find((row) => row.domain === domain);
}

function table(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const lines = [headers, ...rows].map((cells) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  "),
  );
  console.log(lines[0]);
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const line of lines.slice(1)) console.log(line);
}

// Each session submits one response per battery item, scores it with one JEV
// call, then marks the assessment finished so the trend read path sees it.
async function runSession(ownerId: string, subjectId: string, answers: Answer[]) {
  const assessmentId = await convex.mutation(startSession, { ownerId, subjectId });
  for (const { taskKey, answer, reactionMs } of answers) {
    const responseId = await convex.mutation(submitAnswer, {
      assessmentId,
      taskKey,
      answer,
      reactionMs,
      clientTs: Date.now(),
    });
    const scored = await convex.action(scoreResponse, { responseId });
    console.log(
      `scored ${taskKey}: value ${scored.value.toFixed(2)} confidence ${scored.confidence.toFixed(2)} ` +
        `${scored.rationaleCode}${scored.lowConfidence ? " (gated)" : ""}`,
    );
  }
  await convex.mutation(finishSession, { assessmentId });
  return assessmentId;
}

const { subjectId } = await convex.mutation(seed);
console.log(`seeded subject ${subjectId}`);

const sessionA = await runSession("demo-user", subjectId, SESSION_A);
console.log(`session A finished: ${sessionA}`);

const sessionB = await runSession("demo-user", subjectId, SESSION_B);
console.log(`session B finished: ${sessionB}`);

const rows = await convex.query(answerScores, { assessmentId: sessionB });
const rollup = await convex.query(domainRollup, { assessmentId: sessionB });
const trend = await convex.action(trendDelta, { assessmentId: sessionB });

console.log(`\nSession B answer scores (${sessionB})`);
table(
  ["domain", "value", "confidence", "lowConfidence", "rationaleCode", "modelVersion"],
  rows.map((row) => [
    row.domain,
    row.value.toFixed(2),
    row.confidence.toFixed(2),
    String(row.lowConfidence),
    row.rationaleCode,
    row.modelVersion,
  ]),
);

console.log(`\nSession B domain rollup (${sessionB})`);
table(
  ["domain", "value", "confidence", "lowConfidence", "answers", "rationaleCode"],
  rollup.map((entry) => [
    entry.domain,
    show(entry.value),
    entry.confidence.toFixed(2),
    String(entry.lowConfidence),
    String(entry.answers),
    entry.rationaleCode,
  ]),
);

console.log(`\nTrend delta (${sessionB})`);
table(
  ["domain", "current", "previous", "delta", "direction", "probability", "sessions"],
  trend.map((row) => [
    row.domain,
    row.current.toFixed(2),
    show(row.previous),
    show(row.delta),
    row.direction,
    row.probability.toFixed(2),
    String(row.sessions),
  ]),
);

const versions = [...new Set(rows.map((row) => row.modelVersion))];
check(
  "every answer score reports modelVersion jev-1.13.0",
  versions.length === 1 && versions[0] === "jev-1.13.0",
  `modelVersion=${versions.join(", ")}`,
);

check(
  "answerScores returns one row per scored answer",
  rows.length === SESSION_B.length,
  `rows=${rows.length} submitted=${SESSION_B.length}`,
);

check(
  "every answer score value sits within 0..4",
  rows.every((row) => row.value >= 0 && row.value <= 4),
  `values=${rows.map((row) => row.value.toFixed(2)).join(", ")}`,
);

check(
  "every answer score confidence is above 0.5",
  rows.every((row) => row.confidence > 0.5),
  `confidences=${rows.map((row) => row.confidence.toFixed(2)).join(", ")}`,
);

check(
  "every answer score carries a rationaleCode",
  rows.every((row) => row.rationaleCode.trim() !== ""),
  `rationaleCodes=${rows.map((row) => row.rationaleCode).join(", ")}`,
);

const memory = entryFor(rows, "memory");
const memoryRows = rows.filter((row) => row.domain === "memory");
check(
  "the deliberately wrong memory answer scores low",
  memory !== undefined && memory.value < 1.5,
  `memory rows=${memoryRows.length} value=${show(memory?.value)}`,
);

check(
  "the memory answer is coded answer_incorrect",
  memory?.rationaleCode === "answer_incorrect",
  `rationaleCode=${show(memory?.rationaleCode)}`,
);

const speed = entryFor(rows, "speed");
check(
  "the borderline speed answer is gated",
  speed?.lowConfidence === true,
  `lowConfidence=${show(speed?.lowConfidence)} confidence=${show(speed?.confidence)}`,
);

const speedRollup = entryFor(rollup, "speed");
check(
  "the gated speed domain rolls up to null",
  speedRollup?.value === null,
  `value=${show(speedRollup?.value)} lowConfidence=${show(speedRollup?.lowConfidence)}`,
);

check(
  "the gated speed rollup cites insufficient_evidence",
  speedRollup?.rationaleCode === "insufficient_evidence",
  `rationaleCode=${show(speedRollup?.rationaleCode)}`,
);

const visuospatial = entryFor(rows, "visuospatial");
check(
  "the solid visuospatial answer is not gated",
  visuospatial?.lowConfidence === false,
  `lowConfidence=${show(visuospatial?.lowConfidence)} confidence=${show(visuospatial?.confidence)}`,
);

const visuospatialRollup = entryFor(rollup, "visuospatial");
check(
  "the visuospatial domain rolls up to a number",
  typeof visuospatialRollup?.value === "number",
  `value=${show(visuospatialRollup?.value)} lowConfidence=${show(visuospatialRollup?.lowConfidence)}`,
);

const attentionRows = rows.filter((row) => row.domain === "attention");
const attentionRollup = entryFor(rollup, "attention");
check(
  "the attention rollup counts both answers",
  attentionRollup?.answers === 2,
  `answers=${show(attentionRollup?.answers)} rows=${attentionRows.length}`,
);

const attentionSum = attentionRows.reduce((sum, row) => sum + row.value, 0);
const attentionMean = Math.round((attentionSum / attentionRows.length) * 100) / 100;
const attentionValue = attentionRollup?.value;
check(
  "the attention rollup value is the mean of its answer scores",
  attentionValue !== null &&
    attentionValue !== undefined &&
    Math.round(attentionValue * 100) / 100 === attentionMean,
  `rollup=${show(attentionValue)} mean=${show(attentionMean)} rows=${attentionRows
    .map((row) => row.value.toFixed(2))
    .join(", ")}`,
);

const attentionTrend = entryFor(trend, "attention");
check(
  "the attention trend spans at least two sessions",
  (attentionTrend?.sessions ?? 0) >= 2,
  `sessions=${show(attentionTrend?.sessions)} trendDomains=${trend.map((row) => row.domain).join(", ")}`,
);

check(
  "the attention trend delta is numeric",
  typeof attentionTrend?.delta === "number",
  `delta=${show(attentionTrend?.delta)}`,
);

check(
  "the attention trend direction is a pinned literal",
  attentionTrend !== undefined && DIRECTIONS.includes(attentionTrend.direction),
  `direction=${show(attentionTrend?.direction)}`,
);

check(
  "at least one domain reports a trend beyond first_session",
  trend.some((row) => row.direction !== "first_session"),
  `directions=${trend.map((row) => `${row.domain}:${row.direction}`).join(", ")}`,
);

console.log("\nAssertions");
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name} (measured ${item.measured})`);
}

const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} assertions passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}
