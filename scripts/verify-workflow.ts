import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { CHECK_IN_BATTERY } from "../convex/assessments/battery.ts";
import type { WorkflowState } from "../convex/workflowRuns/record.ts";

type Check = { name: string; pass: boolean; measured: string };

type TrailRow = {
  step: string;
  attempt: number;
  state: WorkflowState;
  error?: string;
  startedAt: number;
  completedAt?: number;
};

const TERMINAL: WorkflowState[] = ["succeeded", "failed"];

// Not a real credential: the run has to fail on the model's own 401, not on a
// missing env var.
const INVALID_KEY = "typesafe-key-rejected-by-workflow-verification";

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

const startScoring = makeFunctionReference<
  "mutation",
  { assessmentId: string },
  { workflowId: string; runId: string }
>("workflows/scoring:startScoring");

const runTrail = makeFunctionReference<"query", { entityId: string }, TrailRow[]>(
  "workflowRuns/trail:trail",
);

const answerScores = makeFunctionReference<"query", { assessmentId: string }, { domain: string }[]>(
  "scores/rollup:answerScores",
);

const checks: Check[] = [];

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is unset. Run `npm run verify:workflow`, which loads .env.local.");
}

const convex = new ConvexHttpClient(convexUrl);
const deployment = new URL(convexUrl).hostname.split(".")[0];

function check(name: string, pass: boolean, measured: string) {
  checks.push({ name, pass, measured });
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

function show(value: unknown) {
  return value === undefined ? "missing" : String(value);
}

// The run is durable, so the script watches workflowRuns the way the results
// screen does instead of waiting on the workflow's own return value. `since`
// skips the rows of an earlier run against the same assessment.
async function watchRun(entityId: string, since = 0) {
  for (let poll = 0; poll < 240; poll++) {
    const rows = (await convex.query(runTrail, { entityId })).slice(since);
    const run = rows.filter((row) => row.step === "run").at(-1);
    if (run && TERMINAL.includes(run.state)) return rows;
    await sleep(500);
  }
  throw new Error(`Run for ${entityId} never reached a terminal state`);
}

async function submitAnswers(ownerId: string, subjectId: string, taskKeys: string[]) {
  const assessmentId = await convex.mutation(startSession, { ownerId, subjectId });
  for (const taskKey of taskKeys) {
    const item = CHECK_IN_BATTERY.find((candidate) => candidate.taskKey === taskKey);
    if (!item) throw new Error(`Unknown check-in item: ${taskKey}`);
    await convex.mutation(submitAnswer, {
      assessmentId,
      taskKey: item.taskKey,
      answer: item.correctAnswer ?? "dog, cat, horse, cow, sheep, goat",
      reactionMs: item.taskKey === "speed-tap" ? 380 : undefined,
      clientTs: Date.now(),
    });
  }
  return assessmentId;
}

// The deployment env var is the only way to hand the run a rejected key: the
// Convex action reads TYPESAFE_API_KEY, never the script's environment.
function deploymentEnv(args: string[]) {
  return execFileSync("npx", ["convex", "env", ...args, "--deployment", deployment], {
    encoding: "utf8",
  }).trim();
}

function trailRows(rows: TrailRow[]) {
  return rows.map((row, index) => [
    String(index),
    row.step,
    String(row.attempt),
    row.state,
    show(row.error),
    new Date(row.startedAt).toISOString().slice(11, 23),
    row.completedAt === undefined ? "open" : new Date(row.completedAt).toISOString().slice(11, 23),
  ]);
}

const { subjectId } = await convex.mutation(seed, {});
console.log(`seeded subject ${subjectId}`);

const assessmentId = await submitAnswers(
  "demo-user",
  subjectId,
  CHECK_IN_BATTERY.map((item) => item.taskKey),
);
const started = await convex.mutation(startScoring, { assessmentId });
console.log(`started run ${started.workflowId} for ${assessmentId}`);

const trail = await watchRun(assessmentId);
const scores = await convex.query(answerScores, { assessmentId });

console.log(`\nworkflowRuns trail for ${assessmentId} (${trail.length} rows)`);
table(["#", "step", "attempt", "state", "error", "started", "completed"], trailRows(trail));

const scoreSteps = trail.filter((row) => row.step.startsWith("score:"));
const scoredKeys = new Set(scoreSteps.map((row) => row.step));
const runRows = trail.filter((row) => row.step === "run");
const rollupIndex = trail.findIndex((row) => row.step === "rollup");
const lastScoreIndex = trail.findLastIndex((row) => row.step.startsWith("score:"));

check(
  "the start mutation queues the run before it executes",
  trail[0]?.step === "run" && trail[0]?.state === "queued" && trail[0]?.completedAt === undefined,
  `first=${show(trail[0]?.step)}:${show(trail[0]?.state)} completedAt=${show(trail[0]?.completedAt)}`,
);

check(
  "the run row walks queued to running to succeeded",
  runRows.map((row) => row.state).join(" ") === "queued running succeeded",
  `runStates=${runRows.map((row) => row.state).join(" ")}`,
);

check(
  "every submitted answer has its own score step",
  scoredKeys.size === CHECK_IN_BATTERY.length &&
    CHECK_IN_BATTERY.every((item) => scoredKeys.has(`score:${item.taskKey}`)),
  `scoreSteps=${[...scoredKeys].join(", ")} submitted=${CHECK_IN_BATTERY.length}`,
);

check(
  "every score step succeeded on its first attempt",
  scoreSteps.length === CHECK_IN_BATTERY.length * 2 &&
    scoreSteps.every((row) => row.attempt === 1) &&
    scoreSteps.filter((row) => row.state === "succeeded").length === CHECK_IN_BATTERY.length &&
    !scoreSteps.some((row) => row.state === "retryable" || row.state === "failed"),
  `rows=${scoreSteps.length} states=${scoreSteps.map((row) => row.state).join(", ")}`,
);

check(
  "the rollup step runs after the last score step",
  rollupIndex > lastScoreIndex && lastScoreIndex >= 0,
  `rollupIndex=${rollupIndex} lastScoreIndex=${lastScoreIndex}`,
);

check(
  "the rollup step succeeded",
  trail.some((row) => row.step === "rollup" && row.state === "succeeded"),
  `rollup=${trail
    .filter((row) => row.step === "rollup")
    .map((row) => row.state)
    .join(", ")}`,
);

check(
  "a terminal row is closed and an open row is not",
  trail.every((row) => (TERMINAL.includes(row.state) ? row.completedAt !== undefined : row.completedAt === undefined)),
  `terminal=${trail.filter((row) => TERMINAL.includes(row.state)).length} open=${trail.filter((row) => row.completedAt === undefined).length}`,
);

check(
  "a healthy run records no error text",
  trail.every((row) => row.error === undefined),
  `errors=${trail.filter((row) => row.error !== undefined).length}`,
);

check(
  "the run scored every answer in the database",
  scores.length === CHECK_IN_BATTERY.length,
  `scores=${scores.length} submitted=${CHECK_IN_BATTERY.length}`,
);

// A durable pipeline gets triggered again on a retry or a second tap. It must
// pick up what is left instead of scoring the same answer twice.
const seenRows = (await convex.query(runTrail, { entityId: assessmentId })).length;
const rerun = await convex.mutation(startScoring, { assessmentId });
const rerunTrail = await watchRun(assessmentId, seenRows);
const rerunScores = await convex.query(answerScores, { assessmentId });

console.log(`\nre-triggered run ${rerun.workflowId} (${rerunTrail.length} rows)`);
table(["#", "step", "attempt", "state", "error", "started", "completed"], trailRows(rerunTrail));

check(
  "a re-triggered run finds nothing left to score",
  !rerunTrail.some((row) => row.step.startsWith("score:")) &&
    rerunTrail.some((row) => row.step === "rollup" && row.state === "succeeded") &&
    rerunTrail.at(-1)?.state === "succeeded",
  `steps=${[...new Set(rerunTrail.map((row) => row.step))].join(", ")}`,
);

check(
  "the re-triggered run does not double-score the answers",
  rerunScores.length === CHECK_IN_BATTERY.length,
  `scores=${rerunScores.length} after=${scores.length}`,
);

const failingAssessment = await submitAnswers("demo-user", subjectId, ["memory-word-recall-3"]);
const savedKey = deploymentEnv(["get", "TYPESAFE_API_KEY"]);
let failTrail: TrailRow[] = [];
let failScores: { domain: string }[] = [];

try {
  deploymentEnv(["set", "TYPESAFE_API_KEY", INVALID_KEY]);
  check(
    "the deployment holds the rejected key",
    deploymentEnv(["get", "TYPESAFE_API_KEY"]) === INVALID_KEY,
    "env get returns the invalid value",
  );

  const seen = (await convex.query(runTrail, { entityId: failingAssessment })).length;
  const failing = await convex.mutation(startScoring, { assessmentId: failingAssessment });
  console.log(`\nstarted run ${failing.workflowId} with a rejected JEV key`);

  failTrail = await watchRun(failingAssessment, seen);
  failScores = await convex.query(answerScores, { assessmentId: failingAssessment });
} finally {
  deploymentEnv(["set", "TYPESAFE_API_KEY", savedKey]);
}

console.log(`\nworkflowRuns trail for the rejected key (${failTrail.length} rows)`);
table(["#", "step", "attempt", "state", "error", "started", "completed"], trailRows(failTrail));

const failSteps = failTrail.filter((row) => row.step.startsWith("score:"));
const failRun = failTrail.filter((row) => row.step === "run").at(-1);
const retryable = failSteps.filter((row) => row.state === "retryable");
const failed = failSteps.filter((row) => row.state === "failed");

check(
  "the failing answer is attempted, retried, then failed",
  failSteps.map((row) => row.state).join(" ") ===
    "running retryable running retryable running failed",
  `states=${failSteps.map((row) => row.state).join(" ")}`,
);

check(
  "every retry records the model error",
  retryable.length === 2 && retryable.every((row) => (row.error ?? "").trim() !== ""),
  `retryable=${retryable.length} errors=${retryable.map((row) => row.error).join(" | ")}`,
);

check(
  "the rejected key surfaces as JEV's own 401",
  retryable.every((row) => (row.error ?? "").includes("401")),
  `errors=${retryable.map((row) => row.error).join(" | ")}`,
);

check(
  "the failed attempt records the same error the retries saw",
  failed.length === 1 && failed[0].error === retryable[0]?.error,
  `failedError=${show(failed[0]?.error)}`,
);

check(
  "the run row records the failure and closes",
  failRun?.state === "failed" &&
    failRun.error === failed[0]?.error &&
    failRun.completedAt !== undefined,
  `runState=${show(failRun?.state)} runError=${show(failRun?.error)}`,
);

check(
  "the failed run never reaches the rollup",
  !failTrail.some((row) => row.step === "rollup") &&
    !failTrail.some((row) => row.step.startsWith("score:") && row.state === "succeeded"),
  `steps=${[...new Set(failTrail.map((row) => row.step))].join(", ")} scoreStates=${failSteps
    .map((row) => row.state)
    .join(" ")}`,
);

check(
  "the failure is captured instead of swallowed",
  failScores.length === 0 && failTrail.some((row) => row.state === "failed"),
  `scores=${failScores.length} failedRows=${failTrail.filter((row) => row.state === "failed").length}`,
);

check(
  "the deployment key is restored",
  deploymentEnv(["get", "TYPESAFE_API_KEY"]) === savedKey,
  `restored=${deploymentEnv(["get", "TYPESAFE_API_KEY"]) === savedKey}`,
);

console.log("\nAssertions");
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name} (measured ${item.measured})`);
}

const failedChecks = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failedChecks.length}/${checks.length} assertions passed`);
if (failedChecks.length > 0) {
  process.exitCode = 1;
}
